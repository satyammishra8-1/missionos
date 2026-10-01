import type { MissionEvidence } from '../types/mission'
import { displayToolName, formatData } from './missionFormat'

interface EvidencePanelProps {
  evidence: readonly MissionEvidence[]
  busy: boolean
}

export function EvidencePanel({ evidence, busy }: EvidencePanelProps) {
  return (
    <section className="workspace-section" aria-labelledby="evidence-heading">
      <div className="section-heading-row">
        <div>
          <p className="section-kicker">05 / Sources</p>
          <h2 id="evidence-heading" className="section-title">Evidence</h2>
        </div>
        <span className="count-label">{evidence.length} sources</span>
      </div>
      {evidence.length === 0 ? (
        <p className="empty-state">{busy ? 'Source evidence will appear with the backend response.' : 'No source evidence was returned.'}</p>
      ) : (
        <ol className="evidence-list">
          {evidence.map((item, index) => (
            <li className="evidence-item" key={`${item.stepId}-${item.url ?? index}`}>
              <div className="evidence-topline">
                <span className="evidence-source">{item.source ?? displayToolName(item.toolId)}</span>
                <span className="evidence-tool">{displayToolName(item.toolId)}</span>
              </div>
              <h3>{item.title ?? 'Source result'}</h3>
              {item.url ? (
                <a href={item.url} target="_blank" rel="noreferrer">Open source <span aria-hidden="true">↗</span></a>
              ) : <span className="no-link">No direct link returned</span>}
              <details className="data-disclosure">
                <summary>Relevant data</summary>
                <pre>{formatData(item.relevantData)}</pre>
              </details>
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}