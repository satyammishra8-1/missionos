import type { ConstraintEvaluator } from '../../agent/Agent.js'
import type {
  ConstraintAssessment,
  ConstraintEvaluation,
  MissionGoal,
  AgentPlan,
  PlanStep,
  ToolObservation,
} from '../../agent/types.js'

type RecordEntry = { key: string; value: unknown }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function entriesIn(value: unknown, entries: RecordEntry[] = []): RecordEntry[] {
  if (Array.isArray(value)) {
    for (const item of value) entriesIn(item, entries)
  } else if (isRecord(value)) {
    for (const [key, item] of Object.entries(value)) {
      entries.push({ key, value: item })
      entriesIn(item, entries)
    }
  }
  return entries
}

function normalizedText(value: string): string {
  return value.trim().toLocaleLowerCase().replace(/\s+/g, ' ')
}

function assessment(
  constraint: string,
  status: ConstraintAssessment['status'],
  reason: string,
): ConstraintAssessment {
  return { constraint, status, reason }
}

function expectedMaximum(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) return value
  if (!isRecord(value)) return undefined
  for (const key of ['max', 'maximum', 'limit', 'amount', 'budget']) {
    const candidate = value[key]
    if (typeof candidate === 'number' && Number.isFinite(candidate) && candidate >= 0) return candidate
  }
  return undefined
}

function moneyValue(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) return value
  if (typeof value !== 'string') return undefined
  const match = value.replace(/,/g, '').match(/\d+(?:\.\d+)?/)
  if (!match?.[0]) return undefined
  const amount = Number(match[0])
  return Number.isFinite(amount) ? amount : undefined
}

function normalizeCurrency(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const normalized = value.trim().toUpperCase()
  if (normalized === '₹' || normalized === 'RS' || normalized === 'RS.') return 'INR'
  if (normalized === '$') return 'USD'
  if (normalized === '€') return 'EUR'
  if (normalized === '£') return 'GBP'
  return /^[A-Z]{3}$/.test(normalized) ? normalized : undefined
}

function assessBudget(value: unknown, observations: readonly ToolObservation[]): ConstraintAssessment {
  const maximum = expectedMaximum(value)
  if (maximum === undefined) {
    return assessment('budget', 'unknown', 'Budget must be a non-negative number or an object with a numeric maximum.')
  }
  const budgetRecord = isRecord(value) ? value : undefined
  const expectedCurrency = normalizeCurrency(budgetRecord?.currency)
  const requiresTotal = budgetRecord?.scope === 'total'
  const prices = observations.filter((item) => item.ok).flatMap((item) => {
    const records = entriesIn(item.output)
    const currency = records
      .filter(({ key }) => key.toLowerCase() === 'currency')
      .map(({ value: candidate }) => normalizeCurrency(candidate))
      .find((candidate): candidate is string => candidate !== undefined)
    return records
      .filter(({ key }) => /^(price|cost|amount|total_price|trip_total|total_cost|extracted_price|extracted_lowest)$/i.test(key))
      .flatMap(({ value: candidate }) => {
        const amount = moneyValue(candidate)
        if (amount === undefined) return []
        const displayCurrency = typeof candidate === 'string'
          ? candidate.match(/[₹$€£]/)?.[0]
          : undefined
        return [{ amount, currency: normalizeCurrency(displayCurrency) ?? currency }]
      })
  })
  if (prices.length === 0) {
    return assessment('budget', 'unknown', 'No comparable price evidence has been observed.')
  }
  if (requiresTotal && !entriesIn(observations.filter((item) => item.ok).map((item) => item.output))
    .some(({ key }) => /^(trip_total|total_cost)$/i.test(key))) {
    return assessment('budget', 'unknown', 'Individual prices are available, but no evidence-backed total trip cost was returned.')
  }
  if (expectedCurrency && prices.some((price) => !price.currency)) {
    return assessment('budget', 'unknown', `Price currency cannot be verified as ${expectedCurrency}.`)
  }
  const comparable = prices.filter((price) => !expectedCurrency || price.currency === expectedCurrency)
  if (comparable.length === 0) {
    return assessment('budget', 'unknown', `No prices were returned in ${expectedCurrency ?? 'the requested currency'}.`)
  }
  if (comparable.some(({ amount }) => amount <= maximum)) {
    return assessment('budget', 'satisfied', `At least one observed option is within the ${maximum} budget.`)
  }
  return assessment('budget', 'violated', `All comparable observed prices exceed the ${maximum} budget.`)
}

