export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function humanizeKey(value: string): string {
  return value.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())
}

export function displaySummary(value: unknown): string {
  if (typeof value === 'string' && value.trim()) return value
  if (isRecord(value) && typeof value.summary === 'string') return value.summary
  return 'Mission findings are ready below.'
}

export function formatData(value: unknown): string {
  return typeof value === 'string' ? value : 'More details are available in the results below.'
}

export function displayToolName(toolId: string): string {
  return toolId.replace(/-/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())
}

export function formatDuration(value: unknown): string | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return undefined
  const hours = Math.floor(value / 60)
  const minutes = Math.round(value % 60)
  return [hours ? `${hours} hr${hours === 1 ? '' : 's'}` : '', minutes ? `${minutes} min` : '']
    .filter(Boolean).join(' ') || 'Under 1 min'
}

export function formatPrice(value: unknown, currency?: string): string | undefined {
  if (isRecord(value)) {
    if (typeof value.display === 'string') return value.display
    if (typeof value.amount === 'number') return formatPrice(value.amount, currency)
  }
  if (typeof value === 'string' && !/^\s*[\d,.]+\s*$/.test(value)) return value
  const amount = typeof value === 'number' ? value : typeof value === 'string' ? Number(value.replace(/,/g, '')) : NaN
  if (!Number.isFinite(amount)) return undefined
  const code = currency && /^[A-Z]{3}$/i.test(currency) ? currency.toUpperCase() : undefined
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency: code ?? 'USD', maximumFractionDigits: 2 }).format(amount)
  } catch {
    return `${currency ?? ''} ${amount.toLocaleString()}`.trim()
  }
}