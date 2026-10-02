import type { ConstraintAssessment } from '../types/mission'

interface ConstraintPanelProps {
  constraints: readonly ConstraintAssessment[]
}

const statusPresentation = {
  satisfied: { symbol: '✓', label: 'Satisfied' },
  violated: { symbol: '✕', label: 'Not met' },
  unknown: { symbol: '?', label: 'Unconfirmed' },
} as const

export function ConstraintPanel({ constraints }: ConstraintPanelProps) {
  return (
    <section className="workspace-section" aria-labelledby="constraints-heading">
      <div className="section-heading-row">
        <div>
          <p className="section-kicker">REQUIREMENTS</p>
          <h2 id="constraints-heading" className="section-title">Your constraints</h2>
        </div>
        <span className="count-label">{constraints.length || '—'}</span>
      </div>
      {constraints.length === 0 ? (
        <p className="empty-state">No constraints were provided for this mission.</p>
      ) : (
        <ul className="constraint-list">
          {constraints.map((item, index) => (
            <li className="constraint-item" key={`${item.constraint}-${index}`}>
              <div className="constraint-title-row">
                <h3>{item.constraint.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ')}</h3>
                  <span className="constraint-status" data-state={item.status}><b aria-hidden="true">{statusPresentation[item.status].symbol}</b>{statusPresentation[item.status].label}</span>
              </div>
              <p>{item.reason}</p>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}