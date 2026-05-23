import { useState, useCallback } from 'react'

/**
 * useState + sessionStorage. State survives navigation within the tab.
 *
 * @param key         sessionStorage key
 * @param defaultValue used when session is empty
 * @param navOverride  when defined, overrides session (use for fresh navigation state)
 */
export function useSessionState<T>(
  key: string,
  defaultValue: T,
  navOverride?: T,
): [T, React.Dispatch<React.SetStateAction<T>>] {
  const [state, setState] = useState<T>(() => {
    if (navOverride !== undefined) {
      try { sessionStorage.setItem(key, JSON.stringify(navOverride)) } catch { /* ignore */ }
      return navOverride
    }
    try {
      const stored = sessionStorage.getItem(key)
      if (stored !== null) return JSON.parse(stored) as T
    } catch { /* ignore */ }
    return defaultValue
  })

  const setStateAndPersist = useCallback(
    (action: T | ((prev: T) => T)) => {
      setState((prev) => {
        const next = typeof action === 'function' ? (action as (prev: T) => T)(prev) : action
        try { sessionStorage.setItem(key, JSON.stringify(next)) } catch { /* ignore */ }
        return next
      })
    },
    [key],
  ) as React.Dispatch<React.SetStateAction<T>>

  return [state, setStateAndPersist]
}

export const PLAN_SESSION_KEYS = [
  'plan-messages',
  'plan-request',
  'plan-selected-places',
  'plan-dismissed-ids',
  'plan-route-places',
  'plan-start-date',
  'plan-start-time',
  'plan-trip-days',
  'plan-budget',
  'plan-city',
  'plan-additional-notes',
] as const

/** Clear all planning session data (call after trip is saved or explicitly reset). */
export function clearPlanningSession() {
  PLAN_SESSION_KEYS.forEach(k => {
    try { sessionStorage.removeItem(k) } catch { /* ignore */ }
  })
}
