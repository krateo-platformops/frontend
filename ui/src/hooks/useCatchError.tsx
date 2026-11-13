/**
 * The SIGNED-IN error reaction: errorNotice's classify-and-show, plus what a 401 means to someone
 * who has (or had) a session — the in-place session resume (utils/sessionResume), with no toast,
 * because the modal IS the message. Used by the sign-in pages (Auth, Login).
 *
 * The widget tree does not use it: a widget renders on public pages too, and there the session
 * resume, which falls through to forceLogout when no resume surface is mounted, must be
 * unreachable. Widgets show errors with hooks/errorNotice.tsx and take the 401 reaction from the
 * widget transport (`onUnauthorized`, `session`).
 */
import { useCallback } from 'react'

import { isSessionResumePending, raiseSessionExpired } from '../utils/sessionResume'

import { type CatchError, describeError, useErrorNotice } from './errorNotice'

export type { CatchError } from './errorNotice'

const useCatchError = () => {
  const { showError } = useErrorNotice()

  const catchError = useCallback((error?: CatchError, type: 'result' | 'notification' = 'notification') => {
    const { cause, unauthorized } = describeError(error)
    if (unauthorized) {
      // Session honesty: a 401 no longer hard-redirects to /login (which wiped all page/rail
      // state). Raise the single in-place session-resume modal instead; suppress the toast —
      // the modal IS the messaging, and a burst of concurrent 401s must not toast-storm.
      void raiseSessionExpired(cause)
      if (type === 'notification') {
        return
      }
    }
    // While a session-resume is pending, in-flight refetches keep failing against the stale token —
    // suppress the secondary error toasts so the resume modal isn't buried under a storm; inline
    // 'result' renders stay (they don't stack).
    return showError(error, type, { suppressed: isSessionResumePending })
  }, [showError])

  return { catchError }
}

export default useCatchError
