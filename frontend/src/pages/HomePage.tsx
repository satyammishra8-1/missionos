import { ConnectionStatus } from '../components/ConnectionStatus'
import { useBackendHealth } from '../hooks/useBackendHealth'
import '../App.css'

export function HomePage() {
  const healthState = useBackendHealth()

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">M</span>
          <span>MissionOS</span>
        </div>
        <span className="environment-label">Development</span>
      </header>

      <main className="main-content">
        <p className="eyebrow">System status / 01</p>
        <h1 className="page-title">A clear view of what&apos;s <span>connected.</span></h1>
        <p className="intro">
          Your MissionOS workspace is up. The status below is live from the backend health endpoint.
        </p>
        <ConnectionStatus
          state={healthState.status}
          health={healthState.status === 'connected' ? healthState.health : undefined}
          error={healthState.status === 'disconnected' ? healthState.message : undefined}
        />
      </main>

      <footer className="footer">
        <p className="footer-label">Foundation</p>
        <p className="footer-value">React · TypeScript · Express</p>
      </footer>
    </div>
  )
}