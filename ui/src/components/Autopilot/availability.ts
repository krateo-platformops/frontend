/**
 * Whether this user can actually drive the configured agent right now — CLICKABILITY, as distinct
 * from `enabled`, which is only whether Autopilot is configured at all and governs visibility.
 *
 * Two witnesses, in increasing order of authority:
 *
 * THE PROBE — a GET of the A2A base carrying the Bearer the real turns carry. 401/403 mean this
 * user cannot drive the agent at all (invalid session, or agentgateway RBAC denies them this
 * agent); 502-504 mean the proxy could not reach the agent upstream (not deployed, or down). Both
 * are a dead click. Anything else (200/404/405/…) means it answered. It starts UNANSWERED, and an
 * unanswered probe is not reachable: seeding it `true` made every control live for the whole first
 * round-trip of every page load, which is precisely the first-login window the dead clicks were
 * reported from. Being briefly disabled while we find out is the honest direction to be wrong in.
 *
 * THE TURN — `markUnavailable`, called when a real turn comes back 401/403. A gateway that answers
 * a bare GET while denying the actual turn reads as reachable to the probe, and stays that way for
 * every later click. The turn is authoritative because it IS the request rather than a guess about
 * one, and learning from it closes that gap WITHOUT making the probe stricter — which would have
 * disabled installs whose gateway legitimately 404s a bare GET.
 *
 * The probe re-runs when the endpoint changes and on window focus, so an agent deployed or
 * recovered later re-enables the rail without a page reload.
 */
import { useCallback, useEffect, useState } from 'react'

import { a2aAuthHeader } from './transport'

interface AvailabilityInput {
  /** Autopilot is configured at all: an endpoint is present, or dev echo is on. */
  enabled: boolean
  endpoint: string | undefined
  /** The installer's AUTOPILOT_AVAILABLE flag: a hard "not deployed / not licensed" off switch. */
  flagAvailable: boolean
  /** Dev/demo echo transport — there is no agent to reach, so it is always reachable. */
  useEcho: boolean
}

export interface Availability {
  /** Record that a real turn was refused for this user (401/403). Stable across renders. */
  markUnavailable: () => void
  /** What the rail consumes to decide whether its controls are live. */
  reachable: boolean
}

export const useAutopilotAvailability = ({ enabled, endpoint, flagAvailable, useEcho }: AvailabilityInput): Availability => {
  const [probeOk, setProbeOk] = useState<boolean | null>(null)
  useEffect(() => {
    if (!enabled || useEcho || !flagAvailable || !endpoint) {
      return
    }
    const ctrl = new AbortController()
    const probe = () => {
      fetch(`${endpoint.replace(/\/$/, '')}/`, { headers: a2aAuthHeader(), method: 'GET', signal: ctrl.signal })
        .then((res) => setProbeOk(res.status !== 401 && res.status !== 403 && (res.status < 502 || res.status > 504)))
        .catch(() => {
          if (!ctrl.signal.aborted) {
            setProbeOk(false)
          }
        })
    }
    probe()
    window.addEventListener('focus', probe)
    return () => {
      ctrl.abort()
      window.removeEventListener('focus', probe)
    }
  }, [enabled, useEcho, flagAvailable, endpoint])

  const markUnavailable = useCallback(() => setProbeOk(false), [])
  return { markUnavailable, reachable: enabled && flagAvailable && (useEcho || probeOk === true) }
}
