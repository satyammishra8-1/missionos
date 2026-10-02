import { randomUUID } from 'node:crypto'
import { Agent, type AgentOptions, type ConstraintEvaluator } from '../../agent/Agent.js'
import { AgentState } from '../../agent/AgentState.js'
import { CapabilityPlanningStrategy, Planner, type PlanningStrategy } from '../../agent/Planner.js'
import { ToolRegistry } from '../../agent/ToolRegistry.js'
import { environment } from '../../config/environment.js'
import type {
  AgentPlan,
  ConstraintAssessment,
  ConstraintEvaluation,
  MissionGoal,
  ToolExecutionResult,
} from '../../agent/types.js'
import {
  createGeminiPlanningStrategy,
  type GeminiPlannerOptions,
} from '../gemini/index.js'
import { FallbackPlanningStrategy } from '../gemini/GeminiPlannerStrategy.js'
import { MissionConstraintEvaluator } from './MissionConstraintEvaluator.js'
import { extractMissionRequirements } from './MissionRequirementExtractor.js'
import { isTravelMission } from './travelIntent.js'
import { registerSerpApiTools, type SerpApiOptions } from '../serpapi/index.js'

const maximumGoalLength = 4_000
const maximumConstraintCount = 30
const maximumConstraintKeyLength = 80
const serpApiToolIds = new Set([
  'google-search',
  'google-maps-places',
  'google-flights',
  'google-hotels',
])

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
  source: 'configuration' | 'tool' | 'planner' | 'constraint' | 'mission'
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
  relevantData: unknown
}

export interface MissionVerifiedFact {
  claim: string
  toolId: string
  source?: string
  url?: string
  relevantData: unknown
}

export interface MissionState {
  missionId: string
  goal: string
  constraints: Readonly<Record<string, unknown>>
  status: AgentState['status'] | 'needs_information' | 'no_match'
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
  constraintHistory: readonly ConstraintEvaluation[]
  constraintAssessments: readonly ConstraintAssessment[]
  evidence: readonly MissionEvidence[]
  verifiedFacts: readonly MissionVerifiedFact[]
  assumptions: readonly string[]
  missingInformation: readonly string[]
  finalResult?: unknown
  iterationCount: number
}

