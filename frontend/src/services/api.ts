import type { MissionRequest, MissionResponse } from '../types/mission'

const apiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? ''

export async function fetchHealth(signal: AbortSignal) {
  const response = await fetch(`${apiBaseUrl}/api/health`, { signal })

  if (!response.ok) {
    throw new Error(`Health check failed with status ${response.status}`)
  }

  return response.json()
}

export async function postMission(
  mission: MissionRequest,
  signal: AbortSignal,
): Promise<MissionResponse> {
  const response = await fetch(`${apiBaseUrl}/api/missions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(mission),
    signal,
  })

  const payload: unknown = await response.json().catch(() => null)
  if (!response.ok) {
    const message = isRecord(payload) && typeof payload.error === 'string'
      ? payload.error
      : `Mission request failed with status ${response.status}`
    throw new Error(message)
  }
  if (!isMissionResponse(payload)) {
    throw new Error('The mission service returned an invalid response.')
  }
  return payload
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isMissionResponse(value: unknown): value is MissionResponse {
  if (!isRecord(value) || !isRecord(value.result)) return false
  return typeof value.missionId === 'string' &&
    typeof value.status === 'string' &&
    Array.isArray(value.plan) &&
    Array.isArray(value.toolCalls) &&
    Array.isArray(value.replans) &&
    Array.isArray(value.findings) &&
    Array.isArray(value.evidence) &&
    Array.isArray(value.result.verifiedFacts) &&
    Array.isArray(value.result.assumptions) &&
    Array.isArray(value.result.missingInformation) &&
    Array.isArray(value.result.constraints)
}