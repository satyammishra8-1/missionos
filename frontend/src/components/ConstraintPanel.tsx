import type { ConstraintAssessment } from '../types/mission'

interface ConstraintPanelProps {
  constraints: readonly ConstraintAssessment[]
  busy: boolean
}

export function ConstraintPanel({ constraints, busy }: ConstraintPanelProps) {
  return (
    <section className="workspace-section" aria-labelledby="constraints-heading">
      <div className="section-heading-row">
        <div>
          <p className="section-kicker">04 / Validation</p>
          <h2 id="constraints-heading" className="section-title">Constraints</h2>
        </div>
        <span className="count-label">{constraints.length} checked</span>
      </div>
      {constraints.length === 0 ? (
        <p className="empty-state">{busy ? 'Constraint assessments will appear with the backend response.' : 'No constraint assessments were returned.'}</p>
      ) : (
        <ul className="constraint-list">
          {constraints.map((item, index) => (
            <li className="constraint-item" key={`${item.constraint}-${index}`}>
              <div className="constraint-title-row">
                <h3>{item.constraint}</h3>
                <span className="constraint-status" data-state={item.status}>{item.status}</span>
              </div>
              <p>{item.reason}</p>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}