import type { RegisteredTool } from '../../agent/types.js'

export interface ExtractedMissionRequirements {
  constraints: Readonly<Record<string, unknown>>
  requiredToolIds: readonly string[]
  explicitDates: readonly string[]
  passengers?: number
}

interface ToolIntentRule {
  missionIntent: RegExp
  toolCapability: RegExp
}

const toolIntentRules: readonly ToolIntentRule[] = [
  { missionIntent: /\b(?:flights?|fly|flying|airfares?|air travel)\b/i, toolCapability: /flight/i },
  { missionIntent: /\b(?:hotels?|lodging|accommodation|overnight stay)\b/i, toolCapability: /hotel/i },
  { missionIntent: /\b(?:nearby food|food options?|restaurants?|cafes?|nearby places|places nearby)\b/i, toolCapability: /maps|places/i },
  { missionIntent: /\b(?:web search|search the web|research online)\b/i, toolCapability: /google-search|web search/i },
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

  const tripFromRoute = goal.match(
    /\b([\p{Lu}][\p{L}.'-]+(?:\s+[\p{Lu}][\p{L}.'-]+)*)\s+trip\s+from\s+([\p{Lu}][\p{L}.'-]+(?:\s+[\p{Lu}][\p{L}.'-]+)*)/u,
  )
  if (tripFromRoute?.[1] && tripFromRoute[2]) {
    return { origin: tripFromRoute[2].trim(), destination: tripFromRoute[1].trim() }
  }
  return undefined
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

  const route = extractRoute(goal)
  if (route && constraints.route === undefined) constraints.route = route

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

  const requiredToolIds = new Set(
    Array.isArray(constraints.requiredTools)
      ? constraints.requiredTools.filter((value): value is string => typeof value === 'string')
      : [],
  )
  for (const rule of toolIntentRules) {
    if (!rule.missionIntent.test(goal)) continue
    const tool = tools.find((candidate) => rule.toolCapability.test(`${candidate.id} ${candidate.description}`))
    if (tool) requiredToolIds.add(tool.id)
  }
  if (requiredToolIds.size > 0) constraints.requiredTools = [...requiredToolIds]

  const passengerMatch = goal.match(/\b(\d{1,2})\s+(?:people|persons?|passengers?|travelers?|travellers?)\b/i)
  const passengers = passengerMatch ? Number(passengerMatch[1]) : undefined
  return {
    constraints,
    requiredToolIds: [...requiredToolIds],
    explicitDates,
    ...(passengers && passengers > 0 ? { passengers } : {}),
  }
}