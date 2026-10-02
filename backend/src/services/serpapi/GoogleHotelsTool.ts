import type { MissionGoal, ToolDefinition } from '../../agent/types.js'
import type {
  GoogleHotelPrice,
  GoogleHotelResult,
  GoogleHotelsInput,
  GoogleHotelsOutput,
  SerpApiClient,
  SerpApiSearchParameters,
} from './types.js'

const maximumGuests = 20
const maximumPreferences = 10
const maximumPreferenceLength = 80
const maximumHotelResults = 100

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isValidDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(`${value}T00:00:00.000Z`)
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
}

function parseInput(input: unknown): GoogleHotelsInput {
  if (!isRecord(input)) throw new Error('Google Hotels input must be an object')
  const allowedFields = new Set(['destination', 'checkIn', 'checkOut', 'guests', 'preferences', 'currency'])
  if (Object.keys(input).some((key) => !allowedFields.has(key))) {
    throw new Error('Google Hotels input contains unsupported fields')
  }
  if (typeof input.destination !== 'string' || !input.destination.trim()) {
    throw new Error('Google Hotels destination must be a non-empty string')
  }
  if (typeof input.checkIn !== 'string' || !isValidDate(input.checkIn)) {
    throw new Error('Google Hotels checkIn must be a valid YYYY-MM-DD date')
  }
  if (typeof input.checkOut !== 'string' || !isValidDate(input.checkOut)) {
    throw new Error('Google Hotels checkOut must be a valid YYYY-MM-DD date')
  }
  if (input.checkOut <= input.checkIn) {
    throw new Error('Google Hotels checkOut must be after checkIn')
  }
  if (
    !Number.isInteger(input.guests) ||
    (input.guests as number) < 1 ||
    (input.guests as number) > maximumGuests
  ) {
    throw new Error(`Google Hotels guests must be an integer between 1 and ${maximumGuests}`)
  }
  if (input.preferences !== undefined) {
    if (
      !Array.isArray(input.preferences) ||
      input.preferences.length > maximumPreferences ||
      !input.preferences.every((preference) =>
        typeof preference === 'string' &&
        preference.trim().length > 0 &&
        preference.trim().length <= maximumPreferenceLength,
      )
    ) {
      throw new Error(`Google Hotels preferences must be up to ${maximumPreferences} non-empty strings of at most ${maximumPreferenceLength} characters`)
    }
  }
  if (input.currency !== undefined && (typeof input.currency !== 'string' || !/^[A-Z]{3}$/.test(input.currency))) {
    throw new Error('Google Hotels currency must be a three-letter ISO currency code')
  }

  return {
    destination: input.destination.trim(),
    checkIn: input.checkIn,
    checkOut: input.checkOut,
    guests: input.guests as number,
    ...(Array.isArray(input.preferences)
      ? { preferences: input.preferences.map((preference) => preference.trim()) }
      : {}),
    ...(typeof input.currency === 'string' ? { currency: input.currency } : {}),
  }
}

function parsePrice(value: unknown): GoogleHotelPrice | undefined {
  if (isRecord(value)) {
    const amount = typeof value.extracted_lowest === 'number' && Number.isFinite(value.extracted_lowest)
      ? value.extracted_lowest
      : undefined
    const display = typeof value.lowest === 'string' && value.lowest.trim()
      ? value.lowest.trim()
      : undefined
    if (amount !== undefined || display) return { ...(amount !== undefined ? { amount } : {}), ...(display ? { display } : {}) }
  }
  if (typeof value === 'number' && Number.isFinite(value)) return { amount: value }
  if (typeof value === 'string' && value.trim()) return { display: value.trim() }
  return undefined
}

function parseHotelLink(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : undefined
  } catch {
    return undefined
  }
}

function createHotelsLink(input: GoogleHotelsInput, name: string): string {
  const url = new URL('https://www.google.com/travel/search')
  url.searchParams.set('q', `${name} in ${input.destination}`)
  url.searchParams.set('checkin', input.checkIn)
  url.searchParams.set('checkout', input.checkOut)
  return url.toString()
}

