import { AgentState } from './AgentState.js'
import { Planner } from './Planner.js'
import { Replanner } from './Replanner.js'
import { ToolExecutor } from './ToolExecutor.js'
import { ToolRegistry } from './ToolRegistry.js'
import type {
  ConstraintEvaluation,
  MissionGoal,
  AgentPlan,
  PlanStep,
  ToolObservation,
} from './types.js'

export interface ConstraintEvaluator {
  evaluate(
    goal: MissionGoal,
    observations: readonly ToolObservation[],
    currentStep?: PlanStep,
    planHistory?: readonly AgentPlan[],
  ): Promise<ConstraintEvaluation> | ConstraintEvaluation
}

export class DefaultConstraintEvaluator implements ConstraintEvaluator {
  evaluate(goal: MissionGoal): ConstraintEvaluation {
    const constraints = goal.constraints ?? []
    if (constraints.length === 0) {
      return { satisfied: true, violations: [], assessments: [] }
    }

    const assessments = constraints.map((constraint) => ({
      constraint: constraint.id,
      status: 'unknown' as const,
      reason: `No evaluator is configured for constraint: ${constraint.description}`,
    }))
    return {
      satisfied: false,
      violations: [],
      assessments,
    }
  }
}

export interface AgentOptions {
  maxReplans?: number
  maxIterations?: number
  timeoutMs?: number
  constraintEvaluator?: ConstraintEvaluator
  plannerDecidesCompletion?: boolean
}

export class Agent {
  private readonly maxReplans: number
  private readonly maxIterations: number
  private readonly timeoutMs: number
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
    this.maxIterations = options.maxIterations ?? 12
    this.timeoutMs = options.timeoutMs ?? 120_000
    this.constraintEvaluator = options.constraintEvaluator ?? new DefaultConstraintEvaluator()
    this.plannerDecidesCompletion = options.plannerDecidesCompletion ?? false

    if (!Number.isInteger(this.maxReplans) || this.maxReplans < 0) {
      throw new Error('maxReplans must be a non-negative integer')
    }
    if (!Number.isInteger(this.maxIterations) || this.maxIterations < 1) {
      throw new Error('maxIterations must be a positive integer')
    }
    if (!Number.isInteger(this.timeoutMs) || this.timeoutMs < 1) {
      throw new Error('timeoutMs must be a positive integer')
    }
  }

  async run(goal: MissionGoal): Promise<AgentState> {
    if (!goal.id.trim() || !goal.description.trim()) {
      throw new Error('A goal id and description are required')
    }

    let state = AgentState.start(goal)
    let iterations = 0
    const deadline = Date.now() + this.timeoutMs

    while (state.status !== 'completed' && state.status !== 'failed') {
      if (state.status === 'planning' || state.status === 'replanning') {
        let plan
        try {
          plan = await this.waitUntilDeadline(
            this.planner.createPlan({
              goal: state.goal,
              tools: this.registry.list(),
              observations: state.observations,
              state: state.snapshot(),
              excludedToolIds: state.excludedToolIds,
              replanCount: state.replanCount,
            }),
            deadline,
            'planning',
          )
        } catch (error) {
          return state.fail(`Planning failed: ${this.errorMessage(error)}`)
        }

        state = state.recordPlan(plan)

        if (plan.decision === 'complete') {
          let evaluation
          try {
            evaluation = await this.waitUntilDeadline(
              Promise.resolve(this.constraintEvaluator.evaluate(
                state.goal,
                state.observations,
                undefined,
                state.planningHistory,
              )),
              deadline,
              'constraint evaluation',
            )
          } catch (error) {
            return state.fail(`Constraint evaluation failed: ${this.errorMessage(error)}`)
          }
          state = state.recordPlanningConstraintEvaluation(evaluation)
          if (!evaluation.satisfied) {
            const details = this.constraintFailureDetails(evaluation)
            if (state.replanCount >= this.maxReplans) return state.fail(details)
            state = this.replanner.replan(state, details)
            continue
          }
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
      if (iterations >= this.maxIterations) {
        return state.fail(`Maximum tool execution iterations reached (${this.maxIterations}).`)
      }

      iterations += 1
      let result
      try {
        result = await this.waitUntilDeadline(
          this.executor.execute(step, {
            goal: state.goal,
            observations: state.observations,
          }),
          deadline,
          'tool execution',
        )
      } catch (error) {
        const reason = this.errorMessage(error)
        state = state.recordExecution({
          stepId: step.id,
          toolId: step.toolId,
          ok: false,
          error: reason,
        })
        return state.fail(`Tool execution failed: ${reason}`)
      }
      state = state.recordExecution(result)

      let evaluation
      try {
        evaluation = await this.waitUntilDeadline(
          Promise.resolve(this.constraintEvaluator.evaluate(
            state.goal,
            state.observations,
            state.currentStep,
            state.planningHistory,
          )),
          deadline,
          'constraint evaluation',
        )
      } catch (error) {
        return state.fail(`Constraint evaluation failed: ${this.errorMessage(error)}`)
      }
      state = state.recordConstraintEvaluation(evaluation)

      if (!result.ok || !evaluation.satisfied) {
        const reason = !result.ok
          ? `Tool ${result.toolId} failed: ${result.error}`
          : this.constraintFailureDetails(evaluation)

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

  private async waitUntilDeadline<T>(
    operation: Promise<T>,
    deadline: number,
    activity: string,
  ): Promise<T> {
    const remaining = deadline - Date.now()
    if (remaining <= 0) throw new Error(`Mission timed out during ${activity}`)

    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      return await Promise.race([
        operation,
        new Promise<T>((_resolve, reject) => {
          timer = setTimeout(() => reject(new Error(`Mission timed out during ${activity}`)), remaining)
        }),
      ])
    } finally {
      if (timer) clearTimeout(timer)
    }
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : 'Unknown error'
  }

  private constraintFailureDetails(evaluation: ConstraintEvaluation): string {
    const assessmentDetails = evaluation.assessments
      ?.filter((assessment) => assessment.status !== 'satisfied')
      .map((assessment) => `${assessment.constraint} is ${assessment.status}: ${assessment.reason}`) ?? []
    const details = [...new Set([...evaluation.violations, ...assessmentDetails])]
    return `Constraints need resolution: ${details.join('; ') || 'insufficient evidence'}`
  }
}