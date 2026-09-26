const apiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? ''

export async function fetchHealth(signal: AbortSignal) {
  const response = await fetch(`${apiBaseUrl}/api/health`, { signal })

  if (!response.ok) {
    throw new Error(`Health check failed with status ${response.status}`)
  }

  return response.json()
}