import assert from 'node:assert/strict'
import test from 'node:test'
import { Agent, type ConstraintEvaluator } from '../src/agent/Agent.js'
import { AgentState } from '../src/agent/AgentState.js'
import { mockGoalTool } from '../src/agent/mockTools.js'
import { Planner } from '../src/agent/Planner.js'
import { Replanner } from '../src/agent/Replanner.js'
import { ToolExecutor } from '../src/agent/ToolExecutor.js'
import { ToolRegistry } from '../src/agent/ToolRegistry.js'
import type { MissionGoal, ToolDefinition } from '../src/agent/types.js'

const goal: MissionGoal = { id: 'goal-1', description: 'Organize a community event' }

function createRegistry(...tools: ToolDefinition<unknown, unknown>[]) {
  const registry = new ToolRegistry()
  for (const tool of tools) registry.register(tool)
  return registry
}

test('planner creates a tool step for a supported generic goal', async () => {
  const registry = createRegistry(mockGoalTool)
  const state = AgentState.start(goal)
  const plan = await new Planner().createPlan({
    goal,
    tools: registry.list(),
    observations: state.observations,
    state: state.snapshot(),
    excludedToolIds: [],
    replanCount: 0,
  })

  assert.equal(plan.goalId, goal.id)
  assert.equal(plan.steps[0]?.toolId, mockGoalTool.id)
  assert.deepEqual(plan.steps[0]?.input, { goal: goal.description })
})

test('tool registry registers tools and rejects duplicate ids', () => {
  const registry = createRegistry(mockGoalTool)

  assert.equal(registry.get(mockGoalTool.id)?.description, mockGoalTool.description)
  assert.throws(() => registry.register(mockGoalTool), /already registered/)
  assert.equal(registry.list().length, 1)
})

test('tool executor validates and executes a registered tool', async () => {
  const registry = createRegistry(mockGoalTool)
  const plan = await new Planner().createPlan({
    goal,
    tools: registry.list(),
    observations: [],
    state: AgentState.start(goal).snapshot(),
    excludedToolIds: [],
    replanCount: 0,
  })
  const step = plan.steps[0]
  assert.ok(step)

  const result = await new ToolExecutor(registry).execute(step, {
    goal,
    observations: [],
  })

  assert.deepEqual(result, {
    stepId: step.id,
    toolId: mockGoalTool.id,
    ok: true,
    output: { acknowledged: true, goal: goal.description },
  })
})

test('agent replans around a failing tool and returns the successful result', async () => {
  const failingTool: ToolDefinition<{ goal: string }, never> = {
    id: 'failing-tool',
    description: 'Simulates a tool failure.',
    supports: () => true,
    createInput: ({ goal: mission }) => ({ goal: mission.description }),
    parseInput: (input) => input as { goal: string },
    execute: () => {
      throw new Error('temporary failure')
    },
  }
  const registry = createRegistry(failingTool, mockGoalTool)
  const state = await new Agent(registry).run(goal)

  assert.equal(state.status, 'completed')
  assert.equal(state.replanCount, 1)
  assert.deepEqual(state.excludedToolIds, ['failing-tool'])
  assert.equal(state.observations[0]?.ok, false)
  assert.deepEqual(state.finalResult, {
    acknowledged: true,
    goal: goal.description,
  })
})

test('replanner records a transition and excludes the failed tool', async () => {
  const registry = createRegistry(mockGoalTool)
  const plan = await new Planner().createPlan({
    goal,
    tools: registry.list(),
    observations: [],
    state: AgentState.start(goal).snapshot(),
    excludedToolIds: [],
    replanCount: 0,
  })
  const step = plan.steps[0]
  assert.ok(step)

  const executing = AgentState.start(goal).assignPlan(plan)
  const observed = executing.recordExecution({
    stepId: step.id,
    toolId: step.toolId,
    ok: false,
    error: 'unavailable',
  })
  const checked = observed.recordConstraintEvaluation({
    satisfied: false,
    violations: ['tool failed'],
  })
  const replanned = new Replanner().replan(checked, 'tool failed', step.toolId)

  assert.equal(replanned.status, 'replanning')
  assert.equal(replanned.replanCount, 1)
  assert.deepEqual(replanned.excludedToolIds, [step.toolId])
  assert.equal(replanned.replanReasons[0], 'tool failed')
})

test('agent checks constraints and fails after the configured replan limit', async () => {
  const constraintEvaluator: ConstraintEvaluator = {
    evaluate: () => ({ satisfied: false, violations: ['needs more evidence'] }),
  }
  const registry = createRegistry(mockGoalTool)
  const state = await new Agent(
    registry,
    undefined,
    undefined,
    undefined,
    { maxReplans: 1, constraintEvaluator },
  ).run(goal)

  assert.equal(state.status, 'failed')
  assert.equal(state.replanCount, 1)
  assert.match(state.failureReason ?? '', /needs more evidence/)
})