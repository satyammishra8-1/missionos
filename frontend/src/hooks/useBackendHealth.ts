import { useEffect, useState } from 'react'
import { fetchHealth } from '../services/api'
import type { BackendHealth } from '../types/health'

type HealthState =
  | { status: 'loading' }
  | { status: 'connected'; health: BackendHealth }
  | { status: 'disconnected'; message: string }

export function useBackendHealth() {
  const [state, setState] = useState<HealthState>({ status: 'loading' })

  useEffect(() => {
    const controller = new AbortController()

    fetchHealth(controller.signal)
      .then((health: BackendHealth) => setState({ status: 'connected', health }))
      .catch((error: unknown) => {
        if (controller.signal.aborted) return

        const message = error instanceof Error ? error.message : 'Request failed'
        setState({ status: 'disconnected', message })
      })

    return () => controller.abort()
  }, [])

  return state
}