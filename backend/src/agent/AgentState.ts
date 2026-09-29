import type {
  AgentPlan,
  AgentStatus,
  AgentStateSnapshot,
  ConstraintEvaluation,
  MissionGoal,
  ToolExecutionResult,
} from './types.js'

interface AgentStateValues {
  goal: MissionGoal
  status: AgentStatus
  plan?: AgentPlan
  planHistory: readonly AgentPlan[]
  planningHistory: readonly AgentPlan[]
  stepIndex: number
  observations: readonly ToolExecutionResult[]
  constraintEvaluation?: ConstraintEvaluation
  constraintHistory: readonly ConstraintEvaluation[]
  excludedToolIds: readonly string[]
  replanReasons: readonly string[]
  finalResult?: unknown
  failureReason?: string
}

export class AgentState {
  private constructor(private readonly values: AgentStateValues) {}

  static start(goal: MissionGoal): AgentState {
    return new AgentState({
      goal,
      status: 'planning',
      planHistory: [],
      planningHistory: [],
      stepIndex: 0,
      observations: [],
      constraintHistory: [],
      excludedToolIds: [],
      replanReasons: [],
    })
  }

  get goal(): MissionGoal { return this.values.goal }
  get status(): AgentStatus { return this.values.status }
  get plan(): AgentPlan | undefined { return this.values.plan }
  get planHistory(): readonly AgentPlan[] { return this.values.planHistory }
  get planningHistory(): readonly AgentPlan[] { return this.values.planningHistory }
  get stepIndex(): number { return this.values.stepIndex }
  get currentStep() { return this.values.plan?.steps[this.values.stepIndex] }
  get observations(): readonly ToolExecutionResult[] { return this.values.observations }
  get constraintEvaluation(): ConstraintEvaluation | undefined { return this.values.constraintEvaluation }
  get constraintHistory(): readonly ConstraintEvaluation[] { return this.values.constraintHistory }
  get excludedToolIds(): readonly string[] { return this.values.excludedToolIds }
  get replanReasons(): readonly string[] { return this.values.replanReasons }
  get finalResult(): unknown { return this.values.finalResult }
  get failureReason(): string | undefined { return this.values.failureReason }
  get replanCount(): number { return this.values.replanReasons.length }

  snapshot(): AgentStateSnapshot {
    return {
      goal: this.goal,
      status: this.status,
      plan: this.plan,
      planHistory: this.planHistory,
      stepIndex: this.stepIndex,
      observations: this.observations,
      constraintEvaluation: this.constraintEvaluation,
      constraintHistory: this.constraintHistory,
      excludedToolIds: this.excludedToolIds,
      replanReasons: this.replanReasons,
    }
  }

  assignPlan(plan: AgentPlan): AgentState {
    this.assertStatus('planning', 'replanning')
    if (plan.goalId !== this.goal.id) {
      throw new Error('Cannot assign a plan for a different goal')
    }
    if (plan.steps.length === 0) {
      throw new Error('Cannot assign an empty plan')
    }

    return this.next({
      status: 'executing',
      plan,
      planHistory: [...this.planHistory, plan],
      stepIndex: 0,
      constraintEvaluation: undefined,
    })
  }

  recordPlan(plan: AgentPlan): AgentState {
    this.assertStatus('planning', 'replanning')
    if (plan.goalId !== this.goal.id) {
      throw new Error('Cannot record a plan for a different goal')
    }
    return this.next({ plan, planningHistory: [...this.planningHistory, plan] })
  }

  recordExecution(result: ToolExecutionResult): AgentState {
    this.assertStatus('executing')
    if (result.stepId !== this.currentStep?.id) {
      throw new Error(`Execution result does not match the current step: ${result.stepId}`)
    }

    return this.next({ observations: [...this.observations, result] })
  }

  recordConstraintEvaluation(evaluation: ConstraintEvaluation): AgentState {
    this.assertStatus('executing')
    if (this.observations.at(-1)?.stepId !== this.currentStep?.id) {
      throw new Error('A constraint evaluation requires an observation for the current step')
    }

    return this.next({
      constraintEvaluation: evaluation,
      constraintHistory: [...this.constraintHistory, evaluation],
    })
  }

  recordPlanningConstraintEvaluation(evaluation: ConstraintEvaluation): AgentState {
    this.assertStatus('planning', 'replanning')
    return this.next({
      constraintEvaluation: evaluation,
      constraintHistory: [...this.constraintHistory, evaluation],
    })
  }

  advance(): AgentState {
    this.assertStatus('executing')
    if (this.constraintEvaluation?.satisfied !== true) {
      throw new Error('Cannot advance before constraints are satisfied')
    }
    if (this.stepIndex + 1 >= (this.plan?.steps.length ?? 0)) {
      throw new Error('There is no next plan step')
    }

    return this.next({
      stepIndex: this.stepIndex + 1,
      constraintEvaluation: undefined,
    })
  }

  complete(): AgentState {
    this.assertStatus('executing')
    if (this.constraintEvaluation?.satisfied !== true) {
      throw new Error('Cannot complete before constraints are satisfied')
    }
    if (this.stepIndex !== (this.plan?.steps.length ?? 0) - 1) {
      throw new Error('Cannot complete before all plan steps are executed')
    }

    const latestObservation = this.observations.at(-1)
    return this.next({
      status: 'completed',
      finalResult: latestObservation?.ok ? latestObservation.output : undefined,
    })
  }

  completeMission(finalResult: unknown): AgentState {
    this.assertStatus('planning', 'replanning')
    return this.next({ status: 'completed', finalResult })
  }

  continuePlanning(): AgentState {
    this.assertStatus('executing')
    if (this.constraintEvaluation?.satisfied !== true) {
      throw new Error('Cannot continue planning before constraints are satisfied')
    }
    if (this.observations.at(-1)?.stepId !== this.currentStep?.id) {
      throw new Error('Cannot continue planning before observing the current step')
    }

    return this.next({
      status: 'planning',
      plan: undefined,
      stepIndex: 0,
      constraintEvaluation: undefined,
    })
  }

  requestReplan(reason: string): AgentState {
    this.assertStatus('planning', 'replanning')
    return this.next({
      status: 'replanning',
      plan: undefined,
      stepIndex: 0,
      replanReasons: [...this.replanReasons, reason],
    })
  }

  beginReplan(reason: string, failedToolId?: string): AgentState {
    this.assertStatus('executing')
    if (this.observations.at(-1)?.stepId !== this.currentStep?.id) {
      throw new Error('Cannot replan before observing the current step')
    }

    return this.next({
      status: 'replanning',
      plan: undefined,
      stepIndex: 0,
      excludedToolIds: failedToolId && !this.excludedToolIds.includes(failedToolId)
        ? [...this.excludedToolIds, failedToolId]
        : this.excludedToolIds,
      replanReasons: [...this.replanReasons, reason],
      constraintEvaluation: undefined,
    })
  }

  fail(reason: string): AgentState {
    if (this.status === 'completed' || this.status === 'failed') {
      throw new Error(`Cannot fail an agent that is already ${this.status}`)
    }
    return this.next({ status: 'failed', failureReason: reason })
  }

  private next(updates: Partial<AgentStateValues>): AgentState {
    return new AgentState({ ...this.values, ...updates })
  }

  private assertStatus(...statuses: AgentStatus[]): void {
    if (!statuses.includes(this.status)) {
      throw new Error(`Invalid transition from ${this.status}`)
    }
  }
}