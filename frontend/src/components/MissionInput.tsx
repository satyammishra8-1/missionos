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
      onSubmit={(event) => {
        event.preventDefault()
        onSubmit()
      }}
    >
      <label className="field-label" htmlFor="mission-goal">YOUR MISSION</label>
      <textarea
        id="mission-goal"
        className="mission-textarea"
        value={goal}
        onChange={(event) => onGoalChange(event.target.value)}
        placeholder="Describe what you’re trying to find, decide, or plan…"
        rows={2}
        maxLength={4_000}
        required
        disabled={busy}
      />
      <details className="constraint-options">
        <summary><span className="plus-mark" aria-hidden="true">＋</span> Add optional constraints</summary>
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
        <span className="input-hint">More detail helps MissionOS find a better answer.</span>
        <button className="run-button" type="submit" disabled={busy || !goal.trim()}>
          {busy ? <><span className="button-spinner" aria-hidden="true" />Working</> : <>Run mission <span aria-hidden="true">↗</span></>}
        </button>
      </div>
      {error && <p className="form-error" role="alert">{error}</p>}
    </form>
  )
}