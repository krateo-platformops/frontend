/**
 * In-place session-resume coordination (Wave-1 session honesty).
 *
 * Before this module, ANY 401 from a widget/API fetch funneled into `forceLogout` — a hard
 * client-session wipe + redirect to /login that dumped the user out of the app and discarded
 * all page/rail state. Now an expired token raises ONE app-level "Session expired" modal
 * (components/SessionResume) that re-authenticates IN PLACE via the same authn basic flow the
 * Login page uses, then invalidates the react-query cache so the page resumes where it was.
 *
 * This module is the fetch-layer-facing half: a tiny module-level store + window CustomEvent
 * (the `openDrawer` precedent — widgets/Drawer/Drawer.tsx) so ANY fetch layer can raise the
 * modal without prop drilling, and a burst of concurrent 401s (every widget on a page failing
 * at once) coalesces into a single pending resume with a single modal.
 *
 * Deliberate scope: only the BASIC auth strategy resumes in place (it is what Login.tsx
 * implements as a credentials form). When no basic strategy is available — or no modal surface
 * is mounted at all (401 outside the Shell) — the flow falls back to the legacy `forceLogout`
 * path, which preserves the current route via `/login?next=`.
 */

import type { AuthFailureCause } from './authFailureCause'
import { forceLogout } from './logout'

export type SessionResumeOutcome = 'resumed' | 'logout'

/** Window CustomEvent the app-level modal listens for (single mount in Shell, like Drawer). */
export const SESSION_RESUME_EVENT = 'openSessionResume'

/**
 * Why the session failed, for the surface to present (snowplow#1029).
 *
 * Carried on the event's `detail` rather than read by the modal itself, because the discriminator
 * lives in the 401 RESPONSE BODY and only the fetch site has it. The modal never sees a Response.
 */
export const DEFAULT_CAUSE: AuthFailureCause = { action: 'reauthenticate', reason: null }

/** The cause of the pending resume, so a late-mounting surface can still read it. */
let pendingCause: AuthFailureCause = DEFAULT_CAUSE

/** The cause of the resume currently pending, or the default when none is. */
export const pendingSessionCause = (): AuthFailureCause => pendingCause

type PendingResume = {
  promise: Promise<SessionResumeOutcome>
  resolve: (outcome: SessionResumeOutcome) => void
}

/** The one pending resume — concurrent 401s coalesce onto it (exactly one modal). */
let pending: PendingResume | null = null

/** How many modal surfaces are mounted (0 outside the Shell → legacy fallback). */
let surfaces = 0

/**
 * Called by the SessionResumeModal on mount so `raiseSessionExpired` knows an in-place
 * resume surface exists. Returns the unregister cleanup for the unmount effect.
 */
export const registerSessionResumeSurface = (): (() => void) => {
  surfaces += 1
  return () => { surfaces -= 1 }
}

/**
 * Whether a session-resume is currently pending (modal up, or legacy fallback in flight).
 * Error-toast layers (useCatchError) consult this to suppress the storm of secondary
 * failures that in-flight refetches keep producing while the token is stale.
 */
export const isSessionResumePending = (): boolean => pending !== null

/**
 * Resolve the pending resume (called by the modal after a successful re-auth, or when the
 * user chooses to log out / the modal falls back). Safe to call with none pending.
 */
export const settleSessionResume = (outcome: SessionResumeOutcome): void => {
  const settled = pending
  pending = null
  pendingCause = DEFAULT_CAUSE
  settled?.resolve(outcome)
}

/**
 * Raise the "session expired" flow for a 401. Idempotent under bursts: while a resume is
 * pending every additional call returns the SAME promise and dispatches no further event,
 * so exactly one modal is shown for any number of concurrent 401s.
 *
 * When no modal surface is mounted (or there is no window at all), falls back to the legacy
 * `forceLogout` path and resolves 'logout' — old behavior, documented scope.
 */
export const raiseSessionExpired = (cause: AuthFailureCause = DEFAULT_CAUSE): Promise<SessionResumeOutcome> => {
  // A burst of concurrent 401s coalesces onto the FIRST one's cause. They come from the same
  // expired or under-privileged credential, so the first is representative — and re-presenting a
  // different cause mid-resume would change the surface under the person while they type.
  if (pending) { return pending.promise }
  pendingCause = cause

  let resolve!: (outcome: SessionResumeOutcome) => void
  const promise = new Promise<SessionResumeOutcome>((res) => { resolve = res })
  pending = { promise, resolve }

  if (typeof window === 'undefined' || surfaces === 0) {
    // No in-place surface to resume on → legacy behavior (forceLogout preserves the
    // route via /login?next= and offers its own re-authenticate/logout prompt).
    void forceLogout()
    settleSessionResume('logout')
    return promise
  }

  window.dispatchEvent(new CustomEvent(SESSION_RESUME_EVENT, { detail: cause }))
  return promise
}

/** Test-only: reset the module-level store so each test starts clean. */
export const __resetSessionResume = (): void => {
  pending = null
  pendingCause = DEFAULT_CAUSE
  surfaces = 0
}