function assessDurationDays(
  value: unknown,
  goal: MissionGoal,
  observations: readonly ToolObservation[],
  planHistory: readonly AgentPlan[],
): ConstraintAssessment {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
    return assessment('durationDays', 'unknown', 'Duration must be a positive whole number of days.')
  }
  const requirements = goal.metadata?.missionRequirements
  const explicitDates = isRecord(requirements) && Array.isArray(requirements.explicitDates)
    ? requirements.explicitDates.filter((item): item is string => typeof item === 'string')
    : []
  if (explicitDates.length < 2) {
    return assessment('durationDays', 'unknown', `Exact travel dates are needed to verify the ${value}-day duration.`)
  }

  const successfulStepIds = new Set(observations.filter((item) => item.ok).map((item) => item.stepId))
  const inputs = planHistory.flatMap((plan) => plan.steps)
    .filter((step) => successfulStepIds.has(step.id))
    .map((step) => step.input)
  const stays = inputs.flatMap((input) => {
    if (!isRecord(input) || typeof input.checkIn !== 'string' || typeof input.checkOut !== 'string') return []
    const checkIn = datePart(input.checkIn)
    const checkOut = datePart(input.checkOut)
    if (!checkIn || !checkOut) return []
    return [{ checkIn, checkOut }]
  })
  if (stays.length === 0) {
    return assessment('durationDays', 'unknown', 'No successful hotel search has verifiable check-in and check-out dates.')
  }
  const expectedStart = datePart(explicitDates[0]!)
  const expectedEnd = datePart(explicitDates.at(-1)!)
  if (!expectedStart || !expectedEnd || expectedEnd < expectedStart) {
    return assessment('durationDays', 'unknown', 'The provided travel date range is invalid.')
  }
  const expectedDays = Math.floor((Date.parse(`${expectedEnd}T00:00:00Z`) - Date.parse(`${expectedStart}T00:00:00Z`)) / 86_400_000) + 1
  const matches = stays.some(({ checkIn, checkOut }) => checkIn === expectedStart && checkOut === expectedEnd)
  if (!matches || expectedDays !== value) {
    return assessment('durationDays', 'violated', `Hotel dates do not verify the requested ${value}-day trip.`)
  }
  return assessment('durationDays', 'satisfied', `The hotel search covers the requested ${value} days.`)
}

function assessRoute(value: unknown, observations: readonly ToolObservation[]): ConstraintAssessment {
  if (!isRecord(value) || typeof value.origin !== 'string' || typeof value.destination !== 'string') {
    return assessment('route', 'unknown', 'Route must include origin and destination locations.')
  }
  const flightResults = observations.filter((item) => item.ok && /flight/i.test(item.toolId))
  if (flightResults.length === 0) {
    return assessment('route', 'unknown', 'No successful flight search has verified the route.')
  }
  const origin = normalizedText(value.origin)
  const destination = normalizedText(value.destination)
  const matchingRoute = flightResults.some((item) => {
    const fields = entriesIn(item.output)
    const departures = fields.filter(({ key }) => /^(departure|origin)$/i.test(key))
      .map(({ value: field }) => typeof field === 'string' ? normalizedText(field) : '')
    const arrivals = fields.filter(({ key }) => /^(destination|arrival)$/i.test(key))
      .map(({ value: field }) => typeof field === 'string' ? normalizedText(field) : '')
    return departures.some((field) => field.includes(origin)) && arrivals.some((field) => field.includes(destination))
  })
  return matchingRoute
    ? assessment('route', 'satisfied', 'A successful flight search matches the requested origin and destination.')
    : assessment('route', 'violated', 'No successful flight search matches the requested origin and destination.')
}

function hasUsefulResult(value: unknown): boolean {
  if (Array.isArray(value)) return value.some((item) => hasUsefulResult(item))
  if (!isRecord(value)) return typeof value === 'string' && Boolean(value.trim())
  return Object.entries(value).some(([key, item]) => {
    if (['query', 'departure', 'destination', 'currency'].includes(key)) return false
    return Array.isArray(item) ? item.length > 0 && item.some((entry) => hasUsefulResult(entry))
      : isRecord(item) ? hasUsefulResult(item)
        : item !== null && item !== undefined && item !== ''
  })
}

function assessRequiredTools(value: unknown, observations: readonly ToolObservation[]): ConstraintAssessment {
  if (!Array.isArray(value) || !value.every((item) => typeof item === 'string')) {
    return assessment('requiredTools', 'unknown', 'Required tool capabilities are not a valid list.')
  }
  const missing: string[] = []
  const failed: string[] = []
  for (const toolId of value) {
    const toolObservations = observations.filter((item) => item.toolId === toolId)
    if (toolObservations.some((item) => item.ok && hasUsefulResult(item.output))) continue
    if (toolObservations.some((item) => !item.ok)) failed.push(toolId)
    else missing.push(toolId)
  }
  if (failed.length > 0) {
    return assessment('requiredTools', 'violated', `Required tools failed: ${failed.join(', ')}.`)
  }
  if (missing.length > 0) {
    return assessment('requiredTools', 'unknown', `Required tools have not returned useful results: ${missing.join(', ')}.`)
  }
  return assessment('requiredTools', 'satisfied', 'All requested tool capabilities returned useful results.')
}

