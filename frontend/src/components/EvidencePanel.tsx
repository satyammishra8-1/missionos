import type { MissionEvidence } from '../types/mission'
import { isRecord } from './missionFormat'

interface EvidencePanelProps {
  evidence: readonly MissionEvidence[]
}

export function EvidencePanel({ evidence }: EvidencePanelProps) {
  return (
    <section className="workspace-section" aria-labelledby="evidence-heading">
      <div className="section-heading-row">
        <div>
          <p className="section-kicker">SOURCES</p>
          <h2 id="evidence-heading" className="section-title">Evidence</h2>
        </div>
        <span className="count-label">{evidence.length} sources</span>
      </div>
      {evidence.length === 0 ? (
        <p className="empty-state">No linked sources were returned for this mission.</p>
      ) : (
        <ol className="evidence-list">
          {evidence.map((item, index) => (
            <li className="evidence-item" key={`${item.stepId}-${item.url ?? index}`}>
              <div className="evidence-topline"><span className="evidence-source">{item.source ?? 'Source'}</span></div>
              <h3>{item.title ?? evidenceTitle(item.relevantData)}</h3>
              {item.url ? (
                <a href={item.url} target="_blank" rel="noreferrer">Visit source <span aria-hidden="true">↗</span></a>
              ) : null}
              {evidenceDescription(item.relevantData) && <p className="evidence-description">{evidenceDescription(item.relevantData)}</p>}
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}

function evidenceTitle(value: unknown): string {
  if (!isRecord(value)) return 'Research source'
  for (const key of ['title', 'name', 'airline', 'flightNumber']) {
    if (typeof value[key] === 'string' && value[key]) return value[key] as string
  }
  return 'Research source'
}

function evidenceDescription(value: unknown): string | undefined {
  if (!isRecord(value)) return undefined
  const description = value.snippet ?? value.description ?? value.address
  return typeof description === 'string' ? description : undefined
}