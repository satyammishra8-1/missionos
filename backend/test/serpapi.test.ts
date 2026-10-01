import assert from 'node:assert/strict'
import test from 'node:test'
import { Agent } from '../src/agent/Agent.js'
import { Planner } from '../src/agent/Planner.js'
import { ToolExecutor } from '../src/agent/ToolExecutor.js'
import { ToolRegistry } from '../src/agent/ToolRegistry.js'
import { createGeminiAgent } from '../src/services/gemini/index.js'
import {
  createSerpApiClient,
  parseGoogleFlightsResponse,
  parseGoogleHotelsResponse,
  parseGoogleMapsPlacesResponse,
  parseGoogleSearchResponse,
  registerSerpApiTools,
  MockSerpApiClient,
  SerpApiClient as RealSerpApiClient,
} from '../src/services/serpapi/index.js'
import type { SerpApiClient } from '../src/services/serpapi/types.js'

const goal = { id: 'search-goal', description: 'Find general information about public libraries' }

function createRegistry(client: SerpApiClient): ToolRegistry {
  const registry = new ToolRegistry()
  registerSerpApiTools(registry, { client })
  return registry
}

function createAgentForTool(registry: ToolRegistry, toolId: string, input: unknown): Agent {
  const planner = new Planner({
    createPlan: ({ goal: mission }) => ({
      goalId: mission.id,
      evaluateAfterExecution: false,
      steps: [{
        id: `mock-${toolId}-step`,
        toolId,
        objective: `Execute ${toolId}`,
        input,
      }],
    }),
  })
  return new Agent(registry, planner)
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
  const flightsTool = registry.get('google-flights')
  const hotelsTool = registry.get('google-hotels')

  assert.ok(searchTool)
  assert.match(searchTool.description, /Google/)
  assert.deepEqual(searchTool.inputSchema?.required, ['query'])
  assert.ok(placesTool)
  assert.match(placesTool.description, /Google Maps/)
  assert.deepEqual(placesTool.inputSchema?.required, ['query'])
  assert.ok(flightsTool)
  assert.match(flightsTool.description, /Google Flights/)
  assert.ok(hotelsTool)
  assert.match(hotelsTool.description, /Google Hotels/)
})

const validFlightsInput = {
  departure: 'JFK',
  destination: 'LHR',
  departureDate: '2027-04-10',
  passengers: 2,
  travelClass: 'business',
} as const

test('Google Flights strictly validates route, dates, passengers, class, and unknown fields', () => {
  const tool = createRegistry({ search: async () => ({ best_flights: [] }) }).get('google-flights')
  assert.ok(tool)

  assert.throws(() => tool.validateInput({ ...validFlightsInput, departure: ' ' }), /departure/)
  assert.throws(() => tool.validateInput({ ...validFlightsInput, departureDate: '2027-02-30' }), /valid YYYY-MM-DD/)
  assert.throws(() => tool.validateInput({ ...validFlightsInput, returnDate: '2027-04-10' }), /after departureDate/)
  assert.throws(() => tool.validateInput({ ...validFlightsInput, passengers: 0 }), /passengers must be an integer/)
  assert.throws(() => tool.validateInput({ ...validFlightsInput, travelClass: 'luxury' }), /travelClass/)
  assert.throws(() => tool.validateInput({ ...validFlightsInput, extra: true }), /unsupported fields/)
})

test('Google Flights parses multi-segment itineraries into structured results', () => {
  const results = parseGoogleFlightsResponse({
    best_flights: [{
      flights: [
        {
          airline: 'Air One',
          flight_number: 'AO 12',
          departure_airport: { time: '2027-04-10 08:00' },
          arrival_airport: { time: '2027-04-10 10:00' },
          duration: 120,
        },
        {
          airline: 'Air Two',
          flight_number: 'AT 34',
          departure_airport: { time: '2027-04-10 11:00' },
          arrival_airport: { time: '2027-04-10 15:00' },
          duration: 240,
        },
      ],
      layovers: [{ name: 'Reykjavik Airport' }],
      total_duration: 420,
      price: 675,
    }],
    other_flights: [],
  }, validFlightsInput)

  assert.deepEqual(results, [{
    airline: 'Air One, Air Two',
    flightNumber: 'AO 12, AT 34',
    departure: '2027-04-10 08:00',
    arrival: '2027-04-10 15:00',
    duration: 420,
    stops: 1,
    price: 675,
    link: 'https://www.google.com/travel/flights?q=Flights+from+JFK+to+LHR+on+2027-04-10',
  }])
})

