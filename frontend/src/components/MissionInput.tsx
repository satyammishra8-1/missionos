import { ArrowUpRight, ChevronDown, SlidersHorizontal } from 'lucide-react'

interface OptionalConstraints {
  budget: string
  currency: string
  mustHaves: string
}

interface MissionInputProps {
  goal: string
  constraints: OptionalConstraints
  busy: boolean
  error?: string
  onGoalChange: (value: string) => void
  onConstraintsChange: (value: OptionalConstraints) => void
  onSubmit: () => void
}

export function MissionInput({
  goal,
  constraints,
  busy,
  error,
  onGoalChange,
  onConstraintsChange,
  onSubmit,
}: MissionInputProps) {
  return (
    <form
      className="mission-input"
      aria-busy={busy}
      onSubmit={(event) => {
        event.preventDefault()
        onSubmit()
      }}
    >
      <label className="field-label" htmlFor="mission-goal">YOUR TRAVEL MISSION</label>
      <textarea
        id="mission-goal"
        className="mission-textarea"
        value={goal}
        onChange={(event) => onGoalChange(event.target.value)}
        placeholder="Where are you going? Share dates, travelers, budget, and what matters to you…"
        rows={2}
        maxLength={4_000}
        required
        disabled={busy}
        aria-describedby={`mission-goal-hint mission-goal-count${error ? ' mission-goal-error' : ''}`}
        aria-invalid={Boolean(error)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
            event.preventDefault()
            event.currentTarget.form?.requestSubmit()
          }
        }}
      />
      <div className="composer-meta"><span id="mission-goal-hint">Include your route or destination, dates, and travel preferences.</span><span className="char-count" id="mission-goal-count">{goal.length.toLocaleString()} / 4,000</span></div>
      <details className="constraint-options">
        <summary><SlidersHorizontal size={14} aria-hidden="true" /> Set travel constraints <ChevronDown className="constraint-chevron" size={14} aria-hidden="true" /></summary>
        <div className="constraint-fields">
          <label className="constraint-field" htmlFor="mission-budget"><span className="field-label">Maximum budget</span>
            <div className="budget-input-row"><select aria-label="Budget currency" value={constraints.currency} onChange={(event) => onConstraintsChange({ ...constraints, currency: event.target.value })} disabled={busy}>
              <option value="USD">USD $</option><option value="INR">INR ₹</option><option value="EUR">EUR €</option><option value="GBP">GBP £</option>
            </select><input id="mission-budget" inputMode="decimal" type="number" min="0" step="any" value={constraints.budget} onChange={(event) => onConstraintsChange({ ...constraints, budget: event.target.value })} placeholder="Any amount" disabled={busy} /></div>
          </label>
          <label className="constraint-field" htmlFor="mission-must-haves"><span className="field-label">Must-haves</span>
            <input id="mission-must-haves" type="text" value={constraints.mustHaves} onChange={(event) => onConstraintsChange({ ...constraints, mustHaves: event.target.value })} placeholder="Separate with commas" disabled={busy} />
          </label>
        </div>
      </details>
      <div className="input-bottom-row">
        <span className="input-hint">Shortcut <kbd>⌘</kbd> / <kbd>Ctrl</kbd> + <kbd>Enter</kbd></span>
        <button className="run-button" type="submit" disabled={busy || !goal.trim()}>
          {busy ? <><span className="button-spinner" aria-hidden="true" />Working</> : <>Run mission <ArrowUpRight size={15} aria-hidden="true" /></>}
        </button>
      </div>
      {error && <p className="form-error" id="mission-goal-error" role="alert">{error}</p>}
    </form>
  )
}