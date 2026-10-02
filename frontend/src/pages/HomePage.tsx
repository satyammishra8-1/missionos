import { useEffect, useRef, useState } from 'react'
import { ArrowUpRight, BedDouble, Compass, MapPin, Moon, Orbit, Plane, Plus, Sparkles, Sun } from 'lucide-react'
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
        <span className="system-label"><span className="system-dot" aria-hidden="true" /> AI TRAVEL AGENT</span>
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
            <p>Search flights and stays, discover local places, and plan practical trips with travel results, clear constraints, and source links.</p>
          </section>

          {pageState.status === 'error' && <div className="request-error" role="alert">
            <div><strong>Mission couldn’t be started</strong><p>{pageState.message}</p></div>
            <div className="request-error-actions"><span>Review the message above before retrying.</span><button className="new-mission-button" type="button" onClick={resetMission}><Plus size={14} aria-hidden="true" /> New mission</button></div>
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
                { category: 'FLIGHT SEARCH', title: 'Find Bengaluru → Hyderabad flights for 2 on October 10, 2026 under ₹20,000.', icon: Plane, symbol: 'flight' },
                { category: 'HOTEL SEARCH', title: 'Find a Goa hotel for 2, check in November 10, 2026 and check out November 13, 2026, with breakfast and a pool.', icon: BedDouble, symbol: 'research' },
                { category: 'RESTAURANTS & LOCAL', title: 'Find highly rated restaurants near Koramangala, Bengaluru.', icon: MapPin, symbol: 'local' },
                { category: 'COMPLETE TRIP', title: 'Plan a 3-day Bengaluru → Goa trip for 2, October 10, 2026 to October 12, 2026, under ₹30,000 with flights, hotel, and places to visit.', icon: Compass, symbol: 'plan' },
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
            <div><strong>Mission in progress</strong><p>The mission request is in progress. Planning and tool activity are not streamed by the API; the execution trace will appear when the response is ready.</p></div>
          </div>
          <MissionStages busy />
        </section>}

        {response && missionStartedAt !== undefined && <section className="active-mission" aria-label="Mission execution workspace">
          <MissionHeading goal={submittedGoal} status={response.status} startedAt={missionStartedAt} finishedAt={missionFinishedAt} onReset={resetMission} />
          <MissionStages response={response} />
          <FinalResult result={response.result} status={response.status} error={response.error} toolCalls={response.toolCalls} plannerWarnings={response.plannerWarnings} />
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
  if (/quota|rate.?limit|too many requests|resource_exhausted/i.test(message)) {
    return 'The travel provider has reached its request limit. Wait for the quota to reset, or check the provider account limits before retrying.'
  }
  if (/timed out|timeout/i.test(message)) return 'This mission took longer than expected. Try narrowing the request and run it again.'
  if (/configuration|required.*api key|missing .*key/i.test(message)) return 'A required travel provider is not configured. Ask the MissionOS administrator to check the backend API keys and mock-mode settings.'
  if (/failed to fetch|network|fetch/i.test(message)) return 'We couldn’t connect to MissionOS. Check your connection and try again.'
  return message || 'We couldn’t complete that request. Please try again.'
}

interface MissionStagesProps {
  response?: MissionResponse
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

function MissionStages({ response, busy = false }: MissionStagesProps & { busy?: boolean }) {
  const toolCalls = response?.toolCalls ?? []
  const returnedOptions = response?.findings.reduce((count, finding) => {
    const output = finding.output
    return count + (typeof output === 'object' && output !== null && 'results' in output && Array.isArray(output.results)
      ? output.results.length
      : 0)
  }, 0) ?? 0
  const constraintStatus = response?.result.constraints ?? []
  const searchFailed = toolCalls.some((call) => call.status === 'failed') &&
    !toolCalls.some((call) => call.status === 'completed')
  const stages = busy ? [
    { label: 'Planning', detail: 'Execution details not streamed yet', state: 'awaiting' },
    { label: 'Searching', detail: 'Execution details not streamed yet', state: 'awaiting' },
    { label: 'Comparing', detail: 'Returned options will appear with the response', state: 'awaiting' },
    { label: 'Checking constraints', detail: 'Assessments will appear with the response', state: 'awaiting' },
    { label: 'Replanning', detail: 'Any replan history will appear with the response', state: 'awaiting' },
    { label: 'Final result', detail: 'Waiting for the mission service', state: 'awaiting' },
  ] : [
    { label: 'Planning', detail: response?.plan.length ? `${response.plan.length} plan action${response.plan.length === 1 ? '' : 's'} returned` : 'No plan returned', state: response?.plan.length ? 'complete' : 'attention' },
    { label: 'Searching', detail: `${toolCalls.length} tool call${toolCalls.length === 1 ? '' : 's'} · ${response?.findings.length ?? 0} finding${response?.findings.length === 1 ? '' : 's'}`, state: searchFailed ? 'attention' : toolCalls.length ? 'complete' : 'attention' },
    { label: 'Comparing', detail: returnedOptions ? `${returnedOptions} option${returnedOptions === 1 ? '' : 's'} available to compare` : 'No options returned for comparison', state: 'neutral' },
    { label: 'Checking constraints', detail: constraintStatus.length
      ? `${constraintStatus.filter((item) => item.status === 'satisfied').length} satisfied · ${constraintStatus.filter((item) => item.status === 'violated').length} violated · ${constraintStatus.filter((item) => item.status === 'unknown').length} unknown`
      : 'No constraint assessments returned',
    state: constraintStatus.some((item) => item.status !== 'satisfied') ? 'attention' : constraintStatus.length ? 'complete' : 'neutral' },
    { label: 'Replanning', detail: response?.replans.length ? `${response.replans.length} replanning step${response.replans.length === 1 ? '' : 's'} returned` : 'No replans reported', state: response?.replans.length ? 'complete' : 'neutral' },
    { label: 'Final result', detail: response?.status === 'completed' ? 'Mission complete' : response?.status === 'no_match' ? 'No matching option' : response?.status === 'needs_information' ? 'More information needed' : 'Mission not completed', state: response?.status === 'completed' ? 'complete' : 'attention' },
  ]

  return <section className="stage-section" aria-label="Mission stages" aria-live={busy ? 'polite' : undefined}>
    <div className="stage-heading"><div><span className="section-overline">{busy ? 'MISSION PROGRESS' : 'EXECUTION TRACE'}</span><h2>{busy ? 'Travel mission in progress' : 'How your travel agent worked'}</h2></div><span>{busy ? 'Live activity is not available' : 'Based on returned activity'}</span></div>
    <ol className="stage-list">
      {stages.map((stage) => <li className="stage-item" data-state={stage.state} key={stage.label}>
        <span className="stage-number" aria-hidden="true">{stage.state === 'complete' ? '✓' : stage.state === 'attention' ? '!' : '·'}</span>
        <span className="stage-copy"><strong>{stage.label}</strong><small>{stage.detail}</small></span>
      </li>)}
    </ol>
  </section>
}