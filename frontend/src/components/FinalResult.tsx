import type { MissionResult, MissionStatus, MissionToolCall } from '../types/mission'
import { displaySummary, formatPrice, isRecord } from './missionFormat'
import { ResultOptionCard } from './FindingsPanel'

interface FinalResultProps {
  result: MissionResult
  status: MissionStatus
  error?: { code: string; message: string } | null
  toolCalls: readonly MissionToolCall[]
}

export function FinalResult({ result, status, error, toolCalls }: FinalResultProps) {
  const final = isRecord(result.summary) ? result.summary : undefined
  const constraint = isRecord(final?.constraint) ? final.constraint : undefined
  const expected = constraint?.expected
  const actual = isRecord(constraint?.actual) ? constraint.actual : undefined
  const cheapestOption = final?.cheapestOption
  const alternatives = Array.isArray(final?.alternatives)
    ? final.alternatives.filter((item): item is string => typeof item === 'string')
    : []
  const failure = status === 'failed' ? describeFailure(error, toolCalls) : undefined
  const heading = status === 'no_match' ? 'No matching option found'
    : status === 'needs_information' ? 'A little more information is needed'
      : status === 'failed' ? 'We couldn’t finish this mission'
        : 'Your mission result'
  const summary = status === 'failed'
    ? 'MissionOS couldn’t find enough verified information to complete this request.'
    : result.summary !== null && result.summary !== undefined
    ? displaySummary(result.summary)
      : status === 'needs_information'
        ? 'MissionOS couldn’t verify enough information to complete this request.'
        : 'Mission findings are ready below.'

  return (
    <section className="final-result" data-state={status} aria-labelledby="final-result-heading">
      <div className="section-heading-row">
        <div>
          <p className="section-kicker">MISSION OUTCOME</p>
          <h2 id="final-result-heading" className="section-title">{heading}</h2>
        </div>
        <span className="result-seal" data-state={status}>{status === 'completed' ? 'Ready' : status === 'no_match' ? 'No match' : status === 'needs_information' ? 'Needs details' : status === 'failed' ? 'Not completed' : 'In progress'}</span>
      </div>
      <p className="result-summary">{summary}</p>

      {status === 'no_match' && <div className="no-match-details">
        {constraint && <div className="constraint-explanation">
          <span className="detail-label">Constraint not met</span>
          <strong>{humanConstraint(constraint.id)}</strong>
          <p>{typeof constraint.reason === 'string' ? constraint.reason : 'The available results did not meet this requirement.'}</p>
          <div className="constraint-comparison">
            {expected !== undefined && <span><small>Requested</small><b>{describeExpected(expected)}</b></span>}
            {actual && <span><small>Observed</small><b>{describeActual(actual)}</b></span>}
          </div>
        </div>}
        {cheapestOption !== undefined && <div className="best-option">
          <h3>Best option we found</h3>
          <ResultOptionCard item={cheapestOption} currency={typeof actual?.currency === 'string' ? actual.currency : undefined} />
        </div>}
        {alternatives.length > 0 && <div className="next-actions">
          <h3>What you can try next</h3>
          <ul>{alternatives.map((item, index) => <li key={`${item}-${index}`}>{item}</li>)}</ul>
        </div>}
      </div>}

      {status === 'needs_information' && result.missingInformation.length > 0 && <div className="next-actions">
        <h3>Information still needed</h3><ul>{result.missingInformation.map((item, index) => <li key={`${item}-${index}`}>{item}</li>)}</ul>
      </div>}
      {status === 'failed' && failure && <div className="failure-guidance">
        <div className="failure-reason">
          <span className="detail-label">What happened</span>
          <p>{failure.reason}</p>
        </div>
        <div className="next-actions">
          <h3>What you can try</h3>
          <ul>{failure.suggestions.map((item) => <li key={item}>{item}</li>)}</ul>
        </div>
      </div>}
    </section>
  )
}

function humanConstraint(value: unknown): string {
  if (typeof value !== 'string') return 'A required condition'
  return value.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ').replace(/^./, (letter) => letter.toUpperCase())
}

function describeExpected(value: unknown): string {
  if (isRecord(value)) {
    const maximum = value.max ?? value.maximum ?? value.limit ?? value.amount
    const currency = typeof value.currency === 'string' ? value.currency : undefined
    const formatted = formatPrice(maximum, currency)
    if (formatted) return `Up to ${formatted}`
    return Object.entries(value).map(([key, item]) => `${humanConstraint(key)}: ${String(item)}`).join(' · ')
  }
  return String(value)
}

function describeActual(value: Record<string, unknown>): string {
  const cheapest = value.cheapestObserved ?? value.value
  return formatPrice(cheapest, typeof value.currency === 'string' ? value.currency : undefined) ?? String(cheapest ?? 'Not available')
}

function describeFailure(
  error: FinalResultProps['error'],
  toolCalls: readonly MissionToolCall[],
): { reason: string; suggestions: readonly string[] } {
  const failedTool = toolCalls.find((call) => call.status === 'failed')
  const errorMessage = error?.message
  const toolMessage = failedTool?.error
  const configurationMessage = error?.code === 'configuration'
    ? errorMessage
    : [errorMessage, toolMessage].find((message) => /configuration|required.*api key|provider/i.test(message ?? ''))
  if (error?.code === 'configuration' || configurationMessage) {
    return {
      reason: configurationMessage || 'A required service is not configured.',
      suggestions: ['Try again later', 'Contact the MissionOS administrator if this continues'],
    }
  }
  const timeoutMessage = [errorMessage, toolMessage].find((message) => /timed out|timeout/i.test(message ?? ''))
  if (timeoutMessage) {
    return {
      reason: timeoutMessage,
      suggestions: ['Try a narrower request', 'Reduce the number of requirements or searches', 'Run the mission again'],
    }
  }
  if (failedTool || error?.code === 'tool') {
    const toolName = failedTool ? formatToolName(failedTool.toolId) : undefined
    return {
      reason: toolMessage || errorMessage || `${toolName ?? 'A search tool'} did not return usable results.`,
      suggestions: ['Check the request details and try again', 'Narrow or simplify the search'],
    }
  }
  return {
    reason: errorMessage || 'The mission could not be completed with the available information.',
    suggestions: ['Try a narrower request', 'Run the mission again'],
  }
}

function formatToolName(toolId: string): string {
  return toolId.split(/[-_]/).map((word) => `${word.charAt(0).toUpperCase()}${word.slice(1)}`).join(' ')
}