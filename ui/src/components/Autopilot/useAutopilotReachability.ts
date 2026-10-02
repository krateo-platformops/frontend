/**
 * Autopilot AVAILABILITY — clickability, distinct from `enabled` (visibility). Moved verbatim out of
 * AutopilotProvider.tsx (which sits at its 500-line cap) so the provider has room for what it owns.
 *
 * The toggle grays out when EITHER
 *  (a) the installer marks Autopilot unavailable: config.api.AUTOPILOT_AVAILABLE === 'false' (set when
 *      agents are not deployed/licensed, features.coreAgents=false); OR
 *  (b) a runtime reachability probe of the endpoint fails (agent deployed but down/unreachable).
 * Echo/dev is always reachable. The probe re-runs when the endpoint changes and on window focus, so a
 * later-deployed or recovered agent flips the toggle live without a page reload.
 */
import { useEffect, useState } from 'react'

import { a2aAuthHeader } from './transport'

export const useAutopilotReachability = (enabled: boolean, useEcho: boolean, flagAvailable: boolean, endpoint: string | undefined): boolean => {
  const [probeOk, setProbeOk] = useState(true)
  useEffect(() => {
    if (!enabled || useEcho || !flagAvailable || !endpoint) {
      return
    }
    const ctrl = new AbortController()
    // GET the A2A base, carrying the Bearer the real turns carry: a 5xx gateway error means the
    // proxy could not reach the agent upstream (not deployed / down), and 401/403 mean this user
    // cannot drive the agent at all (invalid session, or agentgateway RBAC denies them this
    // agent) — both are a dead click. Any other response (200/404/405/…) means it answered.
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
  return enabled && flagAvailable && (useEcho || probeOk)
}