function datePart(value: string): string | undefined {
  const match = value.match(/\b\d{4}-\d{2}-\d{2}\b/)
  if (!match) return undefined
  const date = new Date(`${match[0]}T00:00:00.000Z`)
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === match[0]
    ? match[0]
    : undefined
}

function dateKey(key: string): string | undefined {
  const normalized = key.toLowerCase().replace(/[^a-z]/g, '')
  if (normalized === 'date' || normalized === 'departuredate' || normalized === 'departure') return 'departureDate'
  if (normalized === 'returndate' || normalized === 'return') return 'returnDate'
  if (normalized === 'checkin' || normalized === 'checkindate') return 'checkIn'
  if (normalized === 'checkout' || normalized === 'checkoutdate') return 'checkOut'
  return undefined
}

function dateFields(value: unknown): Map<string, string[]> {
  const dates = new Map<string, string[]>()
  for (const { key, value: candidate } of entriesIn(value)) {
    const field = dateKey(key)
    if (!field || typeof candidate !== 'string') continue
    const date = datePart(candidate)
    if (!date) continue
    dates.set(field, [...(dates.get(field) ?? []), date])
  }
  return dates
}

function assessDate(
  value: unknown,
  observations: readonly ToolObservation[],
  currentStep?: PlanStep,
  planHistory: readonly AgentPlan[] = [],
): ConstraintAssessment {
  const expected = typeof value === 'string'
    ? [['departureDate', value] as const]
    : isRecord(value)
      ? Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === 'string')
      : []
  if (expected.length === 0) {
    return assessment('date', 'unknown', 'Date must be an ISO date or an object of date fields.')
  }

  const actual = new Map<string, string[]>()
  const successfulStepIds = new Set(observations.filter((item) => item.ok).map((item) => item.stepId))
  const priorInputs = planHistory.flatMap((plan) => plan.steps
    .filter((step) => successfulStepIds.has(step.id))
    .map((step) => step.input))
  for (const source of [...priorInputs, currentStep?.input, ...observations.filter((item) => item.ok).map((item) => item.output)]) {
    for (const [field, dates] of dateFields(source)) {
      actual.set(field, [...(actual.get(field) ?? []), ...dates])
    }
  }

  let found = 0
  let missing = 0
  for (const [rawField, rawDate] of expected) {
    const field = dateKey(rawField) ?? rawField
    const target = datePart(rawDate)
    if (!target) return assessment('date', 'unknown', `Constraint date ${rawDate} is invalid.`)
    const candidates = field === 'departureDate' && typeof value === 'string'
      ? [...actual.values()].flat()
      : actual.get(field) ?? []
    if (candidates.length === 0) {
      missing += 1
    } else if (candidates.includes(target)) {
      found += 1
    } else {
      return assessment('date', 'violated', `Observed dates do not match ${rawField} ${target}.`)
    }
  }
  if (missing > 0) {
    return assessment('date', 'unknown', `Date evidence is missing for ${missing} requested date field(s).`)
  }
  return found === expected.length
    ? assessment('date', 'satisfied', 'Observed search dates match the requested dates.')
    : assessment('date', 'unknown', 'No comparable date evidence has been observed.')
}

function expectedStrings(value: unknown): string[] {
  if (typeof value === 'string' && value.trim()) return [value.trim()]
  if (Array.isArray(value) && value.every((item) => typeof item === 'string' && item.trim())) {
    return value.map((item: string) => item.trim())
  }
  return []
}

function assessLocation(
  value: unknown,
  observations: readonly ToolObservation[],
  currentStep?: PlanStep,
  planHistory: readonly AgentPlan[] = [],
): ConstraintAssessment {
  const expected = expectedStrings(value)
  if (expected.length === 0) {
    return assessment('location', 'unknown', 'Location must be a non-empty string or list of strings.')
  }
  const successfulStepIds = new Set(observations.filter((item) => item.ok).map((item) => item.stepId))
  const priorInputs = planHistory.flatMap((plan) => plan.steps
    .filter((step) => successfulStepIds.has(step.id))
    .map((step) => step.input))
  const candidates = [...priorInputs, currentStep?.input, ...observations.filter((item) => item.ok).map((item) => item.output)]
    .flatMap((source) => entriesIn(source)
      .filter(({ key, value: candidate }) =>
        /^(location|destination|departure|arrival|address|city|q)$/i.test(key) && typeof candidate === 'string')
      .map(({ value: candidate }) => candidate as string))
  if (candidates.length === 0) {
    return assessment('location', 'unknown', 'No location evidence has been observed.')
  }
  const unmatched = expected.filter((target) =>
    !candidates.some((candidate) => normalizedText(candidate).includes(normalizedText(target))),
  )
  return unmatched.length === 0
    ? assessment('location', 'satisfied', 'Observed locations match the requested location.')
    : assessment('location', 'violated', `No observed location matches: ${unmatched.join(', ')}.`)
}

