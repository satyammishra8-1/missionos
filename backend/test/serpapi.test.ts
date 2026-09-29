import assert from 'node:assert/strict'
import test from 'node:test'
import { Agent } from '../src/agent/Agent.js'
import { ToolExecutor } from '../src/agent/ToolExecutor.js'
import { ToolRegistry } from '../src/agent/ToolRegistry.js'
import { createGeminiAgent } from '../src/services/gemini/index.js'
import {
  createSerpApiClient,
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
  const tool = registry.get('google-search')

  assert.ok(tool)
  assert.match(tool.description, /Google/)
  assert.deepEqual(tool.inputSchema?.required, ['query'])
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