import type { BackendHealth } from '../types/health'

type ConnectionStatusProps = {
  state: 'loading' | 'connected' | 'disconnected'
  health?: BackendHealth
  error?: string
}

export function ConnectionStatus({ state, health, error }: ConnectionStatusProps) {
  const detail = health
    ? `Last checked ${new Date(health.timestamp).toLocaleTimeString()}`
    : error ?? 'Checking the health endpoint'

  return (
    <section className="connection-panel" aria-live="polite">
      <div>
        <p className="service-name">MissionOS API</p>
        <p className="service-detail">GET /api/health · {detail}</p>
      </div>
      <div className="status" data-state={state}>
        <span className="status-dot" aria-hidden="true" />
        <span className="status-label">
          {state === 'connected' ? 'Connected' : state === 'loading' ? 'Checking' : 'Offline'}
        </span>
      </div>
    </section>
  )
}