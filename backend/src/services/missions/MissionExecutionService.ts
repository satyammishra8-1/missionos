import { randomUUID } from 'node:crypto'
import { Agent, type AgentOptions, type ConstraintEvaluator } from '../../agent/Agent.js'
import { AgentState } from '../../agent/AgentState.js'
import { Planner, type PlanningStrategy } from '../../agent/Planner.js'
import { ToolRegistry } from '../../agent/ToolRegistry.js'
import type {
  AgentPlan,
  MissionGoal,
  ToolExecutionResult,
} from '../../agent/types.js'
import {
  createGeminiAgent,
  type GeminiAgentFactoryOptions,
} from '../gemini/index.js'
import { registerSerpApiTools, type SerpApiOptions } from '../serpapi/index.js'

const maximumGoalLength = 4_000
const maximumConstraintCount = 30
const maximumConstraintKeyLength = 80

export interface MissionRequest {
  goal: string
  constraints?: Readonly<Record<string, unknown>>
}

export interface MissionToolCall {
  stepId: string
  toolId: string
  objective: string
  input: unknown
  status: 'completed' | 'failed' | 'pending'
  output?: unknown
  error?: string
}

export interface MissionFailure {
  source: 'tool' | 'planner' | 'constraint' | 'mission'
  message: string
  stepId?: string
  toolId?: string
}

export interface MissionReplan {
  iteration: number
  reason: string
}

export interface MissionEvidence {
  stepId: string
  toolId: string
  title?: string
  url?: string
  source?: string
  details?: unknown
}

export interface MissionState {
  missionId: string
  goal: string
  constraints: Readonly<Record<string, unknown>>
  status: AgentState['status']
  currentPlan?: AgentPlan
  planHistory: readonly AgentPlan[]
  completedTasks: readonly {
    stepId: string
    toolId: string
    objective: string
    output: unknown
  }[]
  toolCalls: readonly MissionToolCall[]
  observations: readonly ToolExecutionResult[]
  failures: readonly MissionFailure[]
  replans: readonly MissionReplan[]
  evidence: readonly MissionEvidence[]
  finalResult?: unknown
  iterationCount: number
}

export interface MissionExecutionOptions {
  serpApi?: SerpApiOptions
  gemini?: GeminiAgentFactoryOptions['planner']
  agent?: AgentOptions
  plannerStrategy?: PlanningStrategy
  constraintEvaluator?: ConstraintEvaluator
  registerTools?: (registry: ToolRegistry) => void
  createMissionId?: () => string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function validateMissionRequest(value: unknown): MissionRequest {
  if (!isRecord(value)) throw new Error('Request body must be a JSON object')
  if (typeof value.goal !== 'string' || !value.goal.trim()) {
    throw new Error('goal must be a non-empty string')
  }
  if (value.goal.trim().length > maximumGoalLength) {
    throw new Error(`goal must be at most ${maximumGoalLength} characters`)
  }
  if (value.constraints !== undefined && !isRecord(value.constraints)) {
    throw new Error('constraints must be a JSON object')
  }

  const constraints = value.constraints ?? {}
  const entries = Object.entries(constraints)
  if (entries.length > maximumConstraintCount) {
    throw new Error(`constraints must contain at most ${maximumConstraintCount} entries`)
  }
  if (entries.some(([key]) => !key.trim() || key.length > maximumConstraintKeyLength)) {
    throw new Error(`constraint keys must be non-empty and at most ${maximumConstraintKeyLength} characters`)
  }
  for (const [, constraint] of entries) {
    if (constraint === undefined || typeof constraint === 'function' || typeof constraint === 'symbol') {
      throw new Error('constraint values must be JSON-compatible')
    }
    try {
      JSON.stringify(constraint)
    } catch {
      throw new Error('constraint values must be JSON-compatible')
    }
  }

  return { goal: value.goal.trim(), constraints }
}

function describeConstraints(
  constraints: Readonly<Record<string, unknown>>,
): MissionGoal['constraints'] {
  return Object.entries(constraints).map(([id, value]) => ({
    id,
    description: `${id}: ${typeof value === 'string' ? value : JSON.stringify(value)}`,
  }))
}

function sourceForUrl(url: string): string | undefined {
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return undefined
    return parsed.hostname.toLowerCase().replace(/^www\./, '')
  } catch {
    return undefined
  }
}

