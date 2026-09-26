import type {
  AgentStateSnapshot,
  JsonSchema,
  MissionGoal,
  RegisteredTool,
  ToolObservation,
} from '../../agent/types.js'

export interface GeminiFunctionDeclaration {
  name: string
  description: string
  parameters: JsonSchema
}

export interface GeminiFunctionCall {
  name: string
  arguments: Record<string, unknown>
}

export interface GeminiToolBinding {
  functionName: string
  tool: RegisteredTool
}

export interface GeminiPlanningContext {
  mission: MissionGoal
  agentState: AgentStateSnapshot
  previousObservations: readonly ToolObservation[]
  constraints: MissionGoal['constraints']
  excludedToolIds: readonly string[]
  replanCount: number
  availableTools: readonly {
    id: string
    description: string
    inputSchema?: JsonSchema
  }[]
}

export interface GeminiFunctionCallingRequest {
  model: string
  systemInstruction: string
  context: GeminiPlanningContext
  functions: readonly GeminiFunctionDeclaration[]
  toolBindings: readonly GeminiToolBinding[]
}

export interface GeminiFunctionCallingClient {
  generateFunctionCall(
    request: GeminiFunctionCallingRequest,
  ): Promise<GeminiFunctionCall>
}