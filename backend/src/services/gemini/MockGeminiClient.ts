import type { GeminiFunctionCallingClient, GeminiFunctionCall } from './types.js'

export class MockGeminiClient implements GeminiFunctionCallingClient {
  async generateFunctionCall(request: Parameters<GeminiFunctionCallingClient['generateFunctionCall']>[0]): Promise<GeminiFunctionCall> {
    const previousObservation = request.context.previousObservations.at(-1)

    if (previousObservation?.ok) {
      return {
        name: 'mission_complete',
        arguments: {
          summary: typeof previousObservation.output === 'string'
            ? previousObservation.output
            : JSON.stringify(previousObservation.output),
          missing_information: [],
        },
      }
    }

    const binding = request.toolBindings[0]
    if (!binding) {
      return {
        name: 'mission_replan',
        arguments: {
          reason: 'No available mock tool can investigate this mission.',
          missing_information: ['A compatible tool is required.'],
        },
      }
    }

    const input = binding.tool.createInput({
      goal: request.context.mission,
      observations: request.context.previousObservations,
    })

    return {
      name: binding.functionName,
      arguments: {
        objective: request.context.mission.description,
        missing_information: [],
        input: input as Record<string, unknown>,
      },
    }
  }
}