import type { RegisteredTool } from '../../agent/types.js'
import {
  isFlightRequest,
  isHotelRequest,
  isPlacesRequest,
  isTravelResearchRequest,
  isTripPlanningRequest,
} from './travelIntent.js'

export interface ExtractedMissionRequirements {
  constraints: Readonly<Record<string, unknown>>
  requiredToolIds: readonly string[]
  explicitDates: readonly string[]
  missingInformation: readonly string[]
  passengers?: number
}

interface ToolIntentRule {
  missionIntent: (goal: string) => boolean
  toolCapability: RegExp
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

const toolIntentRules: readonly ToolIntentRule[] = [
  { missionIntent: isFlightRequest, toolCapability: /flight/i },
  { missionIntent: isHotelRequest, toolCapability: /hotel/i },
  { missionIntent: isPlacesRequest, toolCapability: /maps|places/i },
  { missionIntent: isTravelResearchRequest, toolCapability: /google-search|web search/i },
  { missionIntent: isTripPlanningRequest, toolCapability: /google-search|web search/i },
  { missionIntent: isTripPlanningRequest, toolCapability: /google-maps|places/i },
]

function extractBudget(goal: string): { amount: number; currency?: string } | undefined {
  const match = goal.match(
    /(?:\bbudget\s+(?:under|below|of|up to)\b|\b(?:under|below|within|less than|at most)\b)\s*(₹|INR|Rs\.?|USD|\$|EUR|€|GBP|£)?\s*([\d,]+(?:\.\d+)?)/i,
  )
  if (!match?.[2]) return undefined
  const amount = Number(match[2].replace(/,/g, ''))
  if (!Number.isFinite(amount) || amount < 0) return undefined

  const currencyToken = match[1]?.toUpperCase()
  const currency = currencyToken === '₹' || currencyToken === 'INR' || currencyToken?.startsWith('RS')
    ? 'INR'
    : currencyToken === '$' || currencyToken === 'USD' ? 'USD'
      : currencyToken === '€' || currencyToken === 'EUR' ? 'EUR'
        : currencyToken === '£' || currencyToken === 'GBP' ? 'GBP' : undefined
  return { amount, ...(currency ? { currency } : {}) }
}

function extractDurationDays(goal: string): number | undefined {
  const match = goal.match(/\b(\d{1,2})\s*[- ]?days?\b/i)
  if (!match?.[1]) return undefined
  const days = Number(match[1])
  return days > 0 ? days : undefined
}

function extractRoute(goal: string): { origin: string; destination: string } | undefined {
  const explicitRoute = goal.match(
    /\bfrom\s+([\p{L}][\p{L}.'-]*(?:\s+[\p{L}][\p{L}.'-]*)*?)\s+to\s+([\p{L}][\p{L}.'-]*(?:\s+[\p{L}][\p{L}.'-]*)*?)(?=\s+(?:for|on|under|below|within|with|and|by|today|tomorrow|this\s+weekend|next\s+(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday))\b|[,.;]|$)/iu,
  )
  if (explicitRoute?.[1] && explicitRoute[2]) {
    return { origin: explicitRoute[1].trim(), destination: explicitRoute[2].trim() }
  }

  const arrowRoute = goal.match(
    /(?:^|\bfrom\s+|\bflights?\s+|:\s*|,\s*)([\p{L}][\p{L}.'-]*(?:\s+[\p{L}][\p{L}.'-]*)*?)\s*(?:→|->)\s*([\p{L}][\p{L}.'-]*(?:\s+[\p{L}][\p{L}.'-]*)*?)(?=\s+(?:flights?|hotels?|for|on|under|below|within|with|today|tomorrow|this\s+weekend|next\s+(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday))\b|[,.;]|$)/iu,
  )
  if (arrowRoute?.[1] && arrowRoute[2]) {
    return { origin: arrowRoute[1].trim(), destination: arrowRoute[2].trim() }
  }

  const tripFromRoute = goal.match(
    /\b([\p{Lu}][\p{L}.'-]+(?:\s+[\p{Lu}][\p{L}.'-]+)*)\s+trip\s+from\s+([\p{Lu}][\p{L}.'-]+(?:\s+[\p{Lu}][\p{L}.'-]+)*)/u,
  )
  if (tripFromRoute?.[1] && tripFromRoute[2]) {
    return { origin: tripFromRoute[2].trim(), destination: tripFromRoute[1].trim() }
  }
  return undefined
}

