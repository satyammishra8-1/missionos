import assert from 'node:assert/strict'
import type { AddressInfo } from 'node:net'
import express from 'express'
import test from 'node:test'
import type { ConstraintEvaluator } from '../src/agent/Agent.js'
import type { PlanningRequest, PlanningStrategy } from '../src/agent/Planner.js'
import { ToolRegistry } from '../src/agent/ToolRegistry.js'
import type { AgentPlan, ToolDefinition } from '../src/agent/types.js'
import { createMissionRouter } from '../src/routes/missions.js'
import { GeminiPlannerStrategy } from '../src/services/gemini/GeminiPlannerStrategy.js'
import type { GeminiFunctionCallingClient } from '../src/services/gemini/types.js'
import {
  createMissionExecutionService,
  type MissionExecutionService,
} from '../src/services/missions/MissionExecutionService.js'

const missionRequest = {
  goal: 'Find useful information for planning a city visit',
  constraints: { budget: 500, accessible: true },
}

function createTool(
  id: string,
  execute: (input: { value: string }) => unknown = (input) => ({ value: input.value }),
): ToolDefinition<{ value: string }, unknown> {
  return {
    id,
    description: `Test tool ${id}`,
    supports: () => true,
    createInput: ({ goal }) => ({ value: goal.description }),
    parseInput: (input) => {
      if (
        typeof input !== 'object' || input === null ||
        !('value' in input) || typeof input.value !== 'string'
      ) throw new Error('value must be a string')
      return { value: input.value }
    },
    execute: (input) => execute(input),
  }
}

function planTool(request: PlanningRequest, toolId: string, stepId: string): AgentPlan {
  const tool = request.tools.find((candidate) => candidate.id === toolId)
  assert.ok(tool)
  return {
    goalId: request.goal.id,
    steps: [{
      id: stepId,
      toolId,
      objective: `Run ${toolId}`,
      input: { value: request.goal.description },
    }],
  }
}

function missionService(
  plannerStrategy: PlanningStrategy,
  options: {
    maxIterations?: number
    timeoutMs?: number
    constraintEvaluator?: ConstraintEvaluator
    registerTools?: (registry: ToolRegistry) => void
  } = {},
): MissionExecutionService {
  const { maxIterations, timeoutMs, ...serviceOptions } = options
  return createMissionExecutionService({
    plannerStrategy,
    serpApi: { apiKey: '', mockMode: true },
    createMissionId: () => 'mission-test-id',
    ...serviceOptions,
    agent: { maxIterations, timeoutMs },
  })
}

test('mission executes multiple dynamically selected tools and collects evidence', async () => {
  const planner: PlanningStrategy = {
    createPlan: (request) => {
      if (request.observations.length === 0) return planTool(request, 'mission-search', 'search-1')
      if (request.observations.length === 1) return planTool(request, 'mission-maps', 'maps-1')
      return {
        goalId: request.goal.id,
        decision: 'complete',
        steps: [],
        finalResult: { summary: 'Research complete' },
      }
    },
  }
  const service = missionService(planner, {
    registerTools: (registry) => {
      registry.register(createTool('mission-search', () => ({
        results: [{ title: 'Visitor guide', source: 'guide.example', link: 'https://guide.example/visit' }],
      })))
      registry.register(createTool('mission-maps', () => ({ places: [{ name: 'City museum', placeLink: 'https://maps.example/museum' }] })))
    },
  })

  const state = await service.execute(missionRequest)

  assert.equal(state.status, 'completed')
  assert.equal(state.goal, missionRequest.goal)
  assert.deepEqual(state.constraints, missionRequest.constraints)
  assert.deepEqual(state.toolCalls.map((call) => call.toolId), ['mission-search', 'mission-maps'])
  assert.equal(state.completedTasks.length, 2)
  assert.equal(state.iterationCount, 2)
  assert.equal(state.finalResult && (state.finalResult as { summary: string }).summary, 'Research complete')
  assert.deepEqual(state.evidence.map((item) => item.url), [
    'https://guide.example/visit',
    'https://maps.example/museum',
  ])
  assert.equal(state.evidence[0]?.source, 'guide.example')
})

test('mission replans after a tool failure and recovers with another tool', async () => {
  const planner: PlanningStrategy = {
    createPlan: (request) => {
      if (request.excludedToolIds.includes('mission-unavailable')) {
        if (request.observations.length > 1) {
          return { goalId: request.goal.id, decision: 'complete', steps: [], finalResult: 'Recovered' }
        }
        return planTool(request, 'mission-recovery', 'recovery-1')
      }
      return planTool(request, 'mission-unavailable', 'unavailable-1')
    },
  }
  const service = missionService(planner, {
    registerTools: (registry) => {
      registry.register(createTool('mission-unavailable', () => { throw new Error('temporary outage') }))
      registry.register(createTool('mission-recovery'))
    },
  })

  const state = await service.execute({ goal: missionRequest.goal })

  assert.equal(state.status, 'completed')
  assert.deepEqual(state.replans, [{ iteration: 1, reason: 'Tool mission-unavailable failed: temporary outage' }])
  assert.deepEqual(state.toolCalls.map((call) => call.status), ['failed', 'completed'])
  assert.equal(state.failures[0]?.source, 'tool')
})

