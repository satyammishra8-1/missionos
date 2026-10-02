import type { MissionFinding } from '../types/mission'
import { ArrowUpRight } from 'lucide-react'
import { formatDuration, formatPrice, humanizeKey, isRecord } from './missionFormat'

interface FindingsPanelProps {
  findings: readonly MissionFinding[]
  busy?: boolean
}

export function FindingsPanel({ findings, busy = false }: FindingsPanelProps) {
  return (
    <section className="workspace-section" aria-labelledby="findings-heading">
      <div className="section-heading-row">
        <div>
          <p className="section-kicker">TRAVEL FINDINGS</p>
          <h2 id="findings-heading" className="section-title">Verified travel findings</h2>
        </div>
        <span className="count-label">{findings.reduce((count, finding) => count + resultItems(finding.output).length, 0)} results</span>
      </div>
      {findings.length === 0 ? (
        <p className="empty-state">{busy ? 'Travel findings will appear when the search finishes.' : 'No travel results were returned. Try different dates, locations, or preferences.'}</p>
      ) : (
        <ul className="findings-list">
          {findings.map((finding) => (
            <li className="finding-group" key={finding.stepId}>
              <p className="finding-objective">{finding.objective}</p>
                <div className="result-card-list">
                  {resultItems(finding.output).map((item, index, items) => {
                    const prices = items.map((candidate) => numericPrice(candidate.value)).filter((price): price is number => price !== undefined)
                    const price = numericPrice(item.value)
                    const flight = isRecord(item.value) && typeof item.value.flightNumber === 'string'
                    return <ResultOptionCard
                      key={`${item.title}-${index}`}
                      item={item.value}
                      currency={item.currency}
                      highlighted={flight && price !== undefined && price === Math.min(...prices)}
                    />
                  })}
                </div>
                {resultItems(finding.output).length === 0 && <p className="generic-result">{genericSummary(finding.output)}</p>}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

interface ResultItem {
  value: unknown
  currency?: string
  title: string
}

function resultItems(output: unknown): ResultItem[] {
  if (!isRecord(output)) return []
  const currency = typeof output.currency === 'string' ? output.currency : undefined
  if (Array.isArray(output.results)) {
    return output.results.map((value, index) => ({
      value,
      currency,
      title: isRecord(value) ? titleFor(value) : `Result ${index + 1}`,
    }))
  }
  return [{ value: output, currency, title: titleFor(output) }]
}

function titleFor(value: Record<string, unknown>): string {
  for (const key of ['airline', 'name', 'title', 'flightNumber', 'summary']) {
    if (typeof value[key] === 'string' && value[key].trim()) return value[key] as string
  }
  return 'Research result'
}

function genericSummary(value: unknown): string {
  if (typeof value === 'string') return value
  if (isRecord(value)) {
    for (const key of ['summary', 'description', 'snippet', 'answer']) {
      if (typeof value[key] === 'string') return value[key] as string
    }
  }
  return 'The mission returned findings that could not be displayed as a result card.'
}

export function ResultOptionCard({ item, currency, highlighted = false }: { item: unknown; currency?: string; highlighted?: boolean }) {
  if (!isRecord(item)) return <article className="result-card"><p>{String(item)}</p></article>
  const flight = typeof item.flightNumber === 'string'
  const title = titleFor(item)
  const isPlace = typeof item.placeLink === 'string'
  const link = [item.link, item.bookingLink, item.url].find((value): value is string =>
    typeof value === 'string' && /^https?:\/\//i.test(value),
  ) ?? (typeof item.placeLink === 'string' && /^https?:\/\//i.test(item.placeLink) ? item.placeLink : undefined)
  const price = formatPrice(item.price ?? item.totalPrice ?? item.amount, currency)
  const excluded = new Set(['link', 'url', 'bookingLink', 'source', 'currency', 'price', 'totalPrice', 'amount', 'airline', 'flightNumber', 'departure', 'arrival', 'duration', 'stops', 'toolId'])
  const details = Object.entries(item).filter(([key, value]) => !excluded.has(key) && value !== null && value !== undefined && value !== '')

  return <article className={`result-card${flight ? ' flight-card' : ''}`} data-highlighted={highlighted || undefined}>
    <div className="result-card-heading">
      <div><h3>{title}</h3>{flight && <span className="flight-number">{String(item.flightNumber)}</span>}</div>
      <div className="result-card-price">{highlighted && <span className="best-price-label">Lowest returned price</span>}{price && <strong className="result-price">{price}</strong>}</div>
    </div>
    {flight && <div className="flight-route">
      <div><span>DEPARTURE</span><strong>{String(item.departure ?? '—')}</strong></div>
      <span className="route-connector" aria-hidden="true">→</span>
      <div><span>ARRIVAL</span><strong>{String(item.arrival ?? '—')}</strong></div>
    </div>}
    {flight && <div className="flight-facts">
      {formatDuration(item.duration) && <span>{formatDuration(item.duration)}</span>}
      {typeof item.stops === 'number' && <span>{item.stops === 0 ? 'Nonstop' : `${item.stops} stop${item.stops === 1 ? '' : 's'}`}</span>}
    </div>}
    {details.length > 0 && <dl className="result-details">{details.map(([key, value]) => <div key={key}><dt>{humanizeKey(key)}</dt><dd>{displayValue(value)}</dd></div>)}</dl>}
    {link && <a className="source-link" href={link} target="_blank" rel="noreferrer">
      {isPlace ? 'View on Google Maps' : flight ? 'Search this flight' : item.bookingLink ? 'View booking options' : 'Open source'}
      <ArrowUpRight size={13} aria-hidden="true" />
    </a>}
  </article>
}

function numericPrice(value: unknown): number | undefined {
  if (!isRecord(value)) return undefined
  const rawPrice = value.price ?? value.totalPrice ?? value.amount
  const price = typeof rawPrice === 'number'
    ? rawPrice
    : typeof rawPrice === 'string'
      ? Number(rawPrice.replace(/[^\d.]/g, ''))
      : Number.NaN
  return Number.isFinite(price) ? price : undefined
}

function displayValue(value: unknown): string {
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (Array.isArray(value)) return value.map(displayValue).join(', ')
  if (isRecord(value)) {
    if (typeof value.display === 'string') return value.display
    if (typeof value.amount === 'number') return formatPrice(value.amount, typeof value.currency === 'string' ? value.currency : undefined) ?? String(value.amount)
    return Object.values(value).map(displayValue).join(' · ')
  }
  return ''
}