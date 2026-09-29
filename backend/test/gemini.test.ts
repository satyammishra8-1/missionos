import assert from 'node:assert/strict'
import test from 'node:test'
import { AgentState } from '../src/agent/AgentState.js'
import { mockGoalTool } from '../src/agent/mockTools.js'
import { CapabilityPlanningStrategy, Planner } from '../src/agent/Planner.js'
import { ToolRegistry } from '../src/agent/ToolRegistry.js'
import type { MissionGoal, RegisteredTool } from '../src/agent/types.js'
import {
  FallbackPlanningStrategy,
  GeminiPlannerStrategy,
  parseGeminiFunctionCall,
} from '../src/services/gemini/GeminiPlannerStrategy.js'
import { MockGeminiClient } from '../src/services/gemini/MockGeminiClient.js'
import type {
  GeminiFunctionCallingClient,
  GeminiFunctionCallingRequest,
  GeminiFunctionCall,
} from '../src/services/gemini/types.js'
import { createGeminiAgent } from '../src/services/gemini/index.js'

const goal: MissionGoal = {
  id: 'mission-1',
  description: 'Find accessible community venues for a workshop',
  constraints: [{ id: 'budget', description: 'Stay within the stated budget' }],
}

function createRegistry(...definitions: (typeof mockGoalTool)[]) {
  const registry = new ToolRegistry()
  for (const definition of definitions) registry.register(definition)
  return registry
}

function createRequest(tools: readonly RegisteredTool[], replanCount = 0) {
  const state = AgentState.start(goal)
  return {
    goal,
    tools,
    observations: state.observations,
    state: state.snapshot(),
    excludedToolIds: [],
    replanCount,
  }
}

class FixedFunctionCallingClient implements GeminiFunctionCallingClient {
  lastRequest?: GeminiFunctionCallingRequest

  constructor(private readonly call: GeminiFunctionCall) {}

  async generateFunctionCall(request: GeminiFunctionCallingRequest) {
    this.lastRequest = request
    return this.call
  }
}

test('model response parsing converts a registered function call to a plan step', () => {
  const registry = createRegistry(mockGoalTool)
  const tool = registry.get(mockGoalTool.id)
  assert.ok(tool)

  const plan = parseGeminiFunctionCall(
    {
      name: 'mission_tool_0',
      arguments: {
        objective: 'Check which venues meet the access needs',
        missing_information: ['Venue capacity'],
        input: { goal: goal.description },
      },
    },
    goal.id,
    [{ functionName: 'mission_tool_0', tool }],
    0,
  )

  assert.equal(plan.decision, 'execute')
  assert.equal(plan.steps[0]?.toolId, mockGoalTool.id)
  assert.deepEqual(plan.steps[0]?.input, { goal: goal.description })
  assert.deepEqual(plan.missingInformation, ['Venue capacity'])
})

test('model response parsing converts a replan call to a replan decision', () => {
  const plan = parseGeminiFunctionCall(
    {
      name: 'mission_replan',
      arguments: {
        reason: 'The venue capacity is still unknown.',
        missing_information: ['Venue capacity'],
      },
    },
    goal.id,
    [],
    1,
  )

  assert.equal(plan.goalId, goal.id)
  assert.equal(plan.decision, 'replan')
  assert.deepEqual(plan.steps, [])
  assert.match(plan.rationale ?? '', /venue capacity/i)
  assert.deepEqual(plan.missingInformation, ['Venue capacity'])
})

test('model response parsing converts a completion call to a completion decision', () => {
  const plan = parseGeminiFunctionCall(
    {
      name: 'mission_complete',
      arguments: {
        summary: 'Found an accessible venue within budget.',
        missing_information: [],
      },
    },
    goal.id,
    [],
    1,
  )

  assert.equal(plan.goalId, goal.id)
  assert.equal(plan.decision, 'complete')
  assert.deepEqual(plan.steps, [])
  assert.equal(plan.finalResult, 'Found an accessible venue within budget.')
})