function timeValue(value: string): number[] {
  return [...value.matchAll(/(?:T|\b)(\d{1,2}):(\d{2})(?::\d{2})?/g)]
    .flatMap((match) => {
      const hour = Number(match[1])
      const minute = Number(match[2])
      return hour <= 23 && minute <= 59 ? [hour * 60 + minute] : []
    })
}

function assessTime(
  value: unknown,
  observations: readonly ToolObservation[],
): ConstraintAssessment {
  const records = observations.filter((item) => item.ok).flatMap((item) => entriesIn(item.output))
  const times = records
    .filter(({ key, value: candidate }) => /time|departure|arrival|check.?in|check.?out/i.test(key) && typeof candidate === 'string')
    .flatMap(({ value: candidate }) => timeValue(candidate as string))
  if (times.length === 0) return assessment('time', 'unknown', 'No comparable time evidence has been observed.')

  if (typeof value === 'string') {
    const expected = timeValue(value)
    if (expected.length === 0) return assessment('time', 'unknown', 'Time must include a valid HH:mm value.')
    return times.includes(expected[0]!)
      ? assessment('time', 'satisfied', `Observed time matches ${value}.`)
      : assessment('time', 'violated', `No observed time matches ${value}.`)
  }
  if (!isRecord(value) || typeof value.start !== 'string' || typeof value.end !== 'string') {
    return assessment('time', 'unknown', 'Time must be HH:mm or an object with start and end values.')
  }
  const start = timeValue(value.start)[0]
  const end = timeValue(value.end)[0]
  if (start === undefined || end === undefined || end < start) {
    return assessment('time', 'unknown', 'Time range is invalid.')
  }
  return times.some((time) => time >= start && time <= end)
    ? assessment('time', 'satisfied', 'At least one observed time is within the requested range.')
    : assessment('time', 'violated', 'No observed time is within the requested range.')
}

function assessPreferences(value: unknown, observations: readonly ToolObservation[]): ConstraintAssessment {
  const required = expectedStrings(value)
  if (required.length === 0) {
    return assessment('requiredPreferences', 'unknown', 'Required preferences must be a non-empty list of strings.')
  }
  const available = observations.filter((item) => item.ok).flatMap((item) => entriesIn(item.output))
    .filter(({ key, value: candidate }) => /^(amenities|preferences|features)$/i.test(key) && Array.isArray(candidate))
    .flatMap(({ value: candidate }) => (candidate as unknown[]).filter((item): item is string => typeof item === 'string'))
  if (available.length === 0) {
    return assessment('requiredPreferences', 'unknown', 'No preference or amenity evidence has been observed.')
  }
  const unmatched = required.filter((target) =>
    !available.some((item) => normalizedText(item).includes(normalizedText(target))),
  )
  return unmatched.length === 0
    ? assessment('requiredPreferences', 'satisfied', 'All required preferences appear in observed results.')
    : assessment('requiredPreferences', 'violated', `Required preferences not found: ${unmatched.join(', ')}.`)
}

export class MissionConstraintEvaluator implements ConstraintEvaluator {
  evaluate(
    goal: MissionGoal,
    observations: readonly ToolObservation[],
    currentStep?: PlanStep,
    planHistory: readonly AgentPlan[] = [],
  ): ConstraintEvaluation {
    const constraints = goal.metadata?.missionConstraints
    if (!isRecord(constraints)) return { satisfied: true, violations: [], assessments: [] }

    const assessments = Object.entries(constraints).map(([key, value]) => {
      switch (key.toLowerCase()) {
        case 'budget':
          return assessBudget(value, observations)
        case 'date':
        case 'dates':
          return assessDate(value, observations, currentStep, planHistory)
        case 'durationdays':
        case 'duration_days':
          return assessDurationDays(value, goal, observations, planHistory)
        case 'route':
          return assessRoute(value, observations)
        case 'requiredtools':
        case 'required_tools':
          return assessRequiredTools(value, observations)
        case 'location':
          return assessLocation(value, observations, currentStep, planHistory)
        case 'time':
          return assessTime(value, observations)
        case 'requiredpreferences':
        case 'required_preferences':
          return assessPreferences(value, observations)
        default:
          return assessment(key, 'unknown', 'No deterministic evaluator is defined for this constraint.')
      }
    })
    const violations = assessments
      .filter((item) => item.status === 'violated')
      .map((item) => `${item.constraint}: ${item.reason}`)
    return {
      satisfied: assessments.every((item) => item.status === 'satisfied'),
      violations,
      assessments,
    }
  }
}