test('mission replans when constraint evaluation reports a violation', async () => {
  const planner: PlanningStrategy = {
    createPlan: (request) => request.observations.length === 0
      ? planTool(request, 'constraint-search', 'constraint-1')
      : request.observations.length === 1
        ? planTool(request, 'constraint-more-evidence', 'constraint-2')
        : { goalId: request.goal.id, decision: 'complete', steps: [], finalResult: 'Constraints checked' },
  }
  let evaluations = 0
  const constraintEvaluator: ConstraintEvaluator = {
    evaluate: () => ++evaluations === 1
      ? { satisfied: false, violations: ['budget evidence is insufficient'] }
      : { satisfied: true, violations: [] },
  }
  const service = missionService(planner, {
    constraintEvaluator,
    registerTools: (registry) => {
      registry.register(createTool('constraint-search'))
      registry.register(createTool('constraint-more-evidence'))
    },
  })

  const state = await service.execute(missionRequest)

  assert.equal(state.status, 'completed')
  assert.match(state.replans[0]?.reason ?? '', /budget evidence is insufficient/)
  assert.deepEqual(state.toolCalls.map((call) => call.toolId), [
    'constraint-search',
    'constraint-more-evidence',
  ])
})

test('mission records tool failure and reaches failed status when recovery is unavailable', async () => {
  const planner: PlanningStrategy = {
    createPlan: (request) => planTool(request, 'mission-always-fails', 'failure-1'),
  }
  const service = missionService(planner, {
    agent: { maxReplans: 0 },
    registerTools: (registry) => {
      registry.register(createTool('mission-always-fails', () => { throw new Error('provider down') }))
    },
  })

  const state = await service.execute({ goal: missionRequest.goal })

  assert.equal(state.status, 'failed')
  assert.equal(state.failures[0]?.message, 'provider down')
  assert.equal(state.toolCalls[0]?.status, 'failed')
})

test('mission stops when the configured tool iteration limit is reached', async () => {
  const planner: PlanningStrategy = {
    createPlan: (request) => ({
      goalId: request.goal.id,
      evaluateAfterExecution: false,
      steps: [
        { id: 'iteration-1', toolId: 'iteration-tool', objective: 'first', input: { value: 'first' } },
        { id: 'iteration-2', toolId: 'iteration-tool', objective: 'second', input: { value: 'second' } },
      ],
    }),
  }
  const service = missionService(planner, {
    maxIterations: 1,
    registerTools: (registry) => registry.register(createTool('iteration-tool')),
  })

  const state = await service.execute({ goal: missionRequest.goal })

  assert.equal(state.status, 'failed')
  assert.equal(state.iterationCount, 1)
  assert.match(state.failures[0]?.message ?? '', /Maximum tool execution iterations/)
})

test('mission handles invalid Gemini tool calls without throwing', async () => {
  const invalidCallClient: GeminiFunctionCallingClient = {
    generateFunctionCall: async () => ({
      name: 'mission_tool_not_registered',
      arguments: { objective: 'Call an unavailable tool', input: {} },
    }),
  }
  const strategy = new GeminiPlannerStrategy(invalidCallClient, 'test-model')
  const service = missionService(strategy)

  const state = await service.execute({ goal: missionRequest.goal })

  assert.equal(state.status, 'failed')
  assert.match(state.failures[0]?.message ?? '', /unavailable function/)
})

test('mission handles planner timeout and returns a failed state', async () => {
  const slowPlanner: PlanningStrategy = {
    createPlan: () => new Promise<AgentPlan>(() => undefined),
  }
  const service = missionService(slowPlanner, { timeoutMs: 10 })

  const state = await service.execute({ goal: missionRequest.goal })

  assert.equal(state.status, 'failed')
  assert.match(state.failures[0]?.message ?? '', /timed out during planning/)
})

async function withMissionServer<T>(
  service: MissionExecutionService,
  action: (baseUrl: string) => Promise<T>,
): Promise<T> {
  const app = express()
  app.use(express.json())
  app.use('/api/missions', createMissionRouter(service))
  const server = app.listen(0)
  try {
    await new Promise<void>((resolve, reject) => {
      server.once('listening', resolve)
      server.once('error', reject)
    })
    const address = server.address() as AddressInfo
    return await action(`http://127.0.0.1:${address.port}`)
  } finally {
    server.closeAllConnections()
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve())
    })
  }
}

test('POST /api/missions returns the mission response shape', async () => {
  const planner: PlanningStrategy = {
    createPlan: (request) => ({
      goalId: request.goal.id,
      decision: 'complete',
      steps: [],
      finalResult: { summary: 'Ready', constraints: request.goal.constraints },
    }),
  }
  const service = missionService(planner)

  const payload = await withMissionServer(service, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/missions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(missionRequest),
    })
    assert.equal(response.status, 200)
    return response.json() as Promise<Record<string, unknown>>
  })

  assert.equal(payload.missionId, 'mission-test-id')
  assert.equal(payload.status, 'completed')
  assert.deepEqual(payload.plan, [])
  assert.deepEqual(payload.toolCalls, [])
  assert.deepEqual(payload.findings, [])
  assert.deepEqual(payload.evidence, [])
  assert.deepEqual(payload.result, {
    summary: 'Ready',
    constraints: [
      { id: 'budget', description: 'budget: 500' },
      { id: 'accessible', description: 'accessible: true' },
    ],
  })
})

test('POST /api/missions rejects malformed requests with 400', async () => {
  const service = missionService({
    createPlan: () => { throw new Error('planner should not run for invalid requests') },
  })

  const payload = await withMissionServer(service, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/missions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ goal: '  ', constraints: [] }),
    })
    assert.equal(response.status, 400)
    return response.json() as Promise<{ error: string }>
  })

  assert.match(payload.error, /goal must be a non-empty string/)
})