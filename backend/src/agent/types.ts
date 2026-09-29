export interface MissionConstraint {
  id: string
  description: string
}

export interface MissionGoal {
  id: string
  description: string
  constraints?: readonly MissionConstraint[]
  metadata?: Readonly<Record<string, unknown>>
}

export interface ToolObservation {
  stepId: string
  toolId: string
  ok: boolean
  output?: unknown
  error?: string
}

export type ToolExecutionResult =
  | { stepId: string; toolId: string; ok: true; output: unknown }
  | { stepId: string; toolId: string; ok: false; error: string }

export interface ToolExecutionContext {
  goal: MissionGoal
  observations: readonly ToolObservation[]
}

export interface ToolInputRequest {
  goal: MissionGoal
  observations: readonly ToolObservation[]
}

export interface ToolDefinition<Input, Output> {
  id: string
  description: string
  inputSchema?: JsonSchema
  supports(goal: MissionGoal): boolean
  createInput(request: ToolInputRequest): Input
  parseInput(input: unknown): Input
  execute(input: Input, context: ToolExecutionContext): Promise<Output> | Output
}

export interface RegisteredTool {
  id: string
  description: string
  inputSchema?: JsonSchema
  supports(goal: MissionGoal): boolean
  createInput(request: ToolInputRequest): unknown
  validateInput(input: unknown): unknown
  execute(input: unknown, context: ToolExecutionContext): Promise<unknown>
}

export interface JsonSchema {
  type: 'object' | 'array' | 'string' | 'number' | 'integer' | 'boolean'
  description?: string
  properties?: Readonly<Record<string, JsonSchema>>
  required?: readonly string[]
  items?: JsonSchema
  enum?: readonly (string | number | boolean)[]
  additionalProperties?: boolean
}

export interface PlanStep {
  id: string
  toolId: string
  objective: string
  input: unknown
}

export interface AgentPlan {
  goalId: string
  steps: readonly PlanStep[]
  decision?: 'execute' | 'replan' | 'complete'
  rationale?: string
  missingInformation?: readonly string[]
  finalResult?: unknown
  evaluateAfterExecution?: boolean
}

export interface ConstraintEvaluation {
  satisfied: boolean
  violations: readonly string[]
  assessments?: readonly ConstraintAssessment[]
}

export type ConstraintStatus = 'satisfied' | 'violated' | 'unknown'

export interface ConstraintAssessment {
  constraint: string
  status: ConstraintStatus
  reason: string
}

export type AgentStatus =
  | 'planning'
  | 'executing'
  | 'replanning'
  | 'completed'
  | 'failed'

export interface AgentStateSnapshot {
  goal: MissionGoal
  status: AgentStatus
  plan?: AgentPlan
  planHistory: readonly AgentPlan[]
  stepIndex: number
  observations: readonly ToolExecutionResult[]
  constraintEvaluation?: ConstraintEvaluation
  constraintHistory: readonly ConstraintEvaluation[]
  excludedToolIds: readonly string[]
  replanReasons: readonly string[]
}