import { useEffect, useRef, useState } from 'react'
import { ArrowUpRight, Compass, MapPin, Moon, Orbit, Plane, Plus, Search, Sparkles, Sun } from 'lucide-react'
import { ConstraintPanel } from '../components/ConstraintPanel'
import { EvidencePanel } from '../components/EvidencePanel'
import { FinalResult } from '../components/FinalResult'
import { FindingsPanel } from '../components/FindingsPanel'
import { MissionInput } from '../components/MissionInput'
import { PlanPanel } from '../components/PlanPanel'
import { ReplanningPanel } from '../components/ReplanningPanel'
import { ToolActivity } from '../components/ToolActivity'
import { postMission } from '../services/api'
import type { MissionResponse } from '../types/mission'
import './missionos.css'

interface OptionalConstraints {
  budget: string
  currency: string
  mustHaves: string
}

type PageState =
  | { status: 'ready' }
  | { status: 'running' }
  | { status: 'error'; message: string }
  | { status: 'success'; response: MissionResponse }

export function HomePage() {
  const [theme, setTheme] = useState<'light' | 'dark'>('light')
  const [goal, setGoal] = useState('')
  const [constraints, setConstraints] = useState<OptionalConstraints>({ budget: '', currency: 'USD', mustHaves: '' })
  const [submittedGoal, setSubmittedGoal] = useState('')
  const [pageState, setPageState] = useState<PageState>({ status: 'ready' })
  const [formError, setFormError] = useState<string>()
  const [missionStartedAt, setMissionStartedAt] = useState<number>()
  const [missionFinishedAt, setMissionFinishedAt] = useState<number>()
  const requestController = useRef<AbortController | null>(null)
  const busy = pageState.status === 'running'
  const response = pageState.status === 'success' ? pageState.response : undefined

  useEffect(() => () => requestController.current?.abort(), [])

  async function runMission() {
    setFormError(undefined)
    const parsedConstraints: Record<string, unknown> = {}
    const budget = Number(constraints.budget)
    if (constraints.budget.trim() && Number.isFinite(budget) && budget >= 0) {
      parsedConstraints.budget = { max: budget, currency: constraints.currency }
    }
    const mustHaves = constraints.mustHaves.split(/[\n,]/).map((item) => item.trim()).filter(Boolean)
    if (mustHaves.length) parsedConstraints.requiredPreferences = mustHaves

    requestController.current?.abort()
    const controller = new AbortController()
    requestController.current = controller
    setSubmittedGoal(goal.trim())
    setMissionStartedAt(Date.now())
    setMissionFinishedAt(undefined)
    setPageState({ status: 'running' })

    try {
      const result = await postMission({
        goal: goal.trim(),
        ...(Object.keys(parsedConstraints).length ? { constraints: parsedConstraints } : {}),
      }, controller.signal)
      setMissionFinishedAt(Date.now())
      setPageState({ status: 'success', response: result })
    } catch (error) {
      if (controller.signal.aborted) return
      setMissionFinishedAt(Date.now())
      setPageState({
        status: 'error',
        message: friendlyError(error),
      })
    }
  }

  function resetMission() {
    requestController.current?.abort()
    requestController.current = null
    setGoal('')
    setConstraints({ budget: '', currency: 'USD', mustHaves: '' })
    setSubmittedGoal('')
    setMissionStartedAt(undefined)
    setMissionFinishedAt(undefined)
    setFormError(undefined)
    setPageState({ status: 'ready' })
  }

  return (
    <div className="workspace-shell" data-theme={theme}>
      <header className="workspace-header">
        <div className="workspace-brand">
          <span className="brand-symbol" aria-hidden="true"><Orbit size={18} strokeWidth={2.1} /></span>
          <span>Mission<span className="brand-light">OS</span></span>
        </div>
        <span className="system-label"><span className="system-dot" /> AI TRAVEL AGENT</span>
        <nav className="header-nav" aria-label="Main navigation">
          <a className="nav-link" href="#top">Home</a>
          <a className="nav-link" href="#examples">Explore</a>
          <button className="theme-toggle" type="button" aria-label={`Switch to ${theme === 'light' ? 'dark' : 'light'} theme`} aria-pressed={theme === 'dark'} onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}>
            {theme === 'light' ? <Moon size={16} aria-hidden="true" /> : <Sun size={16} aria-hidden="true" />}
          </button>
        </nav>
      </header>

      <main id="top" className="workspace-main">
        {(pageState.status === 'ready' || pageState.status === 'error') && <>
          <section className="landing-heading">
            <span className="landing-eyebrow"><Sparkles size={13} aria-hidden="true" /> YOUR AI TRAVEL AGENT</span>
            <h1>Make the most<br /><span>of your next trip.</span></h1>
            <p>Compare flights and stays, discover places, and shape practical itineraries from live travel searches and evidence.</p>
          </section>

          {pageState.status === 'error' && <div className="request-error" role="alert">
            <div><strong>Mission couldn’t be started</strong><p>{pageState.message}</p></div>
            <div className="request-error-actions"><span>Check your connection or try again.</span><button className="new-mission-button" type="button" onClick={resetMission}><Plus size={14} aria-hidden="true" /> New mission</button></div>
          </div>}

          <MissionInput
            goal={goal}
            constraints={constraints}
            busy={busy}
            error={formError}
            onGoalChange={setGoal}
            onConstraintsChange={setConstraints}
            onSubmit={runMission}
          />

          <section className="examples" id="examples" aria-labelledby="examples-title">
            <div className="examples-heading"><h2 id="examples-title">Try a travel mission</h2><span>Choose one to make it yours</span></div>
            <div className="example-grid">
              {[
                { category: 'FLIGHTS', title: 'Bengaluru → Hyderabad flights for 2 passengers within my budget.', icon: Plane, symbol: 'flight' },
                { category: 'TRIP PLANNING', title: 'Plan a 3-day Goa trip with a hotel, attractions, and activities.', icon: Compass, symbol: 'plan' },
                { category: 'PLACES', title: 'Find highly rated restaurants and cafes in Bengaluru.', icon: MapPin, symbol: 'local' },
                { category: 'FLIGHT + HOTEL', title: 'Plan a trip from Bengaluru to Goa with flights and a hotel.', icon: Search, symbol: 'research' },
              ].map((example) => <button className="example-card" type="button" key={example.title} onClick={() => setGoal(example.title)}>
                <span className={`example-symbol example-symbol-${example.symbol}`} aria-hidden="true">
                  <example.icon size={16} strokeWidth={1.8} />
                </span>
                <span className="example-copy"><span className="example-category">{example.category}</span><span className="example-title">{example.title}</span></span>
                <ArrowUpRight className="example-arrow" size={15} aria-hidden="true" />
              </button>)}
            </div>
          </section>
        </>}

        {busy && missionStartedAt !== undefined && <section className="active-mission" aria-label="Mission in progress">
          <MissionHeading goal={submittedGoal} status="running" startedAt={missionStartedAt} onReset={resetMission} />
          <div className="waiting-panel" role="status" aria-live="polite">
            <span className="waiting-spinner" aria-hidden="true" />
            <div><strong>Searching for travel options</strong><p>The service returns its travel plan, live searches, and findings together when execution finishes. No live tool updates are available yet.</p></div>
          </div>
          <div className="execution-placeholder">
            <span className="placeholder-kicker">EXECUTION TRACE</span>
            <p>Returned planning and tool activity will appear here.</p>
          </div>
        </section>}

        {response && missionStartedAt !== undefined && <section className="active-mission" aria-label="Mission execution workspace">
          <MissionHeading goal={submittedGoal} status={response.status} startedAt={missionStartedAt} finishedAt={missionFinishedAt} onReset={resetMission} />
          <MissionStages response={response} />
          <FinalResult result={response.result} status={response.status} error={response.error} toolCalls={response.toolCalls} />
          <div className="workspace-grid">
            <div className="workspace-primary">
              <FindingsPanel findings={response.findings} />
              <PlanPanel plan={response.plan} busy={false} />
              <ToolActivity toolCalls={response.toolCalls} busy={false} />
              <ReplanningPanel replans={response.replans} busy={false} />
            </div>
            <aside className="workspace-aside">
              <ConstraintPanel constraints={response.result.constraints} />
              <EvidencePanel evidence={response.evidence} />
            </aside>
          </div>
        </section>}
      </main>

      <footer className="workspace-footer">
        <span><Orbit size={14} aria-hidden="true" /> MISSIONOS <i /> TRAVEL INTELLIGENCE</span>
        <span>Clear answers. Verifiable sources.</span>
      </footer>
    </div>
  )
}

