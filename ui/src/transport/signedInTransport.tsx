/**
 * The SIGNED-IN widget transport — the only module in the widget path that reads the stored token.
 *
 * Its requests are byte-for-byte what each call site used to send by itself: the caller's own
 * headers with `Authorization: Bearer <token>` added, and on a 401 the in-place session resume
 * (components/SessionResume) with the cause snowplow named. `getAccessToken()` throws when no
 * session is stored, and so does `fetch`, synchronously — the same failure each call site had.
 *
 * Provided by the signed-in shell (components/Shell) and nowhere else, so everything outside it —
 * a public page above all — falls through to the anonymous default (transport/widgetTransport.ts).
 */
import { useEffect, type ReactNode } from 'react'

import { subscribeSse } from '../hooks/sseClient'
import { holdTelemetryCredential } from '../otel/telemetryCredential'
import { authFailureCauseOf } from '../utils/authFailureCause'
import { getAccessToken } from '../utils/getAccessToken'
import { raiseSessionExpired } from '../utils/sessionResume'

import { type TransportInit, type WidgetTransport, WidgetTransportProvider } from './widgetTransport'

export const signedInTransport: WidgetTransport = {
  fetch: (url: string, init: TransportInit = {}) => fetch(url, {
    ...init,
    headers: { ...init.headers, Authorization: `Bearer ${getAccessToken()}` },
  }),
  identity: 'signed-in',
  live: true,
  onUnauthorized: (body: unknown) => {
    // Expired/invalid token → the IN-PLACE session-resume modal rather than a hard wipe to /login.
    // Concurrent 401s coalesce into one pending resume; a successful re-auth invalidates every
    // query, so the widget that failed refetches with the fresh token. The cause decides what the
    // surface offers: a step-up prompt, a fresh sign-in, or no form (snowplow#1029).
    void raiseSessionExpired(authFailureCauseOf(body))
  },
  session: { getAccessToken, subscribeSse },
  writes: true,
}

/**
 * The signed-in transport for everything below it, and the telemetry credential for as long as it
 * is mounted (otel/telemetryCredential.ts).
 */
export const SignedInTransportProvider = ({ children }: { children: ReactNode }) => {
  useEffect(() => holdTelemetryCredential(getAccessToken), [])
  return <WidgetTransportProvider value={signedInTransport}>{children}</WidgetTransportProvider>
}
