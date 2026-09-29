import type { MissionGoal, ToolDefinition } from '../../agent/types.js'
import type {
  GoogleSearchInput,
  GoogleSearchOutput,
  GoogleSearchResult,
  SerpApiClient,
  SerpApiSearchParameters,
} from './types.js'

const defaultResultCount = 10
const maximumResultCount = 100

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function getSource(link: string): string | undefined {
  try {
    const url = new URL(link)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined
    return url.hostname.toLowerCase().replace(/^www\./, '')
  } catch {
    return undefined
  }
}

export function parseGoogleSearchResponse(
  payload: unknown,
  numResults = defaultResultCount,
): readonly GoogleSearchResult[] {
  if (!isRecord(payload)) {
    throw new Error('Google Search returned an invalid response')
  }
  if (typeof payload.error === 'string') {
    throw new Error(`Google Search failed: ${payload.error}`)
  }

  const organicResults = payload.organic_results
  if (organicResults === undefined) return []
  if (!Array.isArray(organicResults)) {
    throw new Error('Google Search returned invalid organic results')
  }

  return organicResults.flatMap((item): GoogleSearchResult[] => {
    if (!isRecord(item) || typeof item.title !== 'string' || typeof item.link !== 'string') {
      return []
    }
    const title = item.title.trim()
    const link = item.link.trim()
    const source = getSource(link)
    if (!title || !source) return []

    return [{
      title,
      link,
      snippet: typeof item.snippet === 'string' ? item.snippet.trim() : '',
      source,
    }]
  }).slice(0, numResults)
}

function parseInput(input: unknown): GoogleSearchInput {
  if (!isRecord(input)) {
    throw new Error('Google Search input must be an object')
  }
  if (typeof input.query !== 'string' || !input.query.trim()) {
    throw new Error('Google Search query must be a non-empty string')
  }
  if (input.location !== undefined && (typeof input.location !== 'string' || !input.location.trim())) {
    throw new Error('Google Search location must be a non-empty string when provided')
  }
  if (
    input.numResults !== undefined &&
    (!Number.isInteger(input.numResults) ||
      (input.numResults as number) < 1 ||
      (input.numResults as number) > maximumResultCount)
  ) {
    throw new Error(`Google Search numResults must be an integer between 1 and ${maximumResultCount}`)
  }

  return {
    query: input.query.trim(),
    ...(typeof input.location === 'string' ? { location: input.location.trim() } : {}),
    ...(typeof input.numResults === 'number' ? { numResults: input.numResults } : {}),
  }
}

function buildSearchParameters(input: GoogleSearchInput): SerpApiSearchParameters {
  return {
    engine: 'google',
    q: input.query,
    ...(input.location ? { location: input.location } : {}),
    num: input.numResults ?? defaultResultCount,
  }
}

export function createGoogleSearchTool(client: SerpApiClient): ToolDefinition<GoogleSearchInput, GoogleSearchOutput> {
  return {
    id: 'google-search',
    description: 'Search the web with Google and return organic results with source domains.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'The web search query.' },
        location: { type: 'string', description: 'Optional location used to localize results.' },
        numResults: {
          type: 'integer',
          description: `Optional number of results to return, from 1 to ${maximumResultCount}.`,
        },
      },
      required: ['query'],
      additionalProperties: false,
    },
    supports: (goal: MissionGoal) => goal.description.trim().length > 0,
    createInput: ({ goal }) => ({ query: goal.description }),
    parseInput,
    execute: async (input) => ({
      query: input.query,
      results: parseGoogleSearchResponse(
        await client.search(buildSearchParameters(input)),
        input.numResults,
      ),
    }),
  }
}