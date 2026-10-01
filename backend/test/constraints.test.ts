import assert from 'node:assert/strict'
import test from 'node:test'
import { DefaultConstraintEvaluator } from '../src/agent/Agent.js'
import type { MissionGoal, PlanStep, ToolObservation } from '../src/agent/types.js'
import { MissionConstraintEvaluator } from '../src/services/missions/MissionConstraintEvaluator.js'

function evaluate(
  constraints: Record<string, unknown>,
  observations: readonly ToolObservation[] = [],
  input?: unknown,
) {
  const goal: MissionGoal = {
    id: 'constraint-test',
    description: 'Evaluate a test mission',
    metadata: { missionConstraints: constraints },
  }
  const step: PlanStep | undefined = input === undefined ? undefined : {
    id: 'step-1',
    toolId: 'test-tool',
    objective: 'Check input evidence',
    input,
  }
  return new MissionConstraintEvaluator().evaluate(goal, observations, step)
}

function observation(output: unknown): ToolObservation {
  return { stepId: 'step-1', toolId: 'test-tool', ok: true, output }
}

function status(result: ReturnType<typeof evaluate>, constraint: string): string | undefined {
  return result.assessments?.find((item) => item.constraint === constraint)?.status
}

test('budget is satisfied when an observed option is within the limit', () => {
  const result = evaluate({ budget: 200 }, [observation({ results: [{ price: { amount: 175 } }] })])
  assert.equal(status(result, 'budget'), 'satisfied')
  assert.equal(result.satisfied, true)
})

test('budget is violated when every observed price exceeds the limit', () => {
  const result = evaluate({ budget: { max: 100 } }, [observation({ results: [{ price: 125 }, { price: '$140' }] })])
  assert.equal(status(result, 'budget'), 'violated')
  assert.equal(result.satisfied, false)
  assert.match(result.violations[0] ?? '', /exceed/)
})

test('budget is unknown when no comparable price evidence exists', () => {
  const result = evaluate({ budget: 100 }, [observation({ results: [{ name: 'Unpriced option' }] })])
  assert.equal(status(result, 'budget'), 'unknown')
  assert.equal(result.satisfied, false)
})

test('currency-specific budget remains unknown when price currency does not match', () => {
  const result = evaluate(
    { budget: { max: 8000, currency: 'INR' } },
    [observation({ currency: 'USD', flights: [{ price: 90 }] })],
  )
  assert.equal(status(result, 'budget'), 'unknown')
})

test('total budget remains unknown when only separate option prices are available', () => {
  const result = evaluate(
    { budget: { max: 8000, currency: 'INR', scope: 'total' } },
    [
      observation({ currency: 'INR', flights: [{ price: 5000 }] }),
      observation({ currency: 'INR', hotels: [{ price: 2500 }] }),
    ],
  )
  assert.equal(status(result, 'budget'), 'unknown')
  assert.match(result.assessments?.[0]?.reason ?? '', /no evidence-backed total trip cost/)
})

test('date is satisfied or violated by exact planned stay dates', () => {
  const expected = { checkIn: '2027-06-10', checkOut: '2027-06-15' }
  const matching = evaluate({ date: expected }, [], expected)
  const mismatched = evaluate({ date: expected }, [], { checkIn: expected.checkIn, checkOut: '2027-06-16' })

  assert.equal(status(matching, 'date'), 'satisfied')
  assert.equal(status(mismatched, 'date'), 'violated')
})

test('date is unknown when matching date evidence is absent', () => {
  const result = evaluate({ date: '2027-06-10' })
  assert.equal(status(result, 'date'), 'unknown')
})

test('location is satisfied or violated by the planned search location', () => {
  const matching = evaluate({ location: 'Reykjavik' }, [], { destination: 'Reykjavik, Iceland' })
  const mismatched = evaluate({ location: 'Reykjavik' }, [], { destination: 'Oslo, Norway' })

  assert.equal(status(matching, 'location'), 'satisfied')
  assert.equal(status(mismatched, 'location'), 'violated')
})

