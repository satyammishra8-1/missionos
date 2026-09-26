import { AgentState } from './AgentState.js'
import { Planner } from './Planner.js'
import { Replanner } from './Replanner.js'
import { ToolExecutor } from './ToolExecutor.js'
import { ToolRegistry } from './ToolRegistry.js'
import type {
  ConstraintEvaluation,
  MissionGoal,
  ToolObservation,
} from './types.js'

export interface ConstraintEvaluator {
  evaluate(
    goal: MissionGoal,
    observations: readonly ToolObservation[],
  ): Promise<ConstraintEvaluation> | ConstraintEvaluation
}

export class DefaultConstraintEvaluator implements ConstraintEvaluator {
  evaluate(goal: MissionGoal): ConstraintEvaluation {
    const constraints = goal.constraints ?? []
    if (constraints.length === 0) {
      return { satisfied: true, violations: [] }
    }

    return {
      satisfied: false,
      violations: constraints.map(
        (constraint) => `No evaluator is configured for constraint: ${constraint.description}`,
      ),
    }
  }
}

export interface AgentOptions {
  maxReplans?: number
  constraintEvaluator?: ConstraintEvaluator
  plannerDecidesCompletion?: boolean
}

export class Agent {
  private readonly maxReplans: number
  private readonly constraintEvaluator: ConstraintEvaluator
  private readonly plannerDecidesCompletion: boolean

  constructor(
    private readonly registry: ToolRegistry,
    private readonly planner = new Planner(),
    private readonly executor = new ToolExecutor(registry),
    private readonly replanner = new Replanner(),
    options: AgentOptions = {},
  ) {
    this.maxReplans = options.maxReplans ?? 3
    this.constraintEvaluator = options.constraintEvaluator ?? new DefaultConstraintEvaluator()
    this.plannerDecidesCompletion = options.plannerDecidesCompletion ?? false

    if (!Number.isInteger(this.maxReplans) || this.maxReplans < 0) {
      throw new Error('maxReplans must be a non-negative integer')
    }
  }

  async run(goal: MissionGoal): Promise<AgentState> {
    if (!goal.id.trim() || !goal.description.trim()) {
      throw new Error('A goal id and description are required')
    }

    let state = AgentState.start(goal)

    while (state.status !== 'completed' && state.status !== 'failed') {
      if (state.status === 'planning' || state.status === 'replanning') {
        const plan = await this.planner.createPlan({
          goal: state.goal,
          tools: this.registry.list(),
          observations: state.observations,
          state: state.snapshot(),
          excludedToolIds: state.excludedToolIds,
          replanCount: state.replanCount,
        })

        if (plan.decision === 'complete') {
          return state.completeMission(plan.finalResult)
        }

        if (plan.decision === 'replan') {
          const reason = plan.rationale ?? 'The planner requested another planning pass.'
          if (state.replanCount >= this.maxReplans) {
            return state.fail(reason)
          }
          state = this.replanner.replan(state, reason)
          continue
        }

        if (plan.steps.length === 0) {
          return state.fail('No registered tool can handle the goal.')
        }
        state = state.assignPlan(plan)
      }

      const step = state.currentStep
      if (!step) {
        return state.fail('The active plan has no current step.')
      }

      const result = await this.executor.execute(step, {
        goal: state.goal,
        observations: state.observations,
      })
      state = state.recordExecution(result)

      const evaluation = await this.constraintEvaluator.evaluate(
        state.goal,
        state.observations,
      )
      state = state.recordConstraintEvaluation(evaluation)

      if (!result.ok || !evaluation.satisfied) {
        const reason = !result.ok
          ? `Tool ${result.toolId} failed: ${result.error}`
          : `Constraints were not satisfied: ${evaluation.violations.join('; ')}`

        if (state.replanCount >= this.maxReplans) {
          return state.fail(reason)
        }

        state = this.replanner.replan(
          state,
          reason,
          result.ok ? undefined : result.toolId,
        )
        continue
      }

      if (this.plannerDecidesCompletion && state.plan?.evaluateAfterExecution !== false) {
        state = state.continuePlanning()
      } else if (state.plan && state.stepIndex + 1 < state.plan.steps.length) {
        state = state.advance()
      } else {
        state = state.complete()
      }
    }

    return state
  }
}