function extractDestination(goal: string, route: { origin: string; destination: string } | undefined): string | undefined {
  if (route) return route.destination
  const afterPreposition = goal.match(
    /\b(?:trip|itinerary|vacation|holiday|getaway|hotel|restaurants?|cafes?|attractions?|activities)\s+(?:to|in|at)\s+([\p{L}][\p{L}.'-]*(?:\s+[\p{L}][\p{L}.'-]*)*?)(?=\s+(?:for|under|below|on|with|and|tomorrow|today)\b|[,.;]|$)/iu,
  )
  if (afterPreposition?.[1]) return afterPreposition[1].trim()
  const beforeTrip = goal.match(/\b([\p{Lu}][\p{L}.'-]*(?:\s+[\p{Lu}][\p{L}.'-]*)*)\s+(?:trip|vacation|holiday|getaway)\b/u)
  if (beforeTrip?.[1]) return beforeTrip[1].trim()
  const leadingPlace = goal.match(
    /^\s*(?:find|show|recommend|discover|search for)\s+([\p{L}][\p{L}.'-]*(?:\s+[\p{L}][\p{L}.'-]*)*?)\s+(?:restaurants?|cafes?|coffee shops?|hotels?|attractions?|activities|places to visit)\b/iu,
  )
  if (leadingPlace?.[1]) return leadingPlace[1].trim()
  const placePreposition = goal.match(
    /\b(?:in|near|around|at)\s+([\p{L}][\p{L}.'-]*(?:\s+[\p{L}][\p{L}.'-]*)*?)(?=\s+(?:for|under|below|on|with|and|tomorrow|today)\b|[,.;]|$)/iu,
  )
  return placePreposition?.[1]?.trim()
}

function extractDates(goal: string): string[] {
  const dates: string[] = goal.match(/\b\d{4}-\d{2}-\d{2}\b/g) ?? []
  const monthNames = 'january|february|march|april|may|june|july|august|september|october|november|december'
  const writtenDate = new RegExp(`\\b(${monthNames})\\s+(\\d{1,2})(?:st|nd|rd|th)?[,]?\\s+(\\d{4})\\b|\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(${monthNames})[,]?\\s+(\\d{4})\\b`, 'gi')
  for (const match of goal.matchAll(writtenDate)) {
    const month = (match[1] ?? match[5])?.toLowerCase()
    const day = Number(match[2] ?? match[4])
    const year = Number(match[3] ?? match[6])
    if (!month || !day || !year) continue
    const monthNumber = new Date(`${month} 1, ${year}`).getMonth() + 1
    const date = new Date(Date.UTC(year, monthNumber - 1, day))
    if (date.getUTCFullYear() === year && date.getUTCMonth() === monthNumber - 1 && date.getUTCDate() === day) {
      dates.push(`${year}-${String(monthNumber).padStart(2, '0')}-${String(day).padStart(2, '0')}`)
    }
  }
  return [...new Set(dates)]
}

function formatLocalDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function dateAfterDays(now: Date, days: number): string {
  const date = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  date.setDate(date.getDate() + days)
  return formatLocalDate(date)
}

function extractRelativeDates(goal: string, now: Date): string[] {
  const weekdays: Readonly<Record<string, number>> = {
    monday: 1,
    tuesday: 2,
    wednesday: 3,
    thursday: 4,
    friday: 5,
    saturday: 6,
    sunday: 0,
  }
  const dates: string[] = []
  const relativeDatePattern = /\b(today|tomorrow|this weekend|next (?:monday|tuesday|wednesday|thursday|friday|saturday|sunday))\b/gi

  for (const match of goal.matchAll(relativeDatePattern)) {
    const phrase = match[0].toLowerCase()
    if (phrase === 'today') {
      dates.push(dateAfterDays(now, 0))
    } else if (phrase === 'tomorrow') {
      dates.push(dateAfterDays(now, 1))
    } else if (phrase === 'this weekend') {
      const daysUntilSaturday = (6 - now.getDay() + 7) % 7
      dates.push(dateAfterDays(now, daysUntilSaturday))
    } else {
      const weekday = weekdays[phrase.slice(5)]
      if (weekday !== undefined) {
        const daysUntilNextWeekday = (weekday - now.getDay() + 7) % 7 || 7
        dates.push(dateAfterDays(now, daysUntilNextWeekday))
      }
    }
  }

  return [...new Set(dates)]
}

