import assert from 'node:assert/strict'
import test from 'node:test'
import { Agent } from '../src/agent/Agent.js'
import { Planner } from '../src/agent/Planner.js'
import { ToolExecutor } from '../src/agent/ToolExecutor.js'
import { ToolRegistry } from '../src/agent/ToolRegistry.js'
import { createGeminiAgent } from '../src/services/gemini/index.js'
import {
  createSerpApiClient,
  parseGoogleMapsPlacesResponse,
  parseGoogleSearchResponse,
  registerSerpApiTools,
} from '../src/services/serpapi/index.js'
import type { SerpApiClient } from '../src/services/serpapi/types.js'

const goal = { id: 'search-goal', description: 'Find general information about public libraries' }

function createRegistry(client: SerpApiClient): ToolRegistry {
  const registry = new ToolRegistry()
  registerSerpApiTools(registry, { client })
  return registry
}

test('live API configuration requires a key when mock mode is disabled', () => {
  assert.throws(
    () => createSerpApiClient({ apiKey: '', mockMode: false }),
    /SERPAPI_API_KEY is required/,
  )
})

test('SerpApi registration adds Google Search to the existing tool registry', () => {
  const registry = createRegistry({ search: async () => ({ organic_results: [] }) })
  const searchTool = registry.get('google-search')
  const placesTool = registry.get('google-maps-places')

  assert.ok(searchTool)
  assert.match(searchTool.description, /Google/)
  assert.deepEqual(searchTool.inputSchema?.required, ['query'])
  assert.ok(placesTool)
  assert.match(placesTool.description, /Google Maps/)
  assert.deepEqual(placesTool.inputSchema?.required, ['query'])
})

test('Google Maps Places parses fields that are available and applies the result limit', () => {
  const results = parseGoogleMapsPlacesResponse({
    local_results: [
      {
        title: 'Neighborhood library',
        address: '12 Main Street',
        rating: 4.7,
        reviews: 128,
        gps_coordinates: { latitude: 45.52, longitude: -122.67 },
        link: 'https://maps.google.com/?cid=12345',
      },
      { title: 'Community reading room' },
      { title: 'Place with an id', place_id: 'place-123' },
    ],
  }, 3)

  assert.deepEqual(results, [
    {
      name: 'Neighborhood library',
      address: '12 Main Street',
      rating: 4.7,
      reviewsCount: 128,
      coordinates: { latitude: 45.52, longitude: -122.67 },
      placeLink: 'https://maps.google.com/?cid=12345',
    },
    { name: 'Community reading room' },
    {
      name: 'Place with an id',
      placeLink: 'https://www.google.com/maps/search/?api=1&query=Place+with+an+id&query_place_id=place-123',
    },
  ])
})

test('Google Search parses clean structured results and extracts source domains', () => {
  const results = parseGoogleSearchResponse({
    organic_results: [
      {
        title: 'Library resources',
        link: 'https://www.example.org/resources',
        snippet: 'Useful information for readers.',
      },
      { title: 'Invalid result', link: 'not a URL', snippet: 'Ignored.' },
    ],
  })

  assert.deepEqual(results, [{
    title: 'Library resources',
    link: 'https://www.example.org/resources',
    snippet: 'Useful information for readers.',
    source: 'example.org',
  }])
})

test('Google Search executes through ToolExecutor with backend-only API configuration', async () => {
  let requestUrl: URL | undefined
  const fetchImplementation: typeof fetch = async (input) => {
    requestUrl = new URL(input.toString())
    return new Response(JSON.stringify({
      organic_results: [
        {
          title: 'Local library directory',
          link: 'https://libraries.example.net/list',
          snippet: 'A directory of local libraries.',
        },
      ],
    }), { status: 200 })
  }
  const registry = new ToolRegistry()
  registerSerpApiTools(registry, {
    apiKey: 'test-key-not-for-network',
    mockMode: false,
    fetchImplementation,
  })
  const tool = registry.get('google-search')
  assert.ok(tool)

  const result = await new ToolExecutor(registry).execute({
    id: 'search-step',
    toolId: tool.id,
    objective: 'Search for local libraries',
    input: { query: 'public libraries', location: 'Portland, Oregon', numResults: 3 },
  }, { goal, observations: [] })

  assert.equal(result.ok, true)
  assert.deepEqual(requestUrl && Object.fromEntries(requestUrl.searchParams), {
    engine: 'google',
    q: 'public libraries',
    location: 'Portland, Oregon',
    num: '3',
    api_key: 'test-key-not-for-network',
  })
  assert.deepEqual(result.ok ? result.output : undefined, {
    query: 'public libraries',
    results: [{
      title: 'Local library directory',
      link: 'https://libraries.example.net/list',
      snippet: 'A directory of local libraries.',
      source: 'libraries.example.net',
    }],
  })
})

test('Google Search reports API failures through ToolExecutor', async () => {
  const fetchImplementation: typeof fetch = async () =>
    new Response(JSON.stringify({ error: 'Rate limit reached' }), { status: 429 })
  const registry = new ToolRegistry()
  registerSerpApiTools(registry, {
    apiKey: 'test-key',
    mockMode: false,
    fetchImplementation,
  })
  const tool = registry.get('google-search')
  assert.ok(tool)

  const result = await new ToolExecutor(registry).execute({
    id: 'failed-search',
    toolId: tool.id,
    objective: 'Search',
    input: { query: 'public libraries' },
  }, { goal, observations: [] })

  assert.equal(result.ok, false)
  if (!result.ok) assert.match(result.error, /status 429/)
})

