import type {
  AgentPlan,
  AgentStateSnapshot,
  MissionGoal,
  RegisteredTool,
  ToolObservation,
} from './types.js'

export interface PlanningRequest {
  goal: MissionGoal
  tools: readonly RegisteredTool[]
  observations: readonly ToolObservation[]
  state: AgentStateSnapshot
  excludedToolIds: readonly string[]
  replanCount: number
}

export interface PlanningStrategy {
  createPlan(request: PlanningRequest): Promise<AgentPlan> | AgentPlan
}

export function validatePlan(request: PlanningRequest, plan: AgentPlan): void {
  if (plan.goalId !== request.goal.id) {
    throw new Error(`Planner returned a plan for a different goal: ${plan.goalId}`)
  }

  const stepIds = new Set<string>()
  const excluded = new Set(request.excludedToolIds)
  for (const step of plan.steps) {
    if (!step.id.trim() || stepIds.has(step.id)) {
      throw new Error(`Plan contains an invalid or duplicate step id: ${step.id}`)
    }
    stepIds.add(step.id)

    const tool = request.tools.find((candidate) => candidate.id === step.toolId)
    if (!tool || excluded.has(step.toolId)) {
      throw new Error(`Plan references an unavailable tool: ${step.toolId}`)
    }
    if (!tool.supports(request.goal)) {
      throw new Error(`Tool does not support the goal: ${step.toolId}`)
    }
  }
}

export class CapabilityPlanningStrategy implements PlanningStrategy {
  createPlan(request: PlanningRequest): AgentPlan {
    const excluded = new Set(request.excludedToolIds)
    const successfulToolIds = new Set(request.observations.filter((item) => item.ok).map((item) => item.toolId))
    const requirements = request.goal.metadata?.missionRequirements
    const requiredToolIds = isRecord(requirements) && Array.isArray(requirements.requiredToolIds)
      ? requirements.requiredToolIds.filter((toolId): toolId is string => typeof toolId === 'string')
      : []
    const explicitDates = isRecord(requirements) && Array.isArray(requirements.explicitDates)
      ? requirements.explicitDates.filter((value): value is string => typeof value === 'string')
      : []
    const pendingRequiredTools = requiredToolIds.filter((toolId) => !successfulToolIds.has(toolId))
    const unavailableRequiredTools = pendingRequiredTools.filter((toolId) =>
      !request.tools.some((tool) => tool.id === toolId),
    )
    if (unavailableRequiredTools.length > 0) {
      return this.replan(request, unavailableRequiredTools.map((toolId) => `Register required tool ${toolId}.`))
    }

    const requiredCandidates = pendingRequiredTools.flatMap((toolId) => {
      const tool = request.tools.find((candidate) => candidate.id === toolId)
      if (!tool || excluded.has(tool.id) || !tool.supports(request.goal)) return []
      const dateFields = tool.inputSchema?.required?.filter((field) => /date|check.?in|check.?out/i.test(field)) ?? []
      if (dateFields.length > explicitDates.length) return []
      return [tool]
    })
    const fallbackCandidates = request.tools.filter((candidate) =>
      !excluded.has(candidate.id) &&
      !successfulToolIds.has(candidate.id) &&
      candidate.supports(request.goal) &&
      (candidate.inputSchema?.required?.filter((field) => /date|check.?in|check.?out/i.test(field)).length ?? 0) <= explicitDates.length,
    )
    const tool = requiredCandidates[0] ?? (requiredToolIds.length > 0 ? undefined : fallbackCandidates[0])

    if (!tool) {
      if (
        requiredToolIds.length > 0 &&
        pendingRequiredTools.length === 0 &&
        request.observations.some((item) => item.ok) &&
        request.state.constraintHistory.at(-1)?.satisfied
      ) {
        return {
          goalId: request.goal.id,
          decision: 'complete',
          rationale: 'The capability fallback completed the requested tools and satisfied the available constraints.',
          finalResult: 'Mission completed using the available tool evidence.',
          steps: [],
        }
      }
      const blockedDateTools = pendingRequiredTools.filter((toolId) => {
        const candidate = request.tools.find((item) => item.id === toolId)
        const dateFields = candidate?.inputSchema?.required?.filter((field) => /date|check.?in|check.?out/i.test(field)) ?? []
        return dateFields.length > explicitDates.length
      })
      if (blockedDateTools.length > 0) {
        return this.replan(request, [`Exact travel dates are required before calling ${blockedDateTools.join(', ')}.`])
      }
      if (request.observations.length > 0) {
        return this.replan(request, ['The Gemini planner is unavailable and the fallback cannot verify whether more actions are needed.'])
      }
      return this.replan(request, ['No registered tool can handle the mission.'])
    }

    return {
      goalId: request.goal.id,
      rationale: `Selected the first registered tool that supports goal ${request.goal.id}.`,
      evaluateAfterExecution: true,
      steps: [
        {
          id: `plan-${request.replanCount}-${tool.id}`,
          toolId: tool.id,
          objective: request.goal.description,
          input: tool.createInput({ goal: request.goal, observations: request.observations }),
        },
      ],
    }
  }

  private replan(request: PlanningRequest, missingInformation: readonly string[]): AgentPlan {
    const lastEvaluation = request.state.constraintHistory.at(-1)
    const constraintReasons = [
      ...(lastEvaluation?.violations ?? []),
      ...(lastEvaluation?.assessments
        ?.filter((item) => item.status !== 'satisfied')
        .map((item) => `${item.constraint} is ${item.status}: ${item.reason}`) ?? []),
    ]
    return {
      goalId: request.goal.id,
      decision: 'replan',
      rationale: constraintReasons.length > 0
        ? `The capability fallback cannot resolve constraints: ${constraintReasons.join('; ')}`
        : 'The capability fallback cannot complete the mission with the available evidence.',
      missingInformation: [...missingInformation, ...constraintReasons],
      steps: [],
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export class Planner {
  constructor(
    private readonly strategy: PlanningStrategy = new CapabilityPlanningStrategy(),
  ) {}

  async createPlan(request: PlanningRequest): Promise<AgentPlan> {
    const plan = await this.strategy.createPlan(request)
    validatePlan(request, plan)
    return plan
  }
}