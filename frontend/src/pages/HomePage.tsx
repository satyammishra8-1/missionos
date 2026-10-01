import { useEffect, useRef, useState } from 'react'
import { AgentStatus } from '../components/AgentStatus'
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
import './workspace.css'

type PageState =
  | { status: 'ready' }
  | { status: 'running' }
  | { status: 'error'; message: string }
  | { status: 'success'; response: MissionResponse }

export function HomePage() {
  const [goal, setGoal] = useState('')
  const [constraints, setConstraints] = useState('')
  const [submittedGoal, setSubmittedGoal] = useState('')
  const [pageState, setPageState] = useState<PageState>({ status: 'ready' })
  const [formError, setFormError] = useState<string>()
  const requestController = useRef<AbortController | null>(null)
  const busy = pageState.status === 'running'
  const response = pageState.status === 'success' ? pageState.response : undefined

  useEffect(() => () => requestController.current?.abort(), [])

  async function runMission() {
    setFormError(undefined)
    let parsedConstraints: Record<string, unknown> | undefined
    if (constraints.trim()) {
      try {
        const parsed: unknown = JSON.parse(constraints)
        if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
          throw new Error('Constraints must be a JSON object.')
        }
        parsedConstraints = parsed as Record<string, unknown>
      } catch (error) {
        setFormError(error instanceof Error ? error.message : 'Constraints must be valid JSON.')
        return
      }
    }

    requestController.current?.abort()
    const controller = new AbortController()
    requestController.current = controller
    setSubmittedGoal(goal.trim())
    setPageState({ status: 'running' })

    try {
      const result = await postMission({
        goal: goal.trim(),
        ...(parsedConstraints ? { constraints: parsedConstraints } : {}),
      }, controller.signal)
      setPageState({ status: 'success', response: result })
    } catch (error) {
      if (controller.signal.aborted) return
      setPageState({
        status: 'error',
        message: error instanceof Error ? error.message : 'Mission request failed.',
      })
    }
  }

  function resetMission() {
    requestController.current?.abort()
    requestController.current = null
    setGoal('')
    setConstraints('')
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
        <div className="header-context">
          <span className="header-context-dot" aria-hidden="true" />
          <span>Agent workspace</span>
        </div>
        {pageState.status !== 'ready' && (
          <button className="new-mission-button" type="button" onClick={resetMission} disabled={busy}>
            <span aria-hidden="true">＋</span> New mission
          </button>
        )}
      </header>

      <main id="top" className="workspace-main">
        <div className="workspace-heading">
          <div>
            <p className="workspace-eyebrow">MISSION EXECUTION <span> / </span> 01</p>
            <h1>Mission workspace</h1>
          </div>
          <p className="heading-note">A goal in. Evidence-backed action out.</p>
        </div>

        <MissionInput
          goal={goal}
          constraints={constraints}
          busy={busy}
          error={formError ?? (pageState.status === 'error' ? pageState.message : undefined)}
          onGoalChange={setGoal}
          onConstraintsChange={setConstraints}
          onSubmit={runMission}
        />

        {(busy || response) && (
          <section className="mission-workspace" aria-label="Mission execution workspace">
            <div className="mission-summary-line">
              <div>
                <span className="section-kicker">Active mission</span>
                <h2>{submittedGoal}</h2>
              </div>
              {response && <span className="mission-id-badge">{response.missionId}</span>}
            </div>

            <div className="workspace-grid">
              <div className="workspace-primary">
                <AgentStatus busy={busy} response={response} />
                <PlanPanel plan={response?.plan ?? []} busy={busy} />
                <ToolActivity toolCalls={response?.toolCalls ?? []} busy={busy} />
                <ReplanningPanel replans={response?.replans ?? []} busy={busy} />
                <FindingsPanel findings={response?.findings ?? []} busy={busy} />
              </div>
              <aside className="workspace-aside">
                <ConstraintPanel constraints={response?.result.constraints ?? []} busy={busy} />
                <EvidencePanel evidence={response?.evidence ?? []} busy={busy} />
              </aside>
            </div>

            {response && <FinalResult result={response.result} status={response.status} />}
          </section>
        )}
      </main>

      <footer className="workspace-footer">
        <span>MISSIONOS <b>•</b> OPEN AGENT SYSTEM</span>
        <span>Backend execution trace</span>
      </footer>
    </div>
  )
}