test('Google Search rejects invalid structured input', () => {
  const registry = createRegistry({ search: async () => ({ organic_results: [] }) })
  const tool = registry.get('google-search')
  assert.ok(tool)

  assert.throws(() => tool.validateInput({ query: '  ' }), /non-empty string/)
  assert.throws(() => tool.validateInput({ query: 'libraries', numResults: 1.5 }), /integer/)
})

test('Google Maps Places validates required fields and optional bounds', () => {
  const registry = createRegistry({ search: async () => ({ local_results: [] }) })
  const tool = registry.get('google-maps-places')
  assert.ok(tool)

  assert.throws(() => tool.validateInput({ query: ' ', location: 'Portland' }), /query/)
  assert.throws(
    () => tool.validateInput({ query: 'cafes', radius: 500 }),
    /radius requires a location/,
  )
  assert.throws(
    () => tool.validateInput({ query: 'cafes', location: 'Portland', radius: 2.5 }),
    /radius must be an integer/,
  )
  assert.throws(
    () => tool.validateInput({ query: 'cafes', location: 'Portland', resultLimit: 101 }),
    /resultLimit must be an integer/,
  )
})

test('Google Maps Places executes with the Maps engine and normalizes SerpApi results', async () => {
  let requestUrl: URL | undefined
  const fetchImplementation: typeof fetch = async (input) => {
    requestUrl = new URL(input.toString())
    return new Response(JSON.stringify({
      local_results: [{
        title: 'Portland cafe',
        address: '10 Example Avenue',
        rating: 4.6,
        reviews: 42,
        gps_coordinates: { latitude: 45.52, longitude: -122.67 },
        link: 'https://maps.google.com/?cid=98765',
      }],
    }), { status: 200 })
  }
  const registry = new ToolRegistry()
  registerSerpApiTools(registry, {
    apiKey: 'test-key',
    mockMode: false,
    fetchImplementation,
  })
  const tool = registry.get('google-maps-places')
  assert.ok(tool)

  const result = await new ToolExecutor(registry).execute({
    id: 'places-step',
    toolId: tool.id,
    objective: 'Find cafes nearby',
    input: { query: 'cafes', location: 'Portland, Oregon', radius: 750, resultLimit: 1 },
  }, { goal, observations: [] })

  assert.equal(result.ok, true)
  assert.deepEqual(requestUrl && Object.fromEntries(requestUrl.searchParams), {
    engine: 'google_maps',
    type: 'search',
    q: 'cafes',
    location: 'Portland, Oregon',
    m: '1500',
    api_key: 'test-key',
  })
  assert.deepEqual(result.ok ? result.output : undefined, {
    query: 'cafes',
    results: [{
      name: 'Portland cafe',
      address: '10 Example Avenue',
      rating: 4.6,
      reviewsCount: 42,
      coordinates: { latitude: 45.52, longitude: -122.67 },
      placeLink: 'https://maps.google.com/?cid=98765',
    }],
  })
})

test('Google Maps Places reports API failures through ToolExecutor', async () => {
  const fetchImplementation: typeof fetch = async () =>
    new Response(JSON.stringify({ error: 'Maps service unavailable' }), { status: 503 })
  const registry = new ToolRegistry()
  registerSerpApiTools(registry, {
    apiKey: 'test-key',
    mockMode: false,
    fetchImplementation,
  })
  const tool = registry.get('google-maps-places')
  assert.ok(tool)

  const result = await new ToolExecutor(registry).execute({
    id: 'failed-places-step',
    toolId: tool.id,
    objective: 'Find places',
    input: { query: 'cafes', location: 'Portland' },
  }, { goal, observations: [] })

  assert.equal(result.ok, false)
  if (!result.ok) assert.match(result.error, /status 503/)
})

test('mock mode needs no API key and runs through the existing Gemini agent flow', async () => {
  const registry = new ToolRegistry()
  registerSerpApiTools(registry, { apiKey: '', mockMode: true })
  const agent: Agent = createGeminiAgent(registry, {
    planner: { apiKey: '', mockMode: true, fallbackMode: false, model: 'mock-model' },
  })

  const state = await agent.run(goal)

  assert.equal(state.status, 'completed')
  assert.equal(state.observations[0]?.toolId, 'google-search')
  assert.equal(state.observations[0]?.ok, true)
  const searchOutput = {
    query: goal.description,
    results: [{
      title: `Mock search result for ${goal.description}`,
      link: 'https://example.com/mock-search-result',
      snippet: 'This result was generated by the local SerpApi mock client.',
      source: 'example.com',
    }],
  }
  assert.deepEqual(state.observations[0]?.output, searchOutput)
  assert.equal(state.finalResult, JSON.stringify(searchOutput))
})

test('Google Maps Places mock mode runs through Agent and ToolExecutor without an API key', async () => {
  const registry = new ToolRegistry()
  registerSerpApiTools(registry, { apiKey: '', mockMode: true })
  const planner = new Planner({
    createPlan: ({ goal: mission }) => ({
      goalId: mission.id,
      evaluateAfterExecution: false,
      steps: [{
        id: 'mock-places-step',
        toolId: 'google-maps-places',
        objective: 'Find places near the supplied location',
        input: { query: 'libraries', location: 'Portland, Oregon', radius: 5000, resultLimit: 1 },
      }],
    }),
  })

  const state = await new Agent(registry, planner).run(goal)

  assert.equal(state.status, 'completed')
  assert.equal(state.observations[0]?.toolId, 'google-maps-places')
  assert.equal(state.observations[0]?.ok, true)
  assert.deepEqual(state.finalResult, {
    query: 'libraries',
    results: [{
      name: 'Mock place for libraries',
      address: '100 Example Street',
      rating: 4.5,
      reviewsCount: 23,
      coordinates: { latitude: 45.5231, longitude: -122.6765 },
      placeLink: 'https://maps.google.com/?cid=mock-place',
    }],
  })
})