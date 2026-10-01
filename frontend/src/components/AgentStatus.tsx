import type { MissionResponse } from '../types/mission'
import { displayToolName } from './missionFormat'

interface AgentStatusProps {
  busy: boolean
  response?: MissionResponse
}

function statusLabel(status: MissionResponse['status'] | undefined, busy: boolean): string {
  if (busy) return 'Running'
  if (!status) return 'Ready'
  return status.charAt(0).toUpperCase() + status.slice(1)
}

export function AgentStatus({ busy, response }: AgentStatusProps) {
  const activeTool = response?.toolCalls.find((call) => call.status === 'pending')

  return (
    <section className="agent-status" aria-label="Mission status">
      <div className="status-heading">
        <div>
          <p className="section-kicker">Agent status</p>
          <h2 className="status-value" data-state={busy ? 'running' : response?.status ?? 'ready'}>
            {busy && <span className="live-indicator" aria-hidden="true" />}
            {statusLabel(response?.status, busy)}
          </h2>
        </div>
        <span className="status-caption">{busy ? 'Request in progress' : response ? 'Backend response received' : 'Awaiting mission'}</span>
      </div>
      <div className="status-details">
        <div>
          <span className="detail-label">Active tool</span>
          <span className="detail-value">
            {activeTool ? displayToolName(activeTool.toolId) : busy ? 'Not streamed by API' : 'None'}
          </span>
        </div>
        <div>
          <span className="detail-label">Tool calls</span>
          <span className="detail-value">{response?.toolCalls.length ?? '—'}</span>
        </div>
        <div>
          <span className="detail-label">Mission ID</span>
          <span className="detail-value mission-id">{response?.missionId ?? '—'}</span>
        </div>
      </div>
      {busy && (
        <div className="request-progress" role="status" aria-live="polite">
          <span className="request-progress-bar" />
          <span>Waiting for the mission service to return its execution trace</span>
        </div>
      )}
    </section>
  )
}