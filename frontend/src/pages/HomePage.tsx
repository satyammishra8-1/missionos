import { useEffect, useRef, useState } from 'react'
import { ConstraintPanel } from '../components/ConstraintPanel'
import { EvidencePanel } from '../components/EvidencePanel'
import { FinalResult } from '../components/FinalResult'
import { FindingsPanel } from '../components/FindingsPanel'
import { MissionInput } from '../components/MissionInput'
import { postMission } from '../services/api'
import type { MissionResponse } from '../types/mission'
import './workspace.css'

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
  const [goal, setGoal] = useState('')
  const [constraints, setConstraints] = useState<OptionalConstraints>({ budget: '', currency: 'USD', mustHaves: '' })
  const [submittedGoal, setSubmittedGoal] = useState('')
  const [pageState, setPageState] = useState<PageState>({ status: 'ready' })
  const [formError, setFormError] = useState<string>()
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
    setPageState({ status: 'running' })

    try {
      const result = await postMission({
        goal: goal.trim(),
        ...(Object.keys(parsedConstraints).length ? { constraints: parsedConstraints } : {}),
      }, controller.signal)
      setPageState({ status: 'success', response: result })
    } catch (error) {
      if (controller.signal.aborted) return
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
    setFormError(undefined)
    setPageState({ status: 'ready' })
  }

  return (
    <div className="workspace-shell">
      <header className="workspace-header">
        <a className="workspace-brand" href="#top" aria-label="MissionOS home">
          <span className="brand-symbol" aria-hidden="true"><i /><i /><i /></span>
          <span>Mission<span className="brand-light">OS</span></span>
        </a>
        <div className="header-context">Research, made useful</div>
        {pageState.status !== 'ready' && (
          <button className="new-mission-button" type="button" onClick={resetMission} disabled={busy}>
            <span aria-hidden="true">＋</span> New mission
          </button>
        )}
      </header>

      <main id="top" className="workspace-main">
        {pageState.status === 'ready' && <div className="landing-heading">
          <span className="landing-eyebrow"><span className="eyebrow-mark" /> YOUR AI RESEARCH PARTNER</span>
          <h1>Tell MissionOS<br />what you need.</h1>
          <p>Turn a goal into a clear answer, grounded in real findings and their sources.</p>
        </div>}

        <MissionInput
          goal={goal}
          constraints={constraints}
          busy={busy}
          error={formError ?? (pageState.status === 'error' ? pageState.message : undefined)}
          onGoalChange={setGoal}
          onConstraintsChange={setConstraints}
          onSubmit={runMission}
        />

        {pageState.status === 'ready' && <section className="examples" aria-labelledby="examples-title">
          <div className="examples-heading"><h2 id="examples-title">A few places to start</h2><span>Choose one to edit</span></div>
          <div className="example-grid">
            {[
              { category: 'RESEARCH', title: 'Compare compact cameras under $900', icon: '↗' },
              { category: 'PLANNING', title: 'Plan a two-day coastal break', icon: '⌁' },
              { category: 'DISCOVERY', title: 'Find a quiet place to work nearby', icon: '⌖' },
            ].map((example) => <button className="example-card" type="button" key={example.title} onClick={() => setGoal(example.title)}>
              <span className="example-card-top"><span>{example.category}</span><span aria-hidden="true">{example.icon}</span></span>
              <span className="example-title">{example.title}</span>
            </button>)}
          </div>
        </section>}

        {busy && <section className="running-state" role="status" aria-live="polite">
          <span className="running-spinner" aria-hidden="true" />
          <div><h2>Your mission is in progress</h2><p>We’ll show the stages and findings when the service returns its execution record.</p></div>
        </section>}

        {response && (
          <section className="mission-workspace" aria-label="Mission execution workspace">
            <div className="mission-summary-line">
              <div>
                <span className="section-kicker">YOUR MISSION</span>
                <h2>{submittedGoal}</h2>
              </div>
            </div>

            <MissionStages response={response} />
            <div className="workspace-grid">
              <div className="workspace-primary">
                <FindingsPanel findings={response.findings} />
              </div>
              <aside className="workspace-aside">
                <ConstraintPanel constraints={response.result.constraints} />
                <EvidencePanel evidence={response.evidence} />
              </aside>
            </div>

            <FinalResult result={response.result} status={response.status} error={response.error} toolCalls={response.toolCalls} />
          </section>
        )}
      </main>

      <footer className="workspace-footer">
        <span>MISSIONOS <b>·</b> ANSWERS WITH SOURCES</span>
        <span>Your research, clearly considered.</span>
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

function MissionStages({ response }: MissionStagesProps) {
  const stages = [
    { label: 'Planning', complete: response.plan.length > 0, detail: response.plan.length ? `${response.plan.length} action${response.plan.length === 1 ? '' : 's'} prepared` : 'No plan returned' },
    { label: 'Searching', complete: response.toolCalls.some((call) => call.status === 'completed'), detail: response.toolCalls.some((call) => call.status === 'completed') ? `${response.findings.length} finding${response.findings.length === 1 ? '' : 's'} collected` : 'No completed searches' },
    { label: 'Analyzing', complete: response.result.verifiedFacts.length > 0, detail: response.result.verifiedFacts.length ? `${response.result.verifiedFacts.length} source-backed facts` : 'No verified facts' },
    { label: 'Checking constraints', complete: response.result.constraints.length > 0, detail: response.result.constraints.length ? `${response.result.constraints.length} requirement${response.result.constraints.length === 1 ? '' : 's'} checked` : 'No constraints to check' },
    { label: 'Replanning', complete: response.replans.length > 0, detail: response.replans.length ? `Adjusted ${response.replans.length} time${response.replans.length === 1 ? '' : 's'}` : 'No adjustment needed', neutral: response.replans.length === 0 },
    { label: 'Result', complete: response.result.summary !== null && response.result.summary !== undefined, detail: 'Mission response received' },
  ]

  return <section className="stage-section" aria-label="Mission stages">
    <ol className="stage-list">
      {stages.map((stage, index) => <li className="stage-item" data-complete={stage.complete} data-neutral={stage.neutral} key={stage.label}>
        <span className="stage-number">{stage.complete ? '✓' : index + 1}</span>
        <span className="stage-copy"><strong>{stage.label}</strong><small>{stage.detail}</small></span>
      </li>)}
    </ol>
  </section>
}