test('location is unknown when location evidence is absent', () => {
  const result = evaluate({ location: 'Reykjavik' })
  assert.equal(status(result, 'location'), 'unknown')
})

test('route is satisfied only by observed matching flight search output', () => {
  const matching = evaluate(
    { route: { origin: 'Bengaluru', destination: 'Hyderabad' } },
    [{ stepId: 'flight-1', toolId: 'google-flights', ok: true, output: {
      departure: 'Bengaluru',
      destination: 'Hyderabad',
      results: [{ flightNumber: 'AB 12' }],
    } }],
  )
  const mismatched = evaluate(
    { route: { origin: 'Bengaluru', destination: 'Hyderabad' } },
    [{ stepId: 'flight-1', toolId: 'google-flights', ok: true, output: {
      departure: 'Delhi',
      destination: 'Hyderabad',
      results: [{ flightNumber: 'AB 12' }],
    } }],
  )
  const missing = evaluate({ route: { origin: 'Bengaluru', destination: 'Hyderabad' } })

  assert.equal(status(matching, 'route'), 'satisfied')
  assert.equal(status(mismatched, 'route'), 'violated')
  assert.equal(status(missing, 'route'), 'unknown')
})

test('time is satisfied or violated against an observed time range', () => {
  const observations = [observation({ flights: [{ departure: '2027-04-10T09:30:00' }] })]
  const matching = evaluate({ time: { start: '09:00', end: '12:00' } }, observations)
  const mismatched = evaluate({ time: { start: '13:00', end: '17:00' } }, observations)

  assert.equal(status(matching, 'time'), 'satisfied')
  assert.equal(status(mismatched, 'time'), 'violated')
})

test('time is unknown when results provide no comparable time', () => {
  const result = evaluate({ time: '09:30' }, [observation({ results: [{ name: 'No schedule' }] })])
  assert.equal(status(result, 'time'), 'unknown')
})

test('required preferences are satisfied only when every preference is evidenced', () => {
  const matching = evaluate(
    { requiredPreferences: ['free Wi-Fi', 'pool'] },
    [observation({ properties: [{ amenities: ['Free Wi-Fi', 'Pool'] }] })],
  )
  const missing = evaluate(
    { requiredPreferences: ['free Wi-Fi', 'pool'] },
    [observation({ properties: [{ amenities: ['Free Wi-Fi'] }] })],
  )

  assert.equal(status(matching, 'requiredPreferences'), 'satisfied')
  assert.equal(status(missing, 'requiredPreferences'), 'violated')
})

test('required preferences are unknown when amenities are absent', () => {
  const result = evaluate({ requiredPreferences: ['pool'] }, [observation({ properties: [{ name: 'Hotel' }] })])
  assert.equal(status(result, 'requiredPreferences'), 'unknown')
})

test('required tool coverage is unknown until every requested tool returns useful output', () => {
  const result = evaluate(
    { requiredTools: ['google-flights', 'google-hotels'] },
    [{ stepId: 'flight-1', toolId: 'google-flights', ok: true, output: { results: [{ flightNumber: 'AB 12' }] } }],
  )
  assert.equal(status(result, 'requiredTools'), 'unknown')
  assert.equal(result.satisfied, false)
})

test('unsupported constraints remain explicitly unknown', () => {
  const result = evaluate({ accessibility: true })
  assert.equal(status(result, 'accessibility'), 'unknown')
  assert.equal(result.satisfied, false)
})

test('default Agent evaluator reports unconfigured mission constraints as unknown', () => {
  const result = new DefaultConstraintEvaluator().evaluate({
    id: 'default-constraint-test',
    description: 'Fallback constraint evaluation',
    constraints: [{ id: 'budget', description: 'Stay under 500' }],
  }, [])

  assert.equal(result.satisfied, false)
  assert.equal(result.assessments?.[0]?.status, 'unknown')
  assert.match(result.assessments?.[0]?.reason ?? '', /No evaluator is configured/)
})