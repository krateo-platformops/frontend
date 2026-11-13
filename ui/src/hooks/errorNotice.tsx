/**
 * Telling a person an error happened — the part of error handling that is the SAME on every page:
 * classify the failure (what it was, in words) and show it, as a toast or an inline Result.
 *
 * It imports nothing session-related, on purpose. What to DO about a 401 — raise the in-place
 * session resume, which with no resume surface mounted falls through to forceLogout — is not this
 * module's to decide: a public page (public/PublicPage.tsx) has no session, and a reaction that
 * clears the stored session and leaves for /login must be unreachable from it, not merely unused.
 * The signed-in reactions live in hooks/useCatchError.tsx (the sign-in pages, Auth and Login) and on
 * the widget transport's `session` / `onUnauthorized` (the widget tree), and come in here only as
 * the `suppressed` predicate.
 */
import { App, Result } from 'antd'
import { type ReactNode, useCallback } from 'react'

import { type AuthFailureCause, authFailureCauseOf } from '../utils/authFailureCause'
import { authFailurePresentation } from '../utils/authFailureCopy'

export interface CatchError {
  name?: string
  data?: {
    /**
     * The k8s Status `details`. Carried so a 401 can be classified (snowplow#1029): the step-up
     * discriminator is `details.causes[0].reason`, and this hook receives an error OBJECT with no
     * `Response` on it, so a `WWW-Authenticate` header is unreachable here — the body is the only
     * place the portal can read it app-wide.
     */
    details?: {
      causes?: { reason?: unknown }[]
    }
    message?: string
  }
  /**
   * What to show under `message`, from a caller that has ALREADY classified the failure. When set,
   * it is shown as given, and the status-based defaults below stay out of the way: the 4xx line
   * "Please check your input or permissions." and the 500 branch's replacement of `message` as well.
   * Those defaults are right for a caller that knows only a status, and wrong beside copy that
   * already says what happened — the sign-in callback put "Please check your input" under "your
   * account is not allowed into this control plane", on a page with no input.
   *
   * Not honoured on a 401, whose surface is the session-resume modal rather than this text.
   */
  description?: string
  message?: string
  status?: number
  code?: number
}

/** What an error says, and whether it is a 401 (whose reaction the CALLER owns, with its cause). */
export interface DescribedError {
  message: string
  description: ReactNode
  /** A 401: the caller decides the reaction (see the module header); `cause` classifies it. */
  unauthorized: boolean
  cause?: AuthFailureCause
}

export const describeError = (error?: CatchError): DescribedError => {
  // P16: this pair is the app-wide default for any unrecognised error — every data-fetching
  // widget, Auth and Login reach it — so it is the string users hit most. It used to apologise
  // ("Ops! Something didn't work" / "please try later"), which names nothing and asks the reader
  // to wait for a condition nobody described. Say what failed and what they can do instead.
  let message: string = error?.message || 'The request did not complete'
  let description: ReactNode = 'Try again. If it keeps happening, check your connection and permissions for this resource.'

  if ((error?.status === 401 || error?.code === 401)) {
    // The cause decides what a resume surface offers, and what an inline Result says. A cluster
    // that cannot issue the elevated credential gets no sign-in form at all.
    const cause = authFailureCauseOf(error?.data)
    description = error?.data?.message || authFailurePresentation(cause).description
    return { cause, description, message, unauthorized: true }
  }
  if (error?.description !== undefined) {
    description = error.description
  } else if (error?.status === 500 || error?.code === 500) {
    message = 'The server hit an unexpected error'
    description = error?.data?.message || 'The server encountered an unexpected condition.'
  } else if ((/^4\d{2}$/).test(String(error?.status)) || (/^4\d{2}$/).test(String(error?.code))) {
    if (error?.data?.message) {
      message = 'There was an error processing your request'
    }
    description = error?.data?.message || 'Please check your input or permissions.'
  }
  return { description, message, unauthorized: false }
}

export interface ShowErrorOptions {
  /**
   * When true, a TOAST is not shown (an inline Result still is: it does not stack). The signed-in
   * callers pass "a session resume is pending": in-flight refetches keep failing against the stale
   * token, and the resume modal must not be buried under the storm.
   */
  suppressed?: () => boolean
}

export const useErrorNotice = () => {
  const { notification } = App.useApp()

  const showError = useCallback((error?: CatchError, type: 'result' | 'notification' = 'notification', options: ShowErrorOptions = {}) => {
    const { description, message } = describeError(error)

    switch (type) {
      case 'result':
        return <Result status='error' subTitle={description} title={message} />
      case 'notification':
      default:
        if (options.suppressed?.()) {
          return
        }
        notification.error({
          description,
          duration: 4,
          key: 'unique',
          message,
        })
    }
  }, [notification])

  return { showError }
}
