import type { MissionFinding } from '../types/mission'
import { displayToolName, formatData } from './missionFormat'

interface FindingsPanelProps {
  findings: readonly MissionFinding[]
  busy: boolean
}

export function FindingsPanel({ findings, busy }: FindingsPanelProps) {
  return (
    <section className="workspace-section" aria-labelledby="findings-heading">
      <div className="section-heading-row">
        <div>
          <p className="section-kicker">03 / Observations</p>
          <h2 id="findings-heading" className="section-title">Findings</h2>
        </div>
        <span className="count-label">{findings.length} items</span>
      </div>
      {findings.length === 0 ? (
        <p className="empty-state">{busy ? 'Findings will appear with the backend response.' : 'No findings were returned.'}</p>
      ) : (
        <ul className="findings-list">
          {findings.map((finding) => (
            <li className="finding-item" key={finding.stepId}>
              <div className="finding-meta">
                <span>{displayToolName(finding.toolId)}</span>
                <span>{finding.stepId}</span>
              </div>
              <p className="finding-objective">{finding.objective}</p>
              <pre className="finding-data">{formatData(finding.output)}</pre>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}