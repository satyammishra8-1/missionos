import type { ConstraintAssessment } from '../types/mission'
import { CircleHelp, Check, X } from 'lucide-react'
import { humanizeKey } from './missionFormat'

interface ConstraintPanelProps {
  constraints: readonly ConstraintAssessment[]
}

const statusPresentation = {
  satisfied: { Icon: Check, label: 'Satisfied' },
  violated: { Icon: X, label: 'Violated' },
  unknown: { Icon: CircleHelp, label: 'Unknown' },
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
          {constraints.map((item, index) => {
            const StatusIcon = statusPresentation[item.status].Icon
            return <li className="constraint-item" key={`${item.constraint}-${index}`}>
              <div className="constraint-title-row">
                <h3>{humanizeKey(item.constraint)}</h3>
                <span className="constraint-status" data-state={item.status}><StatusIcon size={12} aria-hidden="true" />{statusPresentation[item.status].label}</span>
              </div>
              <p>{item.reason}</p>
            </li>
          })}
        </ul>
      )}
    </section>
  )
}