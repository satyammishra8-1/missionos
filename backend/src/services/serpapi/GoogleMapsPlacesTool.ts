import type { MissionGoal, ToolDefinition } from '../../agent/types.js'
import type {
  GoogleMapsCoordinates,
  GoogleMapsPlaceResult,
  GoogleMapsPlacesInput,
  GoogleMapsPlacesOutput,
  SerpApiClient,
  SerpApiSearchParameters,
} from './types.js'

const defaultZoom = 14
const defaultResultLimit = 10
const maximumRadiusMeters = 1_000_000
const maximumResultLimit = 100

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function parseCoordinates(value: unknown): GoogleMapsCoordinates | undefined {
  if (!isRecord(value)) return undefined
  const latitude = optionalNumber(value.latitude)
  const longitude = optionalNumber(value.longitude)
  if (
    latitude === undefined || longitude === undefined ||
    latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180
  ) {
    return undefined
  }
  return { latitude, longitude }
}

function parsePlaceLink(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  try {
    const url = new URL(value)
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : undefined
  } catch {
    return undefined
  }
}

function getPlaceLink(item: Record<string, unknown>, name: string): string | undefined {
  const directLink = parsePlaceLink(item.link ?? item.place_link)
  if (directLink) return directLink
  if (typeof item.place_id !== 'string' || !item.place_id.trim()) return undefined

  const url = new URL('https://www.google.com/maps/search/')
  url.searchParams.set('api', '1')
  url.searchParams.set('query', name)
  url.searchParams.set('query_place_id', item.place_id.trim())
  return url.toString()
}

export function parseGoogleMapsPlacesResponse(
  payload: unknown,
  resultLimit = defaultResultLimit,
): readonly GoogleMapsPlaceResult[] {
  if (!isRecord(payload)) {
    throw new Error('Google Maps returned an invalid response')
  }
  if (typeof payload.error === 'string') {
    throw new Error(`Google Maps search failed: ${payload.error}`)
  }

  const localResults = payload.local_results
  if (localResults === undefined) return []
  if (!Array.isArray(localResults)) {
    throw new Error('Google Maps returned invalid local results')
  }

  return localResults.flatMap((item): GoogleMapsPlaceResult[] => {
    if (!isRecord(item)) return []
    const name = typeof item.title === 'string'
      ? item.title.trim()
      : typeof item.name === 'string' ? item.name.trim() : ''
    if (!name) return []

    const address = typeof item.address === 'string' ? item.address.trim() : undefined
    const rating = optionalNumber(item.rating)
    const reviewsCount = optionalNumber(item.reviews ?? item.reviews_count)
    const coordinates = parseCoordinates(item.gps_coordinates ?? item.coordinates)
    const placeLink = getPlaceLink(item, name)

    return [{
      name,
      ...(address ? { address } : {}),
      ...(rating !== undefined ? { rating } : {}),
      ...(reviewsCount !== undefined ? { reviewsCount } : {}),
      ...(coordinates ? { coordinates } : {}),
      ...(placeLink ? { placeLink } : {}),
    }]
  }).slice(0, resultLimit)
}

function parseInput(input: unknown): GoogleMapsPlacesInput {
  if (!isRecord(input)) {
    throw new Error('Google Maps Places input must be an object')
  }
  if (typeof input.query !== 'string' || !input.query.trim()) {
    throw new Error('Google Maps Places query must be a non-empty string')
  }
  if (input.location !== undefined && (typeof input.location !== 'string' || !input.location.trim())) {
    throw new Error('Google Maps Places location must be a non-empty string when provided')
  }
  if (
    input.radius !== undefined &&
    (!Number.isInteger(input.radius) ||
      (input.radius as number) < 1 ||
      (input.radius as number) > maximumRadiusMeters)
  ) {
    throw new Error(`Google Maps Places radius must be an integer between 1 and ${maximumRadiusMeters} meters`)
  }
  if (input.radius !== undefined && (typeof input.location !== 'string' || !input.location.trim())) {
    throw new Error('Google Maps Places radius requires a location')
  }
  if (
    input.resultLimit !== undefined &&
    (!Number.isInteger(input.resultLimit) ||
      (input.resultLimit as number) < 1 ||
      (input.resultLimit as number) > maximumResultLimit)
  ) {
    throw new Error(`Google Maps Places resultLimit must be an integer between 1 and ${maximumResultLimit}`)
  }

  return {
    query: input.query.trim(),
    ...(typeof input.location === 'string' ? { location: input.location.trim() } : {}),
    ...(typeof input.radius === 'number' ? { radius: input.radius } : {}),
    ...(typeof input.resultLimit === 'number' ? { resultLimit: input.resultLimit } : {}),
  }
}

function buildSearchParameters(input: GoogleMapsPlacesInput): SerpApiSearchParameters {
  return {
    engine: 'google_maps',
    type: 'search',
    q: input.query,
    ...(input.location
      ? {
          location: input.location,
          ...(input.radius !== undefined ? { m: input.radius * 2 } : { z: defaultZoom }),
        }
      : {}),
  }
}

export function createGoogleMapsPlacesTool(
  client: SerpApiClient,
): ToolDefinition<GoogleMapsPlacesInput, GoogleMapsPlacesOutput> {
  return {
    id: 'google-maps-places',
    description: 'Find places on Google Maps and return structured place details.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'The place or business to find.' },
        location: { type: 'string', description: 'Optional location used as the search origin.' },
        radius: {
          type: 'integer',
          description: `Optional search radius in meters, from 1 to ${maximumRadiusMeters}.`,
        },
        resultLimit: {
          type: 'integer',
          description: `Optional maximum number of returned places, from 1 to ${maximumResultLimit}.`,
        },
      },
      required: ['query'],
      additionalProperties: false,
    },
    supports: (goal: MissionGoal) => goal.description.trim().length > 0,
    createInput: ({ goal }) => {
      const constraints = isRecord(goal.metadata?.missionConstraints)
        ? goal.metadata.missionConstraints
        : {}
      const route = isRecord(constraints.route) ? constraints.route : {}
      const location = typeof constraints.location === 'string'
        ? constraints.location
        : typeof route.destination === 'string' ? route.destination : undefined
      const preferences = Array.isArray(constraints.requiredPreferences)
        ? constraints.requiredPreferences.filter((value): value is string => typeof value === 'string')
        : []
      return {
        query: [goal.description, ...preferences].join(' '),
        ...(location ? { location } : {}),
      }
    },
    parseInput,
    execute: async (input) => ({
      query: input.query,
      results: parseGoogleMapsPlacesResponse(
        await client.search(buildSearchParameters(input)),
        input.resultLimit,
      ),
    }),
  }
}