test('Google Flights rejects malformed responses and safely handles API errors', () => {
  assert.throws(() => parseGoogleFlightsResponse({}, validFlightsInput), /missing flight results/)
  assert.throws(
    () => parseGoogleFlightsResponse({ best_flights: 'not-an-array' }, validFlightsInput),
    /invalid best_flights/,
  )
  assert.throws(
    () => parseGoogleFlightsResponse({ error: 'Invalid route' }, validFlightsInput),
    /Invalid route/,
  )
})

test('Google Flights calls the SerpApi engine through ToolExecutor', async () => {
  let requestUrl: URL | undefined
  const fetchImplementation: typeof fetch = async (input) => {
    requestUrl = new URL(input.toString())
    return new Response(JSON.stringify({ best_flights: [], other_flights: [] }), { status: 200 })
  }
  const registry = new ToolRegistry()
  registerSerpApiTools(registry, {
    apiKey: 'test-key',
    mockMode: false,
    fetchImplementation,
  })
  const tool = registry.get('google-flights')
  assert.ok(tool)

  const result = await new ToolExecutor(registry).execute({
    id: 'flight-step',
    toolId: tool.id,
    objective: 'Find flights',
    input: { ...validFlightsInput, returnDate: '2027-04-20', currency: 'INR' },
  }, { goal, observations: [] })

  assert.equal(result.ok, true)
  assert.deepEqual(requestUrl && Object.fromEntries(requestUrl.searchParams), {
    engine: 'google_flights',
    departure_id: 'JFK',
    arrival_id: 'LHR',
    outbound_date: '2027-04-10',
    type: '1',
    adults: '2',
    travel_class: '3',
    currency: 'INR',
    return_date: '2027-04-20',
    api_key: 'test-key',
  })
})

test('Google Flights reports transport failures through ToolExecutor', async () => {
  const fetchImplementation: typeof fetch = async () =>
    new Response(JSON.stringify({ error: 'Flights service unavailable' }), { status: 502 })
  const registry = new ToolRegistry()
  registerSerpApiTools(registry, { apiKey: 'test-key', mockMode: false, fetchImplementation })
  const tool = registry.get('google-flights')
  assert.ok(tool)

  const result = await new ToolExecutor(registry).execute({
    id: 'failed-flight-step',
    toolId: tool.id,
    objective: 'Search flights',
    input: validFlightsInput,
  }, { goal, observations: [] })

  assert.equal(result.ok, false)
  if (!result.ok) assert.match(result.error, /status 502/)
})

test('Google Flights mock mode works without an API key through Agent and ToolExecutor', async () => {
  const registry = new ToolRegistry()
  registerSerpApiTools(registry, { apiKey: '', mockMode: true })
  const state = await createAgentForTool(registry, 'google-flights', validFlightsInput).run(goal)

  assert.equal(state.status, 'completed')
  assert.equal(state.observations[0]?.toolId, 'google-flights')
  assert.equal(state.observations[0]?.ok, true)
  assert.deepEqual(state.finalResult, {
    departure: 'JFK',
    destination: 'LHR',
    results: [],
  })
})

const validHotelsInput = {
  destination: 'Reykjavik, Iceland',
  checkIn: '2027-06-10',
  checkOut: '2027-06-15',
  guests: 2,
} as const

test('Google Hotels strictly validates destination, stay dates, guests, preferences, and unknown fields', () => {
  const tool = createRegistry({ search: async () => ({ properties: [] }) }).get('google-hotels')
  assert.ok(tool)

  assert.throws(() => tool.validateInput({ ...validHotelsInput, destination: ' ' }), /destination/)
  assert.throws(() => tool.validateInput({ ...validHotelsInput, checkIn: '2027-02-30' }), /valid YYYY-MM-DD/)
  assert.throws(() => tool.validateInput({ ...validHotelsInput, checkOut: validHotelsInput.checkIn }), /after checkIn/)
  assert.throws(() => tool.validateInput({ ...validHotelsInput, guests: 0 }), /guests must be an integer/)
  assert.throws(() => tool.validateInput({ ...validHotelsInput, preferences: [''] }), /preferences/)
  assert.throws(() => tool.validateInput({ ...validHotelsInput, extra: true }), /unsupported fields/)
})

test('Google Hotels parses structured prices, ratings, reviews, location, amenities, and links', () => {
  const results = parseGoogleHotelsResponse({
    properties: [{
      name: 'Harbor Hotel',
      rate_per_night: { extracted_lowest: 189, lowest: '$189 per night' },
      overall_rating: 4.6,
      reviews: 942,
      address: '1 Harbor Road, Reykjavik',
      amenities: ['Free Wi-Fi', ' Breakfast ', 23],
      link: 'https://www.google.com/travel/search?q=harbor-hotel',
    }],
  }, validHotelsInput)

  assert.deepEqual(results, [{
    name: 'Harbor Hotel',
    price: { amount: 189, display: '$189 per night' },
    rating: 4.6,
    reviews: 942,
    location: '1 Harbor Road, Reykjavik',
    amenities: ['Free Wi-Fi', 'Breakfast'],
    link: 'https://www.google.com/travel/search?q=harbor-hotel',
  }])
})

test('Google Hotels rejects malformed responses and safely handles API errors', () => {
  assert.throws(() => parseGoogleHotelsResponse({}, validHotelsInput), /missing properties/)
  assert.throws(
    () => parseGoogleHotelsResponse({ properties: [null] }, validHotelsInput),
    /no valid hotel properties/,
  )
  assert.throws(
    () => parseGoogleHotelsResponse({ error: 'Invalid stay dates' }, validHotelsInput),
    /Invalid stay dates/,
  )
})

test('Google Hotels calls SerpApi with dates, guests, and preferences through ToolExecutor', async () => {
  let requestUrl: URL | undefined
  const fetchImplementation: typeof fetch = async (input) => {
    requestUrl = new URL(input.toString())
    return new Response(JSON.stringify({ properties: [] }), { status: 200 })
  }
  const registry = new ToolRegistry()
  registerSerpApiTools(registry, { apiKey: 'test-key', mockMode: false, fetchImplementation })
  const tool = registry.get('google-hotels')
  assert.ok(tool)

  const result = await new ToolExecutor(registry).execute({
    id: 'hotel-step',
    toolId: tool.id,
    objective: 'Find a hotel',
    input: { ...validHotelsInput, preferences: ['free breakfast', 'pool'], currency: 'INR' },
  }, { goal, observations: [] })

  assert.equal(result.ok, true)
  assert.deepEqual(requestUrl && Object.fromEntries(requestUrl.searchParams), {
    engine: 'google_hotels',
    q: 'Reykjavik, Iceland free breakfast pool',
    check_in_date: '2027-06-10',
    check_out_date: '2027-06-15',
    adults: '2',
    currency: 'INR',
    api_key: 'test-key',
  })
})

test('Google Hotels reports transport failures through ToolExecutor', async () => {
  const fetchImplementation: typeof fetch = async () =>
    new Response(JSON.stringify({ error: 'Hotels service unavailable' }), { status: 503 })
  const registry = new ToolRegistry()
  registerSerpApiTools(registry, { apiKey: 'test-key', mockMode: false, fetchImplementation })
  const tool = registry.get('google-hotels')
  assert.ok(tool)

  const result = await new ToolExecutor(registry).execute({
    id: 'failed-hotel-step',
    toolId: tool.id,
    objective: 'Search hotels',
    input: validHotelsInput,
  }, { goal, observations: [] })

  assert.equal(result.ok, false)
  if (!result.ok) assert.match(result.error, /status 503/)
})

test('Google Hotels mock mode works without an API key through Agent and ToolExecutor', async () => {
  const registry = new ToolRegistry()
  registerSerpApiTools(registry, { apiKey: '', mockMode: true })
  const state = await createAgentForTool(registry, 'google-hotels', validHotelsInput).run(goal)

  assert.equal(state.status, 'completed')
  assert.equal(state.observations[0]?.toolId, 'google-hotels')
  assert.equal(state.observations[0]?.ok, true)
  assert.deepEqual(state.finalResult, {
    destination: 'Reykjavik, Iceland',
    results: [{
      name: 'Mock Hotel in Reykjavik, Iceland',
      price: { amount: 125, display: '$125' },
      rating: 4.4,
      reviews: 86,
      location: '200 Example Avenue',
      amenities: ['Free Wi-Fi', 'Air conditioning'],
      link: 'https://www.google.com/travel/search?q=mock-hotel',
    }],
  })
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

test('a configured SerpApi key selects the real client even when mock mode is otherwise enabled', async () => {
  let requestedUrl: URL | undefined
  const client = createSerpApiClient({
    apiKey: 'configured-test-key',
    fetchImplementation: async (input) => {
      requestedUrl = new URL(input.toString())
      return new Response(JSON.stringify({ organic_results: [] }), { status: 200 })
    },
  })

  assert.ok(client instanceof RealSerpApiClient)
  await client.search({ engine: 'google', q: 'test query' })
  assert.equal(requestedUrl?.searchParams.get('api_key'), 'configured-test-key')
})

test('explicit SerpApi mock mode selects the mock client', () => {
  const client = createSerpApiClient({ apiKey: '', mockMode: true })
  assert.ok(client instanceof MockSerpApiClient)
})