function friendlyError(error: unknown): string {
  const message = error instanceof Error ? error.message : ''
  if (/timed out|timeout/i.test(message)) return 'This mission took longer than expected. Try narrowing the request and run it again.'
  if (/configuration|required.*api key|provider/i.test(message)) return 'The mission service is temporarily unavailable. Please try again later.'
  if (/failed to fetch|network|fetch/i.test(message)) return 'We couldn’t connect to MissionOS. Check your connection and try again.'
  return message || 'We couldn’t complete that request. Please try again.'
}

interface MissionStagesProps {
  response: MissionResponse
}

function MissionHeading({
  goal,
  status,
  startedAt,
  finishedAt,
  onReset,
}: {
  goal: string
  status: 'running' | MissionResponse['status']
  startedAt: number
  finishedAt?: number
  onReset: () => void
}) {
  const label = status === 'running' ? 'Running' : status === 'completed' ? 'Complete'
    : status === 'needs_information' ? 'Needs information'
      : status === 'no_match' ? 'No match' : status === 'failed' ? 'Not completed' : status

  return <div className="mission-heading">
    <div className="mission-heading-copy">
      <span className="landing-eyebrow"><span className="status-indicator" data-state={status} /> TRAVEL WORKSPACE</span>
      <h1>{goal}</h1>
      <div className="mission-meta"><span className="mission-status" data-state={status}>{label}</span><ElapsedTime startedAt={startedAt} finishedAt={finishedAt} running={status === 'running'} /></div>
    </div>
    <button className="new-mission-button" type="button" onClick={onReset}><Plus size={15} aria-hidden="true" /> <span>New mission</span></button>
  </div>
}

