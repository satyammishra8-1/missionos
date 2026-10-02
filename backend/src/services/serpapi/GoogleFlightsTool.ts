import { createRequire } from 'node:module'
import type { MissionGoal, ToolDefinition } from '../../agent/types.js'
import type {
  GoogleFlightsInput,
  GoogleFlightsOutput,
  GoogleFlightResult,
  SerpApiClient,
  SerpApiSearchParameters,
} from './types.js'

const maximumPassengers = 9
const maximumFlightResults = 50
const travelClasses = {
  economy: 1,
  premium_economy: 2,
  business: 3,
  first: 4,
} as const

interface AirportRecord {
  city?: string
  iata?: string
  name?: string
}

const require = createRequire(import.meta.url)
const airports = require('airport-codes/airports.json') as readonly AirportRecord[]

function normalizeLocation(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase()
}

const locationAliases: Readonly<Record<string, string>> = {
  bengaluru: 'bangalore',
}

function resolveAirportId(location: string, fieldName: string): string {
  const value = location.trim()
  if (/^[a-z]{3}$/i.test(value)) return value.toUpperCase()
  if (/^\/[mg]\//i.test(value)) return value

  const normalized = locationAliases[normalizeLocation(value)] ?? normalizeLocation(value)
  const airport = airports.find((candidate) =>
    candidate.city && normalizeLocation(candidate.city) === normalized,
  ) ?? airports.find((candidate) =>
    candidate.name && normalizeLocation(candidate.name) === normalized,
  )
  if (airport?.iata && /^[A-Z]{3}$/.test(airport.iata)) return airport.iata

  throw new Error(
    `Google Flights ${fieldName} must be an IATA airport code, Google location KGmid, or a city in the airport directory: ${value}`,
  )
}

function airportIdentity(location: string): string {
  const value = location.trim()
  if (/^[a-z]{3}$/i.test(value)) return value.toUpperCase()
  if (/^\/[mg]\//i.test(value)) return value.toLowerCase()

  const normalized = locationAliases[normalizeLocation(value)] ?? normalizeLocation(value)
  const airport = airports.find((candidate) =>
    candidate.city && normalizeLocation(candidate.city) === normalized,
  ) ?? airports.find((candidate) =>
    candidate.name && normalizeLocation(candidate.name) === normalized,
  )
  return airport?.iata ?? normalized
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isValidDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(`${value}T00:00:00.000Z`)
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
}

function parseInput(input: unknown): GoogleFlightsInput {
  if (!isRecord(input)) throw new Error('Google Flights input must be an object')
  const allowedFields = new Set([
    'departure', 'destination', 'departureDate', 'returnDate', 'passengers', 'travelClass', 'currency',
  ])
  if (Object.keys(input).some((key) => !allowedFields.has(key))) {
    throw new Error('Google Flights input contains unsupported fields')
  }
  if (typeof input.departure !== 'string' || !input.departure.trim()) {
    throw new Error('Google Flights departure must be a non-empty string')
  }
  if (typeof input.destination !== 'string' || !input.destination.trim()) {
    throw new Error('Google Flights destination must be a non-empty string')
  }
  if (typeof input.departureDate !== 'string' || !isValidDate(input.departureDate)) {
    throw new Error('Google Flights departureDate must be a valid YYYY-MM-DD date')
  }
  if (input.returnDate !== undefined) {
    if (typeof input.returnDate !== 'string' || !isValidDate(input.returnDate)) {
      throw new Error('Google Flights returnDate must be a valid YYYY-MM-DD date')
    }
    if (input.returnDate <= input.departureDate) {
      throw new Error('Google Flights returnDate must be after departureDate')
    }
  }
  if (
    !Number.isInteger(input.passengers) ||
    (input.passengers as number) < 1 ||
    (input.passengers as number) > maximumPassengers
  ) {
    throw new Error(`Google Flights passengers must be an integer between 1 and ${maximumPassengers}`)
  }
  if (
    typeof input.travelClass !== 'string' ||
    !Object.hasOwn(travelClasses, input.travelClass)
  ) {
    throw new Error('Google Flights travelClass must be economy, premium_economy, business, or first')
  }
  if (input.currency !== undefined && (typeof input.currency !== 'string' || !/^[A-Z]{3}$/.test(input.currency))) {
    throw new Error('Google Flights currency must be a three-letter ISO currency code')
  }

  return {
    departure: input.departure.trim(),
    destination: input.destination.trim(),
    departureDate: input.departureDate,
    ...(typeof input.returnDate === 'string' ? { returnDate: input.returnDate } : {}),
    passengers: input.passengers as number,
    travelClass: input.travelClass as GoogleFlightsInput['travelClass'],
    ...(typeof input.currency === 'string' ? { currency: input.currency } : {}),
  }
}

function createFlightsLink(input: GoogleFlightsInput): string {
  const search = [
    `Flights from ${input.departure} to ${input.destination}`,
    `on ${input.departureDate}`,
    ...(input.returnDate ? [`returning ${input.returnDate}`] : []),
  ].join(' ')
  const url = new URL('https://www.google.com/travel/flights')
  url.searchParams.set('q', search)
  return url.toString()
}

function parseFlightGroup(
  group: unknown,
  searchLink: string,
): GoogleFlightResult | undefined {
  if (!isRecord(group) || !Array.isArray(group.flights) || group.flights.length === 0) {
    return undefined
  }

  const segments = group.flights
  const firstSegment = segments[0]
  const lastSegment = segments.at(-1)
  if (!isRecord(firstSegment) || !isRecord(lastSegment)) return undefined

  const airlines: string[] = []
  const flightNumbers: string[] = []
  for (const segment of segments) {
    if (!isRecord(segment)) return undefined
    if (typeof segment.airline !== 'string' || !segment.airline.trim()) return undefined
    if (typeof segment.flight_number !== 'string' || !segment.flight_number.trim()) return undefined
    airlines.push(segment.airline.trim())
    flightNumbers.push(segment.flight_number.trim())
  }

  const departureAirport = firstSegment.departure_airport
  const arrivalAirport = lastSegment.arrival_airport
  if (
    !isRecord(departureAirport) || typeof departureAirport.time !== 'string' || !departureAirport.time ||
    !isRecord(arrivalAirport) || typeof arrivalAirport.time !== 'string' || !arrivalAirport.time
  ) {
    return undefined
  }

  const price = group.price
  if (
    (typeof price !== 'number' && typeof price !== 'string') ||
    (typeof price === 'number' && !Number.isFinite(price))
  ) {
    return undefined
  }

  const segmentDuration = segments.reduce((total, segment) => {
    return isRecord(segment) && typeof segment.duration === 'number' && Number.isFinite(segment.duration)
      ? total + segment.duration
      : total
  }, 0)
  const duration = typeof group.total_duration === 'number' && Number.isFinite(group.total_duration)
    ? group.total_duration
    : segmentDuration
  if (duration <= 0) return undefined

  const link = typeof group.link === 'string' && /^https?:\/\//i.test(group.link)
    ? group.link
    : searchLink
  const layovers = Array.isArray(group.layovers) ? group.layovers.length : segments.length - 1

  return {
    airline: [...new Set(airlines)].join(', '),
    flightNumber: flightNumbers.join(', '),
    departure: departureAirport.time,
    arrival: arrivalAirport.time,
    duration,
    stops: Math.max(0, layovers),
    price,
    link,
  }
}

export function parseGoogleFlightsResponse(
  payload: unknown,
  input: GoogleFlightsInput,
): readonly GoogleFlightResult[] {
  if (!isRecord(payload)) throw new Error('Google Flights returned an invalid response')
  if (typeof payload.error === 'string') throw new Error(`Google Flights search failed: ${payload.error}`)

  const collections = ['best_flights', 'other_flights'] as const
  let hasCollection = false
  let candidateCount = 0
  const results: GoogleFlightResult[] = []
  const searchLink = createFlightsLink(input)

  for (const key of collections) {
    const value = payload[key]
    if (value === undefined) continue
    hasCollection = true
    if (!Array.isArray(value)) throw new Error(`Google Flights returned invalid ${key}`)
    candidateCount += value.length
    for (const group of value) {
      const result = parseFlightGroup(group, searchLink)
      if (result) results.push(result)
    }
  }
  if (!hasCollection) throw new Error('Google Flights response is missing flight results')
  if (candidateCount > 0 && results.length === 0) {
    throw new Error('Google Flights response contains no valid flight itineraries')
  }
  return results.slice(0, maximumFlightResults)
}

function buildSearchParameters(input: GoogleFlightsInput): SerpApiSearchParameters {
  return {
    engine: 'google_flights',
    departure_id: resolveAirportId(input.departure, 'departure'),
    arrival_id: resolveAirportId(input.destination, 'destination'),
    outbound_date: input.departureDate,
    type: input.returnDate ? 1 : 2,
    adults: input.passengers,
    travel_class: travelClasses[input.travelClass],
    ...(input.currency ? { currency: input.currency } : {}),
    ...(input.returnDate ? { return_date: input.returnDate } : {}),
  }
}

export function createGoogleFlightsTool(
  client: SerpApiClient,
): ToolDefinition<GoogleFlightsInput, GoogleFlightsOutput> {
  return {
    id: 'google-flights',
    description: 'Search Google Flights for itineraries matching route, date, passenger, and class details.',
    inputSchema: {
      type: 'object',
      properties: {
        departure: { type: 'string', description: 'Departure airport code or location.' },
        destination: { type: 'string', description: 'Arrival airport code or location.' },
        departureDate: { type: 'string', description: 'Departure date in YYYY-MM-DD format.' },
        returnDate: { type: 'string', description: 'Optional return date in YYYY-MM-DD format.' },
        passengers: { type: 'integer', description: `Number of passengers, from 1 to ${maximumPassengers}.` },
        travelClass: {
          type: 'string',
          enum: Object.keys(travelClasses),
          description: 'Economy, premium economy, business, or first class.',
        },
        currency: { type: 'string', description: 'Optional three-letter currency code for fare comparison.' },
      },
      required: ['departure', 'destination', 'departureDate', 'passengers', 'travelClass'],
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
      const explicitDates = Array.isArray(requirements.explicitDates)
        ? requirements.explicitDates.filter((value): value is string => typeof value === 'string')
        : []
      return {
        departure: typeof route.origin === 'string' ? route.origin : goal.description,
        destination: typeof route.destination === 'string' ? route.destination : goal.description,
        departureDate: typeof dates.departureDate === 'string' ? dates.departureDate : explicitDates[0] ?? '',
        ...(typeof dates.returnDate === 'string'
          ? { returnDate: dates.returnDate }
          : explicitDates[1] ? { returnDate: explicitDates[1] } : {}),
        passengers: typeof requirements.passengers === 'number' ? requirements.passengers : 1,
        travelClass: 'economy',
        ...(typeof budget.currency === 'string' ? { currency: budget.currency } : {}),
      }
    },
    parseInput,
    execute: async (input, context) => {
      const constraints = isRecord(context.goal.metadata?.missionConstraints)
        ? context.goal.metadata.missionConstraints
        : {}
      const route = isRecord(constraints.route) ? constraints.route : {}
      const departure = typeof route.origin === 'string' &&
        airportIdentity(route.origin) === airportIdentity(input.departure)
        ? route.origin
        : input.departure
      const destination = typeof route.destination === 'string' &&
        airportIdentity(route.destination) === airportIdentity(input.destination)
        ? route.destination
        : input.destination

      return {
        departure,
        destination,
        ...(input.currency ? { currency: input.currency } : {}),
        results: parseGoogleFlightsResponse(await client.search(buildSearchParameters(input)), input),
      }
    },
  }
}