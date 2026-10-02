export type MissionStatus = 'planning' | 'executing' | 'replanning' | 'completed' | 'failed' | 'needs_information' | 'no_match'

export type ConstraintStatus = 'satisfied' | 'violated' | 'unknown'

export interface ConstraintAssessment {
  constraint: string
  status: ConstraintStatus
  reason: string
}

export interface MissionPlanStep {
  id: string
  toolId: string
  objective: string
  input: unknown
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

export interface MissionFinding {
  stepId: string
  toolId: string
  objective: string
  output: unknown
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

export interface MissionResult {
  summary: unknown
  verifiedFacts: readonly {
    claim: string
    toolId: string
    source?: string
    url?: string
    relevantData: unknown
  }[]
  assumptions: readonly string[]
  missingInformation: readonly string[]
  constraints: readonly ConstraintAssessment[]
}

export interface MissionResponse {
  missionId: string
  status: MissionStatus
  error?: { code: string; message: string } | null
  plan: readonly MissionPlanStep[]
  toolCalls: readonly MissionToolCall[]
  replans: readonly MissionReplan[]
  findings: readonly MissionFinding[]
  evidence: readonly MissionEvidence[]
  result: MissionResult
}

export interface MissionRequest {
  goal: string
  constraints?: Readonly<Record<string, unknown>>
}