function collectEvidence(
  value: unknown,
  stepId: string,
  toolId: string,
  evidence: MissionEvidence[],
): void {
  if (Array.isArray(value)) {
    for (const item of value) collectEvidence(item, stepId, toolId, evidence)
    return
  }
  if (!isRecord(value)) return

  const urlValue = value.link ?? value.placeLink ?? value.url
  const url = typeof urlValue === 'string' ? urlValue : undefined
  const sourceValue = value.source
  const source = typeof sourceValue === 'string'
    ? sourceValue
    : url ? sourceForUrl(url) : undefined
  const title = [value.title, value.name, value.flightNumber]
    .find((candidate): candidate is string => typeof candidate === 'string' && Boolean(candidate.trim()))

  if (url || source) {
    evidence.push({
      stepId,
      toolId,
      ...(title ? { title: title.trim() } : {}),
      ...(url ? { url } : {}),
      ...(source ? { source } : {}),
      details: value,
    })
  }
  for (const item of Object.values(value)) collectEvidence(item, stepId, toolId, evidence)
}

function buildMissionState(
  missionId: string,
  request: MissionRequest,
  goal: MissionGoal,
  state: AgentState,
): MissionState {
  const plannedSteps = state.planningHistory.flatMap((plan) => plan.steps)
  const observationsByStep = new Map(state.observations.map((observation) => [observation.stepId, observation]))
  const toolCalls: MissionToolCall[] = plannedSteps.map((step) => {
    const observation = observationsByStep.get(step.id)
    return {
      stepId: step.id,
      toolId: step.toolId,
      objective: step.objective,
      input: step.input,
      status: !observation ? 'pending' : observation.ok ? 'completed' : 'failed',
      ...(observation?.ok ? { output: observation.output } : {}),
      ...(observation && !observation.ok ? { error: observation.error } : {}),
    }
  })

  const completedTasks = toolCalls.flatMap((call) => {
    if (call.status !== 'completed') return []
    return [{
      stepId: call.stepId,
      toolId: call.toolId,
      objective: call.objective,
      output: call.output,
    }]
  })

  const failures: MissionFailure[] = state.observations.flatMap((observation) => {
    if (observation.ok) return []
    return [{
      source: 'tool' as const,
      message: observation.error,
      stepId: observation.stepId,
      toolId: observation.toolId,
    }]
  })
  if (state.failureReason && !failures.some((failure) => state.failureReason?.includes(failure.message))) {
    const source: MissionFailure['source'] = state.failureReason.startsWith('Planning failed:')
      ? 'planner'
      : state.failureReason.startsWith('Constraint evaluation failed:')
        ? 'constraint'
        : state.failureReason.startsWith('Tool execution failed:') ? 'tool' : 'mission'
    failures.push({ source, message: state.failureReason })
  }

  const evidence: MissionEvidence[] = []
  for (const observation of state.observations) {
    if (observation.ok) collectEvidence(observation.output, observation.stepId, observation.toolId, evidence)
  }

  return {
    missionId,
    goal: request.goal,
    constraints: request.constraints ?? {},
    status: state.status,
    ...(state.plan ? { currentPlan: state.plan } : {}),
    planHistory: state.planningHistory,
    completedTasks,
    toolCalls,
    observations: state.observations,
    failures,
    replans: state.replanReasons.map((reason, index) => ({ iteration: index + 1, reason })),
    evidence,
    ...(state.finalResult !== undefined ? { finalResult: state.finalResult } : {}),
    iterationCount: state.observations.length,
  }
}

const successfulObservationEvaluator: ConstraintEvaluator = {
  evaluate: (_goal, observations) => {
    const latest = observations.at(-1)
    return latest?.ok
      ? { satisfied: true, violations: [] }
      : { satisfied: false, violations: ['The latest tool observation was unsuccessful.'] }
  },
}

export class MissionExecutionService {
  constructor(private readonly options: MissionExecutionOptions = {}) {}

  async execute(rawRequest: unknown): Promise<MissionState> {
    const request = validateMissionRequest(rawRequest)
    const missionId = this.options.createMissionId?.() ?? randomUUID()
    const goal: MissionGoal = {
      id: missionId,
      description: request.goal,
      constraints: describeConstraints(request.constraints ?? {}),
    }
    const registry = new ToolRegistry()
    const initialState = AgentState.start(goal)

    try {
      registerSerpApiTools(registry, this.options.serpApi)
      this.options.registerTools?.(registry)

      const agentOptions: AgentOptions = {
        maxIterations: 8,
        timeoutMs: 60_000,
        maxReplans: 3,
        plannerDecidesCompletion: true,
        constraintEvaluator: this.options.constraintEvaluator ?? successfulObservationEvaluator,
        ...this.options.agent,
      }
      const agent = this.options.plannerStrategy
        ? new Agent(registry, new Planner(this.options.plannerStrategy), undefined, undefined, agentOptions)
        : createGeminiAgent(registry, {
            planner: this.options.gemini,
            agent: agentOptions,
          })
      const state = await agent.run(goal)
      return buildMissionState(missionId, request, goal, state)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown mission execution error'
      return buildMissionState(missionId, request, goal, initialState.fail(`Mission execution failed: ${message}`))
    }
  }
}

export function createMissionExecutionService(
  options: MissionExecutionOptions = {},
): MissionExecutionService {
  return new MissionExecutionService(options)
}