test('planner sends the mission context and chooses the model-selected registered tool', async () => {
  const alternativeTool: typeof mockGoalTool = {
    ...mockGoalTool,
    id: 'mock-alternative',
    description: 'Alternative registered tool for selection coverage.',
  }
  const registry = createRegistry(mockGoalTool, alternativeTool)
  const client = new FixedFunctionCallingClient({
    name: 'mission_tool_1',
    arguments: {
      objective: 'Investigate the venue constraints',
      input: { goal: goal.description },
    },
  })
  const strategy = new GeminiPlannerStrategy(client, 'mock-model')
  const plan = await new Planner(strategy).createPlan(createRequest(registry.list()))

  assert.equal(plan.steps[0]?.toolId, alternativeTool.id)
  assert.equal(client.lastRequest?.model, 'mock-model')
  assert.equal(client.lastRequest?.context.mission.description, goal.description)
  assert.deepEqual(client.lastRequest?.context.constraints, goal.constraints)
  assert.deepEqual(client.lastRequest?.context.previousObservations, [])
  assert.equal(client.lastRequest?.context.agentState.status, 'planning')
  assert.equal(client.lastRequest?.functions[0]?.name, 'mission_complete')
  assert.equal(client.lastRequest?.functions[3]?.name, 'mission_tool_1')
})

test('unknown and malformed model tool calls are rejected', () => {
  const registry = createRegistry(mockGoalTool)
  const tool = registry.get(mockGoalTool.id)
  assert.ok(tool)
  const bindings = [{ functionName: 'mission_tool_0', tool }]

  assert.throws(
    () => parseGeminiFunctionCall(
      { name: 'mission_tool_99', arguments: { objective: 'x', input: {} } },
      goal.id,
      bindings,
      0,
    ),
    /unavailable function/,
  )
  assert.throws(
    () => parseGeminiFunctionCall(
      {
        name: 'mission_tool_0',
        arguments: { objective: 'Investigate', input: { goal: 42 } },
      },
      goal.id,
      bindings,
      0,
    ),
    /invalid input/,
  )
})

test('model can complete the mission after observing a tool result in mock mode', async () => {
  const registry = createRegistry(mockGoalTool)
  const agent = createGeminiAgent(registry, {
    planner: { apiKey: '', mockMode: true, fallbackMode: false, model: 'mock-model' },
  })
  const state = await agent.run(goal)

  assert.equal(state.status, 'completed')
  assert.equal(state.observations.length, 1)
  assert.equal(state.planHistory.length, 1)
  assert.match(String(state.finalResult), /acknowledged/)
})

test('mock client requests re-planning when there is no compatible tool', async () => {
  const client = new MockGeminiClient()
  const tool = createRegistry(mockGoalTool).get(mockGoalTool.id)
  assert.ok(tool)
  const request: GeminiFunctionCallingRequest = {
    model: 'mock-model',
    systemInstruction: '',
    context: {
      mission: goal,
      agentState: AgentState.start(goal).snapshot(),
      previousObservations: [],
      constraints: goal.constraints,
      excludedToolIds: [mockGoalTool.id],
      replanCount: 1,
      availableTools: [],
    },
    functions: [],
    toolBindings: [],
  }

  const call = await client.generateFunctionCall(request)
  assert.equal(call.name, 'mission_replan')
})

test('model failure falls back to the capability planner', async () => {
  const failingClient: GeminiFunctionCallingClient = {
    generateFunctionCall: async () => {
      throw new Error('Gemini unavailable')
    },
  }
  const strategy = new FallbackPlanningStrategy(
    new GeminiPlannerStrategy(failingClient, 'mock-model'),
    new CapabilityPlanningStrategy(),
  )
  const registry = createRegistry(mockGoalTool)
  const plan = await strategy.createPlan(createRequest(registry.list()))

  assert.equal(plan.steps[0]?.toolId, mockGoalTool.id)
  assert.equal(plan.evaluateAfterExecution, false)
  assert.match(plan.rationale ?? '', /fallback/)
})