export interface MissionExecutionOptions {
  serpApi?: SerpApiOptions
  gemini?: GeminiPlannerOptions
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
  if (!isTravelMission(value.goal)) {
    throw new Error('MissionOS is a travel-only AI agent. Ask about flights, hotels, places, destination research, or a trip itinerary.')
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

export function missingMissionApiKeys(configuration: {
  geminiApiKey?: string
  serpApiApiKey?: string
}): string[] {
  const missing: string[] = []
  if (!configuration.geminiApiKey?.trim()) missing.push('GEMINI_API_KEY')
  if (!configuration.serpApiApiKey?.trim()) missing.push('SERPAPI_API_KEY')
  return missing
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
  const source = typeof sourceValue === 'string' && sourceValue.trim()
    ? sourceValue.trim()
    : url ? sourceForUrl(url) : undefined
  const title = [value.title, value.name, value.flightNumber]
    .find((candidate): candidate is string => typeof candidate === 'string' && Boolean(candidate.trim()))

  if (url || source || title) {
    evidence.push({
      stepId,
      toolId,
      ...(title ? { title: title.trim() } : {}),
      ...(url ? { url } : {}),
      source: source ?? (serpApiToolIds.has(toolId) ? 'SerpApi' : toolId),
      relevantData: value,
    })
  }
  for (const item of Object.values(value)) collectEvidence(item, stepId, toolId, evidence)
}

interface PricedOption {
  amount: number
  currency?: string
  toolId: string
  data: Record<string, unknown>
}

function collectPricedOptions(
  value: unknown,
  toolId: string,
  inheritedCurrency: string | undefined,
  options: PricedOption[],
): void {
  if (Array.isArray(value)) {
    for (const item of value) collectPricedOptions(item, toolId, inheritedCurrency, options)
    return
  }
  if (!isRecord(value)) return

  const currency = typeof value.currency === 'string' ? value.currency : inheritedCurrency
  const priceValue = value.price ?? value.total_price ?? value.total_cost ?? value.amount
  const amount = typeof priceValue === 'number'
    ? priceValue
    : typeof priceValue === 'string'
      ? Number(priceValue.replace(/[^\d.]/g, ''))
      : Number.NaN
  if (Number.isFinite(amount) && amount >= 0) {
    options.push({ amount, ...(currency ? { currency } : {}), toolId, data: value })
  }

  for (const [key, item] of Object.entries(value)) {
    if (!['price', 'total_price', 'total_cost', 'amount'].includes(key)) {
      collectPricedOptions(item, toolId, currency, options)
    }
  }
}

function noMatchResult(
  goal: MissionGoal,
  observations: readonly ToolExecutionResult[],
  assessment: ConstraintAssessment,
): Record<string, unknown> {
  const constraints = goal.metadata?.missionConstraints
  const constraintValue = isRecord(constraints) ? constraints[assessment.constraint] : undefined
  const budget = assessment.constraint.toLowerCase() === 'budget' && isRecord(constraintValue)
    ? constraintValue
    : undefined
  const expectedCurrency = typeof budget?.currency === 'string' ? budget.currency.toUpperCase() : undefined
  const options: PricedOption[] = []
  for (const observation of observations) {
    if (observation.ok) collectPricedOptions(observation.output, observation.toolId, undefined, options)
  }
  const comparableOptions = expectedCurrency
    ? options.filter((option) => option.currency?.toUpperCase() === expectedCurrency)
    : options
  const cheapest = comparableOptions.sort((left, right) => left.amount - right.amount)[0]
  const priceLabel = cheapest
    ? `${cheapest.currency ?? expectedCurrency ?? 'Currency unknown'} ${cheapest.amount.toLocaleString('en-IN')}`
    : undefined
  const link = cheapest && [cheapest.data.link, cheapest.data.url, cheapest.data.placeLink]
    .find((value): value is string => typeof value === 'string' && /^https?:\/\//i.test(value))

  const alternatives = assessment.constraint.toLowerCase() === 'budget'
    ? [
        ...(priceLabel ? [`Raise the budget to at least ${priceLabel}, the cheapest observed option.`] : []),
        'Try nearby travel dates, when fares may be lower.',
        'Consider nearby airports, different departure times, or itineraries with a stop.',
      ]
    : [
        `Relax or change the ${assessment.constraint} constraint and search again.`,
        'Consider reasonable trade-offs in nearby dates, locations, or preferences.',
      ]

  return {
    status: 'no_match',
    summary: `No matching option was found because the ${assessment.constraint} constraint was violated. ${priceLabel ? `The cheapest observed option was ${priceLabel}.` : 'No comparable priced option was available.'}`,
    constraint: {
      id: assessment.constraint,
      expected: constraintValue,
      status: assessment.status,
      reason: assessment.reason,
      ...(cheapest ? {
        actual: {
          cheapestObserved: cheapest.amount,
          currency: cheapest.currency ?? expectedCurrency,
        },
      } : {}),
    },
    ...(cheapest ? {
      cheapestOption: {
        ...cheapest.data,
        ...(link ? { link } : {}),
        toolId: cheapest.toolId,
      },
    } : {}),
    alternatives,
  }
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

  const constraintAssessments = state.constraintHistory.at(-1)?.assessments ?? []
  const terminalViolation = constraintAssessments.find((item) => item.status === 'violated')
  const constraintBlockedReplan = state.replanReasons.some((reason) =>
    reason.startsWith('Constraints need resolution:'),
  )
  const noMatchAssessment = state.status === 'failed' && terminalViolation && constraintBlockedReplan
    ? terminalViolation
    : undefined
  const failures: MissionFailure[] = state.observations.flatMap((observation) => {
    if (observation.ok) return []
    return [{
      source: 'tool' as const,
      message: observation.error,
      stepId: observation.stepId,
      toolId: observation.toolId,
    }]
  })
  if (state.failureReason && !noMatchAssessment && !failures.some((failure) => state.failureReason?.includes(failure.message))) {
    const source: MissionFailure['source'] = state.failureReason.startsWith('Configuration required:')
      ? 'configuration'
      : state.failureReason.startsWith('Planning failed:') ? 'planner'
      : state.failureReason.startsWith('Constraint evaluation failed:')
        ? 'constraint'
        : state.failureReason.startsWith('Constraints need resolution:') ? 'constraint'
        : state.failureReason.startsWith('Tool execution failed:') ? 'tool' : 'mission'
    failures.push({ source, message: state.failureReason })
  }

  const evidence: MissionEvidence[] = []
  for (const observation of state.observations) {
    if (observation.ok) collectEvidence(observation.output, observation.stepId, observation.toolId, evidence)
  }
  const verifiedFacts: MissionVerifiedFact[] = evidence.map((item) => ({
    claim: item.title ?? `Observed result from ${item.source ?? item.toolId}`,
    toolId: item.toolId,
    ...(item.source ? { source: item.source } : {}),
    ...(item.url ? { url: item.url } : {}),
    relevantData: item.relevantData,
  }))
  const resultRecord = isRecord(state.finalResult) ? state.finalResult : undefined
  const assumptions = Array.isArray(resultRecord?.assumptions)
    ? resultRecord.assumptions.filter((item): item is string => typeof item === 'string')
    : []
  const plannerMissingInformation = state.planningHistory.at(-1)?.missingInformation ?? []
  const constraintMissingInformation = constraintAssessments
    .filter((item) => item.status === 'unknown')
    .map((item) => `${item.constraint}: ${item.reason}`)
  const missingInformation = [...new Set([...plannerMissingInformation, ...constraintMissingInformation])]
  const hasUnknownConstraints = constraintAssessments.some((item) => item.status === 'unknown')
  const plannerNeedsInformation = state.planningHistory.at(-1)?.decision === 'replan'
  const status = noMatchAssessment
    ? 'no_match'
    : state.status === 'failed' && (
    hasUnknownConstraints || missingInformation.length > 0 || plannerNeedsInformation
  )
    ? 'needs_information'
    : state.status
  const finalResult = noMatchAssessment
    ? noMatchResult(goal, state.observations, noMatchAssessment)
    : state.finalResult

  return {
    missionId,
    goal: request.goal,
    constraints: request.constraints ?? {},
    status,
    ...(state.plan ? { currentPlan: state.plan } : {}),
    planHistory: state.planningHistory,
    completedTasks,
    toolCalls,
    observations: state.observations,
    failures,
    replans: state.replanReasons.map((reason, index) => ({ iteration: index + 1, reason })),
    constraintHistory: state.constraintHistory,
    constraintAssessments,
    evidence,
    verifiedFacts,
    assumptions,
    missingInformation,
    ...(finalResult !== undefined ? { finalResult } : {}),
    iterationCount: state.observations.length,
  }
}

export class MissionExecutionService {
  constructor(private readonly options: MissionExecutionOptions = {}) {}

  async execute(rawRequest: unknown): Promise<MissionState> {
    let request = validateMissionRequest(rawRequest)
    const missionId = this.options.createMissionId?.() ?? randomUUID()
    let goal: MissionGoal = {
      id: missionId,
      description: request.goal,
      constraints: describeConstraints(request.constraints ?? {}),
      metadata: { missionConstraints: request.constraints ?? {} },
    }
    const registry = new ToolRegistry()
    let initialState = AgentState.start(goal)

    if (!this.options.plannerStrategy) {
      const geminiApiKey = this.options.gemini?.apiKey ?? environment.geminiApiKey
      const serpApiApiKey = this.options.serpApi?.apiKey ?? environment.serpApiApiKey
      const missingKeys = missingMissionApiKeys({
        geminiApiKey,
        serpApiApiKey,
      })
      const forcedMockProviders = [
        ...(this.options.gemini?.mockMode === true ? ['GEMINI_MOCK_MODE'] : []),
        ...(this.options.serpApi?.mockMode === true ? ['SERPAPI_MOCK_MODE'] : []),
      ]
      if (missingKeys.length > 0 || forcedMockProviders.length > 0) {
        const configurationProblems = [
          ...(missingKeys.length ? [`missing ${missingKeys.join(' and ')}`] : []),
          ...(forcedMockProviders.length ? [`disable ${forcedMockProviders.join(' and ')}`] : []),
        ]
        const state = initialState.fail(
          `Configuration required: ${configurationProblems.join('; ')} for real mission execution.`,
        )
        return buildMissionState(missionId, request, goal, state)
      }
    }

    try {
      registerSerpApiTools(registry, this.options.serpApi)
      this.options.registerTools?.(registry)

      const requirements = extractMissionRequirements(
        request.goal,
        request.constraints ?? {},
        registry.list(),
      )
      request = { ...request, constraints: requirements.constraints }
      goal = {
        ...goal,
        constraints: describeConstraints(requirements.constraints),
        metadata: {
          missionConstraints: requirements.constraints,
          missionRequirements: requirements,
        },
      }
      initialState = AgentState.start(goal)

      const agentOptions: AgentOptions = {
        maxIterations: 12,
        timeoutMs: 60_000,
        maxReplans: 8,
        plannerDecidesCompletion: true,
        constraintEvaluator: this.options.constraintEvaluator ?? new MissionConstraintEvaluator(),
        ...this.options.agent,
        ...(requirements.missingInformation.length > 0 ? { maxReplans: 0 } : {}),
      }
      const primaryPlanningStrategy = this.options.plannerStrategy ?? createGeminiPlanningStrategy({
        ...this.options.gemini,
        fallbackMode: false,
      })
      const planningStrategy = new FallbackPlanningStrategy(
        primaryPlanningStrategy,
        new CapabilityPlanningStrategy(),
      )
      const agent = new Agent(
        registry,
        new Planner(new UserDateGuardStrategy(
          planningStrategy,
          requirements.explicitDates,
          requirements.missingInformation,
        )),
        undefined,
        undefined,
        agentOptions,
      )
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

class UserDateGuardStrategy implements PlanningStrategy {
  constructor(
    private readonly strategy: PlanningStrategy,
    private readonly explicitDates: readonly string[],
    private readonly missingInformation: readonly string[],
  ) {}

  async createPlan(request: Parameters<PlanningStrategy['createPlan']>[0]): Promise<AgentPlan> {
    if (this.missingInformation.length > 0) {
      return {
        goalId: request.goal.id,
        decision: 'replan',
        steps: [],
        rationale: 'Required travel details are missing, so live searches cannot be run safely yet.',
        missingInformation: this.missingInformation,
      }
    }
    const plan = await this.strategy.createPlan(request)
    if (plan.decision === 'replan' || plan.decision === 'complete') return plan

    for (const step of plan.steps) {
      const tool = request.tools.find((candidate) => candidate.id === step.toolId)
      const requiredDateFields = tool?.inputSchema?.required?.filter((field) =>
        /date|check.?in|check.?out/i.test(field),
      ) ?? []
      const input = step.input
      if (!isRecord(input)) continue
      const missingDates = requiredDateFields.filter((field) =>
        typeof input[field] !== 'string' || !this.explicitDates.includes(input[field] as string),
      )
      if (missingDates.length > 0) {
        return {
          goalId: request.goal.id,
          decision: 'replan',
          steps: [],
          rationale: 'Exact travel dates were not provided, so date-dependent searches cannot be verified safely.',
          missingInformation: missingDates.map((field) => `Provide an exact date for ${field} before calling ${tool?.id ?? step.toolId}.`),
        }
      }
    }
    return plan
  }
}