export function extractMissionRequirements(
  goal: string,
  suppliedConstraints: Readonly<Record<string, unknown>>,
  tools: readonly RegisteredTool[],
  now: Date = new Date(),
): ExtractedMissionRequirements {
  const constraints: Record<string, unknown> = { ...suppliedConstraints }
  const budget = extractBudget(goal)
  if (budget && constraints.budget === undefined) {
    constraints.budget = {
      max: budget.amount,
      ...(budget.currency ? { currency: budget.currency } : {}),
      ...( /\btotal\s+budget\b/i.test(goal) ? { scope: 'total' } : {}),
    }
  }

  const durationDays = extractDurationDays(goal)
  if (durationDays !== undefined && constraints.durationDays === undefined) {
    constraints.durationDays = durationDays
  }

  const routeConstraint = isRecord(constraints.route) ? constraints.route : undefined
  const suppliedRoute = typeof routeConstraint?.origin === 'string' &&
    typeof routeConstraint.destination === 'string'
    ? {
        origin: routeConstraint.origin,
        destination: routeConstraint.destination,
      }
    : undefined
  const route = extractRoute(goal) ?? suppliedRoute
  if (route && constraints.route === undefined) constraints.route = route
  const destination = extractDestination(goal, route)
  if (destination && constraints.location === undefined) constraints.location = destination
  const hasDestination = (typeof constraints.location === 'string' && constraints.location.trim().length > 0) ||
    Boolean(route?.destination.trim())

  const suppliedDateValues = constraints.date ?? constraints.dates
  const suppliedDates = typeof suppliedDateValues === 'string'
    ? [suppliedDateValues]
    : suppliedDateValues !== null && typeof suppliedDateValues === 'object'
      ? Object.values(suppliedDateValues).filter((item): item is string => typeof item === 'string')
      : []
  const suppliedExplicitDates = [...new Set([
    ...extractDates(goal),
    ...suppliedDates.flatMap((item) => item.match(/\b\d{4}-\d{2}-\d{2}\b/g) ?? []),
  ])]
  const explicitDates = suppliedExplicitDates.length > 0
    ? suppliedExplicitDates
    : extractRelativeDates(goal, now)
  if (explicitDates.length > 0 && constraints.date === undefined) {
    constraints.date = explicitDates.length === 1
      ? explicitDates[0]
      : {
          departureDate: explicitDates[0],
          returnDate: explicitDates.at(-1),
          checkIn: explicitDates[0],
          checkOut: explicitDates.at(-1),
        }
  }

  const missingInformation: string[] = []
  if ((isTripPlanningRequest(goal) || isHotelRequest(goal) || isPlacesRequest(goal)) && !hasDestination) {
    missingInformation.push(isTripPlanningRequest(goal)
      ? 'Specify the destination before planning a trip.'
      : isHotelRequest(goal)
        ? 'Specify the destination for the hotel search.'
        : 'Specify the city or area for the places search.')
  }
  if (isFlightRequest(goal) && (!route?.origin.trim() || !route.destination.trim())) {
    missingInformation.push('Specify both the departure city and destination for the flight search.')
  }
  if (isFlightRequest(goal) && explicitDates.length === 0) {
    missingInformation.push('Provide an exact date for departure before searching for flights.')
  }
  if (isHotelRequest(goal) && explicitDates.length < 2) {
    missingInformation.push('Provide exact dates for hotel check-in and check-out.')
  }
  if (constraints.durationDays !== undefined && explicitDates.length < 2) {
    missingInformation.push('Provide exact dates to verify the requested trip duration.')
  }

  const requiredToolIds = new Set(
    Array.isArray(constraints.requiredTools)
      ? constraints.requiredTools.filter((value): value is string => typeof value === 'string')
      : [],
  )
  for (const rule of toolIntentRules) {
    if (!rule.missionIntent(goal)) continue
    const tool = tools.find((candidate) => rule.toolCapability.test(`${candidate.id} ${candidate.description}`))
    if (tool) requiredToolIds.add(tool.id)
  }
  if (requiredToolIds.size > 0) constraints.requiredTools = [...requiredToolIds]

  const passengerMatch = goal.match(/\b(\d{1,2})\s+(?:people|persons?|passengers?|adults?|guests?|travelers?|travellers?)\b/i)
  const passengers = passengerMatch ? Number(passengerMatch[1]) : undefined
  return {
    constraints,
    requiredToolIds: [...requiredToolIds],
    explicitDates,
    missingInformation,
    ...(passengers && passengers > 0 ? { passengers } : {}),
  }
}