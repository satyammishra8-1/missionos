import type { MissionResult, MissionStatus } from '../types/mission'
import { displaySummary } from './missionFormat'

interface FinalResultProps {
  result: MissionResult
  status: MissionStatus
}

export function FinalResult({ result, status }: FinalResultProps) {
  return (
    <section className="final-result" aria-labelledby="final-result-heading">
      <div className="section-heading-row">
        <div>
          <p className="section-kicker">Mission outcome</p>
          <h2 id="final-result-heading" className="section-title">Recommended next steps</h2>
        </div>
        <span className="result-seal" data-state={status}>{status}</span>
      </div>
      <div className="result-summary">{displaySummary(result.summary)}</div>
      <div className="result-columns">
        <ResultList
          title="Verified facts"
          count={result.verifiedFacts.length}
          empty="No verified facts were returned."
        >
          {result.verifiedFacts.map((fact, index) => (
            <li className="result-item" key={`${fact.toolId}-${fact.url ?? index}`}>
              <span className="fact-marker" aria-hidden="true" />
              <div>
                <p>{fact.claim}</p>
                {fact.source && <span className="fact-source">{fact.source}</span>}
                {fact.url && <a href={fact.url} target="_blank" rel="noreferrer">View source ↗</a>}
              </div>
            </li>
          ))}
        </ResultList>
        <ResultList title="Assumptions" count={result.assumptions.length} empty="None reported.">
          {result.assumptions.map((assumption, index) => <li className="plain-result-item" key={`${assumption}-${index}`}>{assumption}</li>)}
        </ResultList>
        <ResultList title="Missing information" count={result.missingInformation.length} empty="None reported.">
          {result.missingInformation.map((missing, index) => <li className="plain-result-item" key={`${missing}-${index}`}>{missing}</li>)}
        </ResultList>
      </div>
    </section>
  )
}

interface ResultListProps {
  title: string
  count: number
  empty: string
  children: React.ReactNode
}

function ResultList({ title, count, empty, children }: ResultListProps) {
  return (
    <section className="result-group">
      <div className="result-group-heading">
        <h3>{title}</h3>
        <span>{count}</span>
      </div>
      {count ? <ul>{children}</ul> : <p className="result-empty">{empty}</p>}
    </section>
  )
}