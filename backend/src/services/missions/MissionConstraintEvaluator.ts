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

function assessBudget(value: unknown, observations: readonly ToolObservation[]): ConstraintAssessment {
  const maximum = expectedMaximum(value)
  if (maximum === undefined) {
    return assessment('budget', 'unknown', 'Budget must be a non-negative number or an object with a numeric maximum.')
  }
  const amounts = observations.filter((item) => item.ok).flatMap((item) =>
    entriesIn(item.output)
      .filter(({ key }) => /^(price|cost|amount|total_price|extracted_price|extracted_lowest)$/i.test(key))
      .map(({ value: candidate }) => moneyValue(candidate))
      .filter((candidate): candidate is number => candidate !== undefined),
  )
  if (amounts.length === 0) {
    return assessment('budget', 'unknown', 'No comparable price evidence has been observed.')
  }
  if (amounts.some((amount) => amount <= maximum)) {
    return assessment('budget', 'satisfied', `At least one observed option is within the ${maximum} budget.`)
  }
  return assessment('budget', 'violated', `All observed prices exceed the ${maximum} budget.`)
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
  const priorInputs = planHistory.flatMap((plan) => plan.steps.map((step) => step.input))
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
  const priorInputs = planHistory.flatMap((plan) => plan.steps.map((step) => step.input))
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