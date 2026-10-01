import type { MissionToolCall } from '../types/mission'
import { displayToolName, formatData } from './missionFormat'

interface ToolActivityProps {
  toolCalls: readonly MissionToolCall[]
  busy: boolean
}

export function ToolActivity({ toolCalls, busy }: ToolActivityProps) {
  return (
    <section className="workspace-section" aria-labelledby="activity-heading">
      <div className="section-heading-row">
        <div>
          <p className="section-kicker">02 / Execution</p>
          <h2 id="activity-heading" className="section-title">Tool activity</h2>
        </div>
        <span className="count-label">{toolCalls.length} calls</span>
      </div>
      {toolCalls.length === 0 ? (
        <p className="empty-state">{busy ? 'Execution details will appear with the backend response.' : 'No tool calls were returned.'}</p>
      ) : (
        <ol className="activity-list">
          {toolCalls.map((call) => (
            <li className="activity-item" key={call.stepId}>
              <span className="activity-marker" data-state={call.status} aria-hidden="true" />
              <div className="activity-copy">
                <div className="activity-title-row">
                  <h3>{displayToolName(call.toolId)}</h3>
                  <span className="activity-state" data-state={call.status}>{call.status}</span>
                </div>
                <p className="activity-objective">{call.objective}</p>
                {call.error && <p className="activity-error">{call.error}</p>}
                {call.output !== undefined && (
                  <details className="data-disclosure">
                    <summary>Tool output</summary>
                    <pre>{formatData(call.output)}</pre>
                  </details>
                )}
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}