export function formatData(value: unknown): string {
  if (typeof value === 'string') return value
  if (value === undefined) return 'Not provided'
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

export function displaySummary(value: unknown): string {
  if (value === null || value === undefined || value === '') return 'No final result was returned.'
  if (
    typeof value === 'object' && value !== null &&
    'summary' in value && typeof value.summary === 'string'
  ) return value.summary
  return typeof value === 'string' ? value : formatData(value)
}

export function displayToolName(toolId: string): string {
  return toolId
    .replace(/-/g, ' ')
    .replace(/\b\w/g, (character) => character.toUpperCase())
}