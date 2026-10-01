import type { MissionReplan } from '../types/mission'

interface ReplanningPanelProps {
  replans: readonly MissionReplan[]
  busy: boolean
}

export function ReplanningPanel({ replans, busy }: ReplanningPanelProps) {
  return (
    <section className="workspace-section" aria-labelledby="replans-heading">
      <div className="section-heading-row">
        <div>
          <p className="section-kicker">03 / Adaptation</p>
          <h2 id="replans-heading" className="section-title">Replanning events</h2>
        </div>
        <span className="count-label">{replans.length} events</span>
      </div>
      {replans.length === 0 ? (
        <p className="empty-state">
          {busy ? 'Replan history will appear with the backend response.' : 'No replans reported.'}
        </p>
      ) : (
        <ol className="replan-list">
          {replans.map((replan, index) => (
            <li className="replan-item" key={`${replan.iteration}-${index}`}>
              <span className="replan-iteration">{String(replan.iteration).padStart(2, '0')}</span>
              <p>{replan.reason}</p>
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}