import type { MissionReplan } from '../types/mission'
import { GitBranch, RotateCcw } from 'lucide-react'

interface ReplanningPanelProps {
  replans: readonly MissionReplan[]
  busy: boolean
}

export function ReplanningPanel({ replans, busy }: ReplanningPanelProps) {
  return (
    <section className="workspace-section" aria-labelledby="replans-heading">
      <div className="section-heading-row">
        <div>
          <p className="section-kicker">ADAPTATION</p>
          <h2 id="replans-heading" className="section-title">Replanning events</h2>
        </div>
        <span className="count-label">{replans.length} {replans.length === 1 ? 'adjustment' : 'adjustments'}</span>
      </div>
      {replans.length === 0 ? (
        <p className="empty-state">
          {busy ? 'Replan history will appear with the backend response.' : 'No replans reported.'}
        </p>
      ) : (
        <ol className="replan-list">
          {replans.map((replan, index) => (
            <li className="replan-item" key={`${replan.iteration}-${index}`}>
              <span className="replan-icon" aria-hidden="true">{index === 0 ? <GitBranch size={14} /> : <RotateCcw size={14} />}</span>
              <div><span className="replan-label">Plan adjusted · iteration {replan.iteration}</span><p>{replan.reason}</p></div>
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}