function ElapsedTime({ startedAt, finishedAt, running }: { startedAt: number; finishedAt?: number; running: boolean }) {
  const [now, setNow] = useState(startedAt)

  useEffect(() => {
    if (!running) return
    const timer = window.setInterval(() => setNow(Date.now()), 1_000)
    return () => window.clearInterval(timer)
  }, [running])

  const elapsed = Math.max(0, Math.floor(((running ? now : finishedAt ?? now) - startedAt) / 1_000))
  const minutes = Math.floor(elapsed / 60)
  const seconds = elapsed % 60
  return <span className="elapsed-time"><span className="elapsed-dot" /> {minutes ? `${minutes}m ` : ''}{String(seconds).padStart(2, '0')}s elapsed</span>
}

function MissionStages({ response }: MissionStagesProps) {
  const toolCalls = response.toolCalls
  const stages = [
    { label: 'Planning', detail: response.plan.length ? `${response.plan.length} action${response.plan.length === 1 ? '' : 's'} returned` : 'No plan returned', state: response.plan.length ? 'complete' : 'attention' },
    { label: 'Searching', detail: `${toolCalls.length} tool call${toolCalls.length === 1 ? '' : 's'} · ${response.findings.length} finding${response.findings.length === 1 ? '' : 's'}`, state: toolCalls.some((call) => call.status === 'failed') && !toolCalls.some((call) => call.status === 'completed') ? 'attention' : toolCalls.length ? 'complete' : 'attention' },
    { label: 'Analyzing', detail: `${response.result.verifiedFacts.length} verified fact${response.result.verifiedFacts.length === 1 ? '' : 's'}`, state: response.result.verifiedFacts.length ? 'complete' : 'neutral' },
    { label: 'Checking constraints', detail: `${response.result.constraints.length} requirement${response.result.constraints.length === 1 ? '' : 's'} assessed`, state: response.result.constraints.some((item) => item.status === 'violated') ? 'attention' : response.result.constraints.length ? 'complete' : 'neutral' },
    { label: 'Replanning', detail: response.replans.length ? `${response.replans.length} adjustment${response.replans.length === 1 ? '' : 's'} reported` : 'No replans reported', state: response.replans.length ? 'complete' : 'neutral' },
    { label: 'Result', detail: response.status === 'completed' ? 'Mission complete' : response.status === 'no_match' ? 'No matching option' : response.status === 'needs_information' ? 'More information needed' : 'Mission not completed', state: response.status === 'completed' ? 'complete' : 'attention' },
  ]

  return <section className="stage-section" aria-label="Mission stages">
    <div className="stage-heading"><div><span className="section-overline">EXECUTION TRACE</span><h2>How your travel agent worked</h2></div><span>Based on returned activity</span></div>
    <ol className="stage-list">
      {stages.map((stage) => <li className="stage-item" data-state={stage.state} key={stage.label}>
        <span className="stage-number" aria-hidden="true">{stage.state === 'complete' ? '✓' : stage.state === 'attention' ? '!' : '·'}</span>
        <span className="stage-copy"><strong>{stage.label}</strong><small>{stage.detail}</small></span>
      </li>)}
    </ol>
  </section>
}