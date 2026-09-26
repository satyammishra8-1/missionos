import type {
  MissionGoal,
  RegisteredTool,
  ToolDefinition,
  ToolExecutionContext,
  ToolInputRequest,
} from './types.js'

export class ToolRegistry {
  private readonly tools = new Map<string, RegisteredTool>()

  register<Input, Output>(definition: ToolDefinition<Input, Output>): void {
    if (!definition.id.trim()) {
      throw new Error('Tool id must not be empty')
    }

    if (this.tools.has(definition.id)) {
      throw new Error(`Tool is already registered: ${definition.id}`)
    }

    this.tools.set(definition.id, {
      id: definition.id,
      description: definition.description,
      inputSchema: definition.inputSchema,
      supports: (goal: MissionGoal) => definition.supports(goal),
      createInput: (request: ToolInputRequest) => definition.createInput(request),
      validateInput: (input: unknown) => definition.parseInput(input),
      execute: async (input: unknown, context: ToolExecutionContext) =>
        definition.execute(definition.parseInput(input), context),
    })
  }

  get(toolId: string): RegisteredTool | undefined {
    return this.tools.get(toolId)
  }

  list(): readonly RegisteredTool[] {
    return [...this.tools.values()]
  }
}