import assert from 'node:assert/strict'
import type { AddressInfo } from 'node:net'
import express from 'express'
import test from 'node:test'
import type { AgentOptions, ConstraintEvaluator } from '../src/agent/Agent.js'
import type { PlanningRequest, PlanningStrategy } from '../src/agent/Planner.js'
import { ToolRegistry } from '../src/agent/ToolRegistry.js'
import type { AgentPlan, ToolDefinition } from '../src/agent/types.js'
import { createMissionRouter } from '../src/routes/missions.js'
import { GeminiPlannerStrategy } from '../src/services/gemini/GeminiPlannerStrategy.js'
import type { GeminiFunctionCallingClient } from '../src/services/gemini/types.js'
import {
  createMissionExecutionService,
  missingMissionApiKeys,
  type MissionExecutionService,
} from '../src/services/missions/MissionExecutionService.js'
import { extractMissionRequirements } from '../src/services/missions/MissionRequirementExtractor.js'
import { registerSerpApiTools } from '../src/services/serpapi/index.js'

const missionRequest = {
  goal: 'Find useful information for planning a city visit',
  constraints: {},
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
    agent?: AgentOptions
    registerTools?: (registry: ToolRegistry) => void
  } = {},
): MissionExecutionService {
  const { maxIterations, timeoutMs, agent, ...serviceOptions } = options
  return createMissionExecutionService({
    plannerStrategy,
    serpApi: { apiKey: '', mockMode: true },
    createMissionId: () => 'mission-test-id',
    ...serviceOptions,
    agent: { maxIterations, timeoutMs, ...agent },
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
      registry.register(createTool('mission-maps', () => ({ places: [
        { name: 'City museum', placeLink: 'https://maps.example/museum' },
        { name: 'Unlinked visitor center' },
      ] })))
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
    undefined,
  ])
  assert.equal(state.evidence[0]?.source, 'guide.example')
  assert.equal(state.evidence[0]?.toolId, 'mission-search')
  assert.deepEqual(state.evidence[0]?.relevantData, {
    title: 'Visitor guide',
    source: 'guide.example',
    link: 'https://guide.example/visit',
  })
  assert.equal(state.verifiedFacts[0]?.claim, 'Visitor guide')
  assert.equal(state.verifiedFacts[0]?.url, 'https://guide.example/visit')
  assert.equal(state.evidence[2]?.title, 'Unlinked visitor center')
  assert.equal(state.evidence[2]?.source, 'mission-maps')
  assert.equal(state.evidence[2]?.url, undefined)
  assert.deepEqual(state.assumptions, [])
  assert.deepEqual(state.missingInformation, [])
})

test('mission preserves source, URL, tool, title, and data from a SerpApi result', async () => {
  const service = createMissionExecutionService({
    serpApi: { apiKey: '', mockMode: true },
    createMissionId: () => 'serpapi-evidence-mission',
    plannerStrategy: {
      createPlan: (request) => request.observations.length === 0
        ? {
            goalId: request.goal.id,
            evaluateAfterExecution: false,
            steps: [{
              id: 'serpapi-search-step',
              toolId: 'google-search',
              objective: 'Search for library information',
              input: { query: 'public libraries' },
            }],
          }
        : { goalId: request.goal.id, decision: 'complete', steps: [], finalResult: 'Search evidence collected' },
    },
  })

  const state = await service.execute({ goal: 'Find public libraries' })

  assert.equal(state.status, 'completed')
  assert.deepEqual(state.evidence[0], {
    stepId: 'serpapi-search-step',
    toolId: 'google-search',
    title: 'Mock search result for public libraries',
    url: 'https://example.com/mock-search-result',
    source: 'example.com',
    relevantData: {
      title: 'Mock search result for public libraries',
      link: 'https://example.com/mock-search-result',
      snippet: 'This result was generated by the local SerpApi mock client.',
      source: 'example.com',
    },
  })
})

