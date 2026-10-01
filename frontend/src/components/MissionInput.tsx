interface MissionInputProps {
  goal: string
  constraints: string
  busy: boolean
  error?: string
  onGoalChange: (value: string) => void
  onConstraintsChange: (value: string) => void
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
      <label className="field-label" htmlFor="mission-goal">Mission</label>
      <textarea
        id="mission-goal"
        className="mission-textarea"
        value={goal}
        onChange={(event) => onGoalChange(event.target.value)}
        placeholder="Plan my Hyderabad interview trip under ₹8,000"
        rows={3}
        maxLength={4_000}
        required
        disabled={busy}
      />
      <div className="input-bottom-row">
        <label className="constraint-field" htmlFor="mission-constraints">
          <span className="field-label">Constraints <span className="optional-label">Optional</span></span>
          <textarea
            id="mission-constraints"
            className="constraints-textarea"
            value={constraints}
            onChange={(event) => onConstraintsChange(event.target.value)}
            placeholder={'{"budget": 8000, "location": "Hyderabad"}'}
            rows={2}
            disabled={busy}
            spellCheck={false}
          />
        </label>
        <button className="run-button" type="submit" disabled={busy || !goal.trim()}>
          {busy ? <><span className="button-spinner" aria-hidden="true" />Running</> : <>Run Mission <span aria-hidden="true">↗</span></>}
        </button>
      </div>
      {error && <p className="form-error" role="alert">{error}</p>}
    </form>
  )
}