import type { MissionPlanStep } from '../types/mission'
import { displayToolName, formatData } from './missionFormat'

interface PlanPanelProps {
  plan: readonly MissionPlanStep[]
  busy: boolean
}

export function PlanPanel({ plan, busy }: PlanPanelProps) {
  return (
    <section className="workspace-section" aria-labelledby="plan-heading">
      <div className="section-heading-row">
        <div>
          <p className="section-kicker">01 / Plan</p>
          <h2 id="plan-heading" className="section-title">Current plan</h2>
        </div>
        <span className="count-label">{plan.length} {plan.length === 1 ? 'step' : 'steps'}</span>
      </div>
      {plan.length === 0 ? (
        <p className="empty-state">{busy ? 'Plan details will appear with the backend response.' : 'No plan steps were returned.'}</p>
      ) : (
        <ol className="plan-list">
          {plan.map((step, index) => (
            <li className="plan-item" key={`${step.id}-${index}`}>
              <span className="plan-index">{String(index + 1).padStart(2, '0')}</span>
              <div className="plan-copy">
                <p className="plan-objective">{step.objective}</p>
                <span className="tool-tag">{displayToolName(step.toolId)}</span>
                <details className="data-disclosure">
                  <summary>Input</summary>
                  <pre>{formatData(step.input)}</pre>
                </details>
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}