test('mission attributes unlinked Maps evidence to SerpApi', async () => {
  const service = createMissionExecutionService({
    serpApi: {
      apiKey: '',
      mockMode: true,
      client: {
        search: async () => ({ local_results: [{ title: 'Unlinked place result' }] }),
      },
    },
    createMissionId: () => 'unlinked-maps-evidence',
    plannerStrategy: {
      createPlan: (request) => request.observations.length === 0
        ? {
            goalId: request.goal.id,
            evaluateAfterExecution: false,
            steps: [{
              id: 'maps-no-link-step',
              toolId: 'google-maps-places',
              objective: 'Find a place',
              input: { query: 'museum' },
            }],
          }
        : { goalId: request.goal.id, decision: 'complete', steps: [], finalResult: 'Place retained' },
    },
  })

  const state = await service.execute({ goal: 'Find a museum' })

  assert.equal(state.status, 'completed')
  assert.equal(state.evidence[0]?.source, 'SerpApi')
  assert.equal(state.evidence[0]?.toolId, 'google-maps-places')
  assert.equal(state.evidence[0]?.title, 'Unlinked place result')
  assert.equal(state.evidence[0]?.url, undefined)
})

test('deterministic budget violation replans and records status history', async () => {
  const planner: PlanningStrategy = {
    createPlan: (request) => {
      if (request.observations.length === 0) return planTool(request, 'over-budget-search', 'price-1')
      if (request.observations.length === 1) return planTool(request, 'within-budget-search', 'price-2')
      return {
        goalId: request.goal.id,
        decision: 'complete',
        steps: [],
        finalResult: { summary: 'A suitable option was found', assumptions: ['Prices may change'] },
      }
    },
  }
  const service = missionService(planner, {
    registerTools: (registry) => {
      registry.register(createTool('over-budget-search', () => ({ results: [{ price: 650 }] })))
      registry.register(createTool('within-budget-search', () => ({
        results: [{ title: 'Budget option', price: 450, link: 'https://stay.example/room' }],
      })))
    },
  })

  const state = await service.execute({ goal: missionRequest.goal, constraints: { budget: 500 } })

  assert.equal(state.status, 'completed')
  assert.match(state.replans[0]?.reason ?? '', /budget is violated/)
  assert.deepEqual(state.constraintHistory.flatMap((evaluation) =>
    evaluation.assessments?.map((item) => item.status) ?? [],
  ), ['violated', 'satisfied', 'satisfied'])
  assert.equal(state.constraintAssessments[0]?.status, 'satisfied')
  assert.deepEqual(state.assumptions, ['Prices may change'])
  assert.equal(state.verifiedFacts[0]?.claim, 'Budget option')
})

test('terminal budget violation returns a no-match result with the cheapest option and evidence', async () => {
  const planner: PlanningStrategy = {
    createPlan: (request) => request.observations.length === 0
      ? planTool(request, 'priced-flight-search', 'flight-over-budget')
      : { goalId: request.goal.id, decision: 'complete', steps: [], finalResult: 'Mission succeeded' },
  }
  const service = missionService(planner, {
    agent: { maxReplans: 1 },
    registerTools: (registry) => registry.register(createTool('priced-flight-search', () => ({
      currency: 'INR',
      results: [
        { airline: 'Air One', flightNumber: 'AO 12', price: 12000, link: 'https://flights.example/ao12' },
        { airline: 'Air Two', flightNumber: 'AT 34', price: 9500, link: 'https://flights.example/at34' },
      ],
    }))),
  })

  const state = await service.execute({
    goal: 'Find a flight under INR 8000',
    constraints: { budget: { max: 8000, currency: 'INR' } },
  })

  assert.equal(state.status, 'no_match')
  assert.equal(state.failures.length, 0)
  assert.equal(state.constraintAssessments[0]?.status, 'violated')
  assert.equal(state.evidence.length, 2)
  assert.equal(state.evidence[1]?.url, 'https://flights.example/at34')
  assert.deepEqual(state.finalResult, {
    status: 'no_match',
    summary: 'No matching option was found because the budget constraint was violated. The cheapest observed option was INR 9,500.',
    constraint: {
      id: 'budget',
      expected: { max: 8000, currency: 'INR' },
      status: 'violated',
      reason: 'All comparable observed prices exceed the 8000 budget.',
      actual: { cheapestObserved: 9500, currency: 'INR' },
    },
    cheapestOption: {
      airline: 'Air Two',
      flightNumber: 'AT 34',
      price: 9500,
      link: 'https://flights.example/at34',
      toolId: 'priced-flight-search',
    },
    alternatives: [
      'Raise the budget to at least INR 9,500, the cheapest observed option.',
      'Try nearby travel dates, when fares may be lower.',
      'Consider nearby airports, different departure times, or itineraries with a stop.',
    ],
  })
})

