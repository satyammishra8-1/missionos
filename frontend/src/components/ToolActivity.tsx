import type { MissionToolCall } from '../types/mission'
import { BedDouble, ChevronDown, MapPin, Plane, Search, Wrench } from 'lucide-react'
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
              <span className="activity-icon" aria-hidden="true">{toolIcon(call.toolId)}</span>
              <div className="activity-copy">
                <div className="activity-title-row">
                  <h3>{displayToolName(call.toolId)}</h3>
                  <span className="activity-state" data-state={call.status}>{call.status === 'completed' ? 'Done' : call.status === 'failed' ? 'Failed' : 'Pending'}</span>
                </div>
                <p className="activity-objective">{call.objective}</p>
                {call.error && <p className="activity-error">{call.error}</p>}
                {call.output !== undefined && (
                  <details className="data-disclosure">
                    <summary><span>View returned details</span><ChevronDown size={12} aria-hidden="true" /></summary>
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

function toolIcon(toolId: string) {
  const normalized = toolId.toLowerCase()
  if (normalized.includes('flight')) return <Plane size={14} />
  if (normalized.includes('hotel')) return <BedDouble size={14} />
  if (normalized.includes('maps') || normalized.includes('places')) return <MapPin size={14} />
  if (normalized.includes('search')) return <Search size={14} />
  return <Wrench size={14} />
}