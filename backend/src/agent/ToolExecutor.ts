import type { PlanStep, ToolExecutionContext, ToolExecutionResult } from './types.js'
import { ToolRegistry } from './ToolRegistry.js'

export class ToolExecutor {
  constructor(private readonly registry: ToolRegistry) {}

  async execute(
    step: PlanStep,
    context: ToolExecutionContext,
  ): Promise<ToolExecutionResult> {
    const tool = this.registry.get(step.toolId)

    if (!tool) {
      return {
        stepId: step.id,
        toolId: step.toolId,
        ok: false,
        error: `Tool is not registered: ${step.toolId}`,
      }
    }

    try {
      const output = await tool.execute(step.input, context)
      return { stepId: step.id, toolId: step.toolId, ok: true, output }
    } catch (error) {
      return {
        stepId: step.id,
        toolId: step.toolId,
        ok: false,
        error: error instanceof Error ? error.message : 'Tool execution failed',
      }
    }
  }
}