test('unknown required preferences cause another tool plan instead of completion', async () => {
  const planner: PlanningStrategy = {
    createPlan: (request) => {
      const latestStatus = request.state.constraintHistory.at(-1)?.assessments?.[0]?.status
      if (request.observations.length === 0) return planTool(request, 'preference-search', 'preferences-1')
      if (latestStatus === 'unknown') return planTool(request, 'amenity-search', 'preferences-2')
      return { goalId: request.goal.id, decision: 'complete', steps: [], finalResult: 'Preferences verified' }
    },
  }
  const service = missionService(planner, {
    registerTools: (registry) => {
      registry.register(createTool('preference-search', () => ({ results: [{ name: 'Hotel' }] })))
      registry.register(createTool('amenity-search', () => ({ properties: [{ amenities: ['Pool'] }] })))
    },
  })

  const state = await service.execute({
    goal: missionRequest.goal,
    constraints: { requiredPreferences: ['Pool'] },
  })

  assert.equal(state.status, 'completed')
  assert.match(state.replans[0]?.reason ?? '', /requiredPreferences is unknown/)
  assert.deepEqual(state.constraintHistory.flatMap((evaluation) =>
    evaluation.assessments?.map((item) => item.status) ?? [],
  ), ['unknown', 'satisfied', 'satisfied'])
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

test('mission executes the capability fallback after an invalid Gemini tool call without false completion', async () => {
  const invalidCallClient: GeminiFunctionCallingClient = {
    generateFunctionCall: async () => ({
      name: 'mission_tool_not_registered',
      arguments: { objective: 'Call an unavailable tool', input: {} },
    }),
  }
  const strategy = new GeminiPlannerStrategy(invalidCallClient, 'test-model')
  const service = missionService(strategy)

  const state = await service.execute({ goal: missionRequest.goal })

  assert.equal(state.status, 'needs_information')
  assert.equal(state.toolCalls[0]?.toolId, 'google-search')
  assert.equal(state.observations[0]?.ok, true)
  assert.match(state.planHistory[0]?.rationale ?? '', /capability-based fallback/)
})

test('mission executes the capability fallback after Gemini throws without false completion', async () => {
  const service = missionService({ createPlan: () => { throw new Error('Gemini unavailable') } })

  const state = await service.execute({ goal: missionRequest.goal })

  assert.equal(state.status, 'needs_information')
  assert.equal(state.toolCalls[0]?.toolId, 'google-search')
  assert.equal(state.observations[0]?.ok, true)
  assert.match(state.planHistory[0]?.rationale ?? '', /capability-based fallback/)
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
      missingInformation: ['A booking link was unavailable.'],
      finalResult: { summary: 'Ready', assumptions: ['Test assumption'] },
    }),
  }
  const service = missionService(planner, {
    constraintEvaluator: { evaluate: () => ({ satisfied: true, violations: [] }) },
  })

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
  assert.equal(payload.error, null)
  assert.deepEqual(payload.plan, [])
  assert.deepEqual(payload.toolCalls, [])
  assert.deepEqual(payload.replans, [])
  assert.deepEqual(payload.findings, [])
  assert.deepEqual(payload.evidence, [])
  assert.deepEqual(payload.result, {
    summary: { summary: 'Ready', assumptions: ['Test assumption'] },
    verifiedFacts: [],
    assumptions: ['Test assumption'],
    missingInformation: ['A booking link was unavailable.'],
    constraints: [],
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

test('POST /api/missions exposes an incomplete fallback result when Gemini returns no usable plan', async () => {
  const service = missionService({
    createPlan: () => { throw new Error('Gemini returned no function call') },
  })

  const payload = await withMissionServer(service, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/missions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ goal: 'Plan a trip' }),
    })
    assert.equal(response.status, 200)
    return response.json() as Promise<Record<string, unknown>>
  })

  assert.equal(payload.status, 'needs_information')
  assert.equal((payload.error as { code: string }).code, 'mission')
  assert.match((payload.error as { message: string }).message, /Gemini returned no function call/)
  assert.match((payload.error as { message: string }).message, /capability-based fallback/)
  assert.ok(Array.isArray(payload.plan) && payload.plan.length > 0)
  assert.ok(Array.isArray(payload.toolCalls) && payload.toolCalls.length > 0)
})

const travelMission = 'Plan my 2-day Hyderabad trip from Bengaluru for an interview. Keep the total budget under ₹8,000 and find flights, a hotel, and nearby food options.'

test('travel mission extracts budget, duration, route, currency, and required tool capabilities', () => {
  const registry = new ToolRegistry()
  registry.register(createTool('google-search'))
  registry.register(createTool('google-maps-places'))
  registry.register(createTool('google-flights'))
  registry.register(createTool('google-hotels'))

  const extracted = extractMissionRequirements(travelMission, {}, registry.list())

  assert.deepEqual(extracted.constraints.budget, { max: 8000, currency: 'INR', scope: 'total' })
  assert.equal(extracted.constraints.durationDays, 2)
  assert.deepEqual(extracted.constraints.route, { origin: 'Bengaluru', destination: 'Hyderabad' })
  assert.deepEqual(extracted.requiredToolIds, [
    'google-flights',
    'google-hotels',
    'google-maps-places',
  ])
  assert.deepEqual(extracted.explicitDates, [])
})

test('sample flight mission extracts its written date, route, and passenger count', () => {
  const registry = new ToolRegistry()
  registerSerpApiTools(registry, { apiKey: '', mockMode: true })
  const goal = 'Find me a flight ticket from Bengaluru to Hyderabad for 2 people on October 10, 2026, under ₹8,000 total. Find the cheapest suitable option and provide the booking link.'
  const extracted = extractMissionRequirements(goal, {}, registry.list())
  const missionGoal = {
    id: 'sample-flight',
    description: goal,
    metadata: {
      missionConstraints: extracted.constraints,
      missionRequirements: extracted,
    },
  }
  const flightTool = registry.get('google-flights')
  assert.ok(flightTool)

  assert.deepEqual(extracted.constraints.route, { origin: 'Bengaluru', destination: 'Hyderabad' })
  assert.deepEqual(extracted.explicitDates, ['2026-10-10'])
  assert.equal(extracted.passengers, 2)
  assert.deepEqual(flightTool.createInput({ goal: missionGoal, observations: [] }), {
    departure: 'Bengaluru',
    destination: 'Hyderabad',
    departureDate: '2026-10-10',
    passengers: 2,
    travelClass: 'economy',
    currency: 'INR',
  })
})

test('sample flight mission falls back from Gemini and executes through constraint evaluation', async () => {
  const goal = 'Find me a flight ticket from Bengaluru to Hyderabad for 2 people on October 10, 2026, under ₹8,000 total. Find the cheapest suitable option and provide the booking link.'
  const service = createMissionExecutionService({
    serpApi: {
      apiKey: '',
      mockMode: true,
      client: {
        search: async () => ({
          best_flights: [{
            flights: [{
              airline: 'Fixture Airline',
              flight_number: 'FX 100',
              departure_airport: { time: '2026-10-10 09:00' },
              arrival_airport: { time: '2026-10-10 12:00' },
              duration: 180,
            }],
            total_duration: 180,
            layovers: [],
            price: 6000,
            link: 'https://example.test/fixture-flight',
          }],
        }),
      },
    },
    plannerStrategy: { createPlan: () => { throw new Error('Gemini returned no valid function call') } },
    createMissionId: () => 'sample-flight-fallback',
  })

  const state = await service.execute({ goal })

  assert.equal(state.status, 'completed', JSON.stringify({ failures: state.failures, constraints: state.constraintAssessments }))
  assert.equal(state.toolCalls.length, 1)
  assert.equal(state.toolCalls[0]?.toolId, 'google-flights')
  assert.deepEqual(state.toolCalls[0]?.input, {
    departure: 'Bengaluru',
    destination: 'Hyderabad',
    departureDate: '2026-10-10',
    passengers: 2,
    travelClass: 'economy',
    currency: 'INR',
  })
  assert.equal(state.observations.length, 1)
  assert.ok(state.constraintHistory.length > 0)
  assert.equal(state.evidence[0]?.url, 'https://example.test/fixture-flight')
  assert.match(String(state.finalResult), /completed/i)
})

test('agent selects every requested tool across iterations and does not falsely complete without dates and total cost', async () => {
  const travelGoal = `${travelMission} Travel dates: 2026-10-10 to 2026-10-11.`
  const planner: PlanningStrategy = {
    createPlan: (request) => {
      const metadata = request.goal.metadata?.missionRequirements
      const requiredToolIds = isRecordForTest(metadata) && Array.isArray(metadata.requiredToolIds)
        ? metadata.requiredToolIds.filter((item): item is string => typeof item === 'string')
        : []
      const completedToolIds = new Set(request.observations.filter((item) => item.ok).map((item) => item.toolId))
      const nextToolId = requiredToolIds.find((toolId) => !completedToolIds.has(toolId))
      if (nextToolId) {
        const stepId = `travel-${request.observations.length + 1}`
        const inputs: Record<string, unknown> = {
          'google-flights': {
            departure: 'Bengaluru',
            destination: 'Hyderabad',
            departureDate: '2026-10-10',
            returnDate: '2026-10-11',
            passengers: 1,
            travelClass: 'economy',
            currency: 'INR',
          },
          'google-hotels': {
            destination: 'Hyderabad',
            checkIn: '2026-10-10',
            checkOut: '2026-10-11',
            guests: 1,
            currency: 'INR',
          },
          'google-maps-places': { query: 'nearby food options', location: 'Hyderabad' },
        }
        return {
          goalId: request.goal.id,
          steps: [{
            id: stepId,
            toolId: nextToolId,
            objective: `Find ${nextToolId}`,
            input: inputs[nextToolId],
          }],
        }
      }
      return { goalId: request.goal.id, decision: 'complete', steps: [], finalResult: 'Plan ready' }
    },
  }
  const service = missionService(planner, {
    agent: { maxReplans: 4 },
  })

  const state = await service.execute({ goal: travelGoal })

  assert.notEqual(state.status, 'completed')
  assert.equal(state.status, 'needs_information', JSON.stringify({
    failures: state.failures,
    replans: state.replans,
    constraints: state.constraintAssessments,
    missingInformation: state.missingInformation,
    toolCalls: state.toolCalls,
  }))
  assert.deepEqual(new Set(state.toolCalls.map((call) => call.toolId)), new Set([
    'google-flights',
    'google-hotels',
    'google-maps-places',
  ]))
  assert.ok(state.missingInformation.some((item) => /total trip cost/i.test(item)))
  const assessments = Object.fromEntries(
    state.constraintAssessments.map((item) => [item.constraint, item.status]),
  )
  assert.equal(assessments.route, 'satisfied', JSON.stringify(assessments))
  assert.equal(assessments.durationDays, 'satisfied', JSON.stringify(assessments))
  assert.equal(assessments.date, 'satisfied', JSON.stringify(assessments))
  assert.equal(assessments.requiredTools, 'unknown', JSON.stringify(assessments))
  assert.equal(assessments.budget, 'unknown')
})

test('date-dependent travel calls are not executed with invented dates', async () => {
  const planner: PlanningStrategy = {
    createPlan: (request) => {
      const metadata = request.goal.metadata?.missionRequirements
      const requiredToolIds = isRecordForTest(metadata) && Array.isArray(metadata.requiredToolIds)
        ? metadata.requiredToolIds.filter((item): item is string => typeof item === 'string')
        : []
      const flightToolId = requiredToolIds.find((toolId) => /flight/i.test(toolId))
      if (!flightToolId) return { goalId: request.goal.id, decision: 'complete', steps: [], finalResult: 'No flight requested' }
      return {
        goalId: request.goal.id,
        steps: [{
          id: `undated-flight-${request.replanCount}`,
          toolId: flightToolId,
          objective: 'Search flights',
          input: {
            departure: 'Bengaluru',
            destination: 'Hyderabad',
            departureDate: '2026-10-10',
            returnDate: '2026-10-11',
            passengers: 1,
            travelClass: 'economy',
            currency: 'INR',
          },
        }],
      }
    },
  }
  const state = await missionService(planner).execute({ goal: travelMission })

  assert.equal(state.status, 'needs_information')
  assert.equal(state.observations.length, 0)
  assert.ok(state.missingInformation.some((item) => /exact date/i.test(item)))
})

function isRecordForTest(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

test('production mission execution reports missing API keys instead of using successful mocks', async () => {
  assert.deepEqual(missingMissionApiKeys({}), ['GEMINI_API_KEY', 'SERPAPI_API_KEY'])
  const state = await createMissionExecutionService({
    createMissionId: () => 'configuration-mission',
    gemini: { apiKey: '', mockMode: true },
    serpApi: { apiKey: '', mockMode: true },
  }).execute({ goal: travelMission })

  assert.equal(state.status, 'failed')
  assert.equal(state.toolCalls.length, 0)
  assert.equal(state.failures[0]?.source, 'configuration')
  assert.match(state.failures[0]?.message ?? '', /GEMINI_API_KEY and SERPAPI_API_KEY/)
})