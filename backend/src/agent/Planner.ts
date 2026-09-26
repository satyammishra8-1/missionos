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

export class CapabilityPlanningStrategy implements PlanningStrategy {
  createPlan(request: PlanningRequest): AgentPlan {
    const excluded = new Set(request.excludedToolIds)
    const tool = request.tools.find(
      (candidate) => !excluded.has(candidate.id) && candidate.supports(request.goal),
    )

    if (!tool) {
      return { goalId: request.goal.id, steps: [] }
    }

    return {
      goalId: request.goal.id,
      rationale: `Selected the first registered tool that supports goal ${request.goal.id}.`,
      evaluateAfterExecution: false,
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
}

export class Planner {
  constructor(
    private readonly strategy: PlanningStrategy = new CapabilityPlanningStrategy(),
  ) {}

  async createPlan(request: PlanningRequest): Promise<AgentPlan> {
    const plan = await this.strategy.createPlan(request)

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

    return plan
  }
}