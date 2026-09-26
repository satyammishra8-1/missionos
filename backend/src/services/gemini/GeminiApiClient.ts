import { GoogleGenAI } from '@google/genai'
import type {
  GeminiFunctionCallingClient,
  GeminiFunctionCallingRequest,
  GeminiFunctionCall,
} from './types.js'

export class GeminiApiClient implements GeminiFunctionCallingClient {
  private readonly client: GoogleGenAI

  constructor(apiKey: string) {
    this.client = new GoogleGenAI({ apiKey })
  }

  async generateFunctionCall(
    request: GeminiFunctionCallingRequest,
  ): Promise<GeminiFunctionCall> {
    const interaction = await this.client.interactions.create({
      model: request.model,
      system_instruction: request.systemInstruction,
      input: JSON.stringify(request.context),
      tools: request.functions.map((declaration) => ({
        type: 'function' as const,
        name: declaration.name,
        description: declaration.description,
        parameters: declaration.parameters,
      })),
      generation_config: { tool_choice: 'any' },
      store: false,
    })

    const calls = interaction.steps.filter((step) => step.type === 'function_call')
    if (calls.length !== 1) {
      throw new Error(`Gemini must return exactly one function call; received ${calls.length}`)
    }

    const call = calls[0]
    if (!call) {
      throw new Error('Gemini returned no function call')
    }

    return { name: call.name, arguments: call.arguments }
  }
}