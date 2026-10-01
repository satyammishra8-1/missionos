import { Agent, type AgentOptions } from '../../agent/Agent.js'
import { Planner } from '../../agent/Planner.js'
import { ToolRegistry } from '../../agent/ToolRegistry.js'
import { environment } from '../../config/environment.js'
import { GeminiApiClient } from './GeminiApiClient.js'
import { FallbackPlanningStrategy, GeminiPlannerStrategy } from './GeminiPlannerStrategy.js'
import { MockGeminiClient } from './MockGeminiClient.js'
import type { PlanningStrategy } from '../../agent/Planner.js'

export interface GeminiPlannerOptions {
  apiKey?: string
  model?: string
  mockMode?: boolean
  fallbackMode?: boolean
}

export interface GeminiAgentFactoryOptions {
  planner?: GeminiPlannerOptions
  agent?: AgentOptions
}

export function createGeminiPlanningStrategy(
  options: GeminiPlannerOptions = {},
): PlanningStrategy {
  const apiKey = options.apiKey ?? environment.geminiApiKey
  const mockMode = options.mockMode ?? (environment.geminiMockMode && !apiKey)
  const model = options.model ?? environment.geminiModel

  if (!mockMode && !apiKey) {
    throw new Error('GEMINI_API_KEY is required when GEMINI_MOCK_MODE is false')
  }

  const client = mockMode ? new MockGeminiClient() : new GeminiApiClient(apiKey!)
  const strategy = new GeminiPlannerStrategy(client, model)

  return (options.fallbackMode ?? environment.geminiFallbackMode)
    ? new FallbackPlanningStrategy(strategy)
    : strategy
}

export function createGeminiPlanner(options: GeminiPlannerOptions = {}): Planner {
  return new Planner(createGeminiPlanningStrategy(options))
}

export function createGeminiAgent(
  registry: ToolRegistry,
  options: GeminiAgentFactoryOptions = {},
): Agent {
  return new Agent(
    registry,
    createGeminiPlanner(options.planner),
    undefined,
    undefined,
    { ...options.agent, plannerDecidesCompletion: true },
  )
}