function parseHotel(
  value: unknown,
  input: GoogleHotelsInput,
): GoogleHotelResult | undefined {
  if (!isRecord(value)) return undefined
  const name = typeof value.name === 'string'
    ? value.name.trim()
    : typeof value.title === 'string' ? value.title.trim() : ''
  if (!name) return undefined

  const ratePerNight = parsePrice(value.rate_per_night)
  const price = ratePerNight ?? parsePrice(value.price)
  const rating = typeof value.overall_rating === 'number' && Number.isFinite(value.overall_rating)
    ? value.overall_rating
    : typeof value.rating === 'number' && Number.isFinite(value.rating) ? value.rating : undefined
  const reviews = typeof value.reviews === 'number' && Number.isFinite(value.reviews)
    ? value.reviews
    : undefined
  const location = typeof value.address === 'string' && value.address.trim()
    ? value.address.trim()
    : typeof value.location === 'string' && value.location.trim() ? value.location.trim() : undefined
  const amenities = Array.isArray(value.amenities)
    ? value.amenities.filter((amenity): amenity is string => typeof amenity === 'string' && Boolean(amenity.trim())).map((amenity) => amenity.trim())
    : undefined
  const link = parseHotelLink(value.link) ?? createHotelsLink(input, name)

  return {
    name,
    ...(price ? { price } : {}),
    ...(rating !== undefined ? { rating } : {}),
    ...(reviews !== undefined ? { reviews } : {}),
    ...(location ? { location } : {}),
    ...(amenities?.length ? { amenities } : {}),
    link,
  }
}

export function parseGoogleHotelsResponse(
  payload: unknown,
  input: GoogleHotelsInput,
): readonly GoogleHotelResult[] {
  if (!isRecord(payload)) throw new Error('Google Hotels returned an invalid response')
  if (typeof payload.error === 'string') throw new Error(`Google Hotels search failed: ${payload.error}`)
  if (!Array.isArray(payload.properties)) {
    throw new Error('Google Hotels response is missing properties')
  }

  const properties = payload.properties
  const results = properties.flatMap((property): GoogleHotelResult[] => {
    const hotel = parseHotel(property, input)
    return hotel ? [hotel] : []
  })
  if (properties.length > 0 && results.length === 0) {
    throw new Error('Google Hotels response contains no valid hotel properties')
  }
  return results.slice(0, maximumHotelResults)
}

function buildSearchParameters(input: GoogleHotelsInput): SerpApiSearchParameters {
  const query = [input.destination, ...(input.preferences ?? [])].join(' ')
  return {
    engine: 'google_hotels',
    q: query,
    check_in_date: input.checkIn,
    check_out_date: input.checkOut,
    adults: input.guests,
    ...(input.currency ? { currency: input.currency } : {}),
  }
}

export function createGoogleHotelsTool(
  client: SerpApiClient,
): ToolDefinition<GoogleHotelsInput, GoogleHotelsOutput> {
  return {
    id: 'google-hotels',
    description: 'Search Google Hotels by destination, stay dates, guest count, and optional preferences.',
    inputSchema: {
      type: 'object',
      properties: {
        destination: { type: 'string', description: 'The destination or location for the stay.' },
        checkIn: { type: 'string', description: 'Check-in date in YYYY-MM-DD format.' },
        checkOut: { type: 'string', description: 'Check-out date in YYYY-MM-DD format.' },
        guests: { type: 'integer', description: `Number of adult guests, from 1 to ${maximumGuests}.` },
        preferences: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional search terms such as amenities or hotel features.',
        },
        currency: { type: 'string', description: 'Optional three-letter currency code for price comparison.' },
      },
      required: ['destination', 'checkIn', 'checkOut', 'guests'],
      additionalProperties: false,
    },
    supports: (goal: MissionGoal) => goal.description.trim().length > 0,
    createInput: ({ goal }) => {
      const constraints = isRecord(goal.metadata?.missionConstraints)
        ? goal.metadata.missionConstraints
        : {}
      const route = isRecord(constraints.route) ? constraints.route : {}
      const dates = isRecord(constraints.date) ? constraints.date : {}
      const budget = isRecord(constraints.budget) ? constraints.budget : {}
      const requirements = isRecord(goal.metadata?.missionRequirements)
        ? goal.metadata.missionRequirements
        : {}
      const explicitDates = isRecord(goal.metadata?.missionRequirements) &&
        Array.isArray(goal.metadata.missionRequirements.explicitDates)
        ? goal.metadata.missionRequirements.explicitDates.filter((value): value is string => typeof value === 'string')
        : []
      const preferences = Array.isArray(constraints.requiredPreferences)
        ? constraints.requiredPreferences.filter((value): value is string => typeof value === 'string')
        : []
      return {
        destination: typeof route.destination === 'string'
          ? route.destination
          : typeof constraints.location === 'string' ? constraints.location : goal.description,
        checkIn: typeof dates.checkIn === 'string' ? dates.checkIn : explicitDates[0] ?? '',
        checkOut: typeof dates.checkOut === 'string' ? dates.checkOut : explicitDates[1] ?? '',
        guests: typeof requirements.passengers === 'number' ? requirements.passengers : 1,
        ...(preferences.length ? { preferences } : {}),
        ...(typeof budget.currency === 'string' ? { currency: budget.currency } : {}),
      }
    },
    parseInput,
    execute: async (input) => ({
      destination: input.destination,
      ...(input.currency ? { currency: input.currency } : {}),
      results: parseGoogleHotelsResponse(await client.search(buildSearchParameters(input)), input),
    }),
  }
}