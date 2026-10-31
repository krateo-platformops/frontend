/**
 * What the session-resume surface says and offers for each 401 outcome (snowplow#1029).
 *
 * Split out from the modal so the decision that matters — whether to offer a sign-in form at all —
 * is a pure function with its own tests, rather than a conditional buried in JSX.
 */
import type { AuthFailureCause } from './authFailureCause'

export interface AuthFailurePresentation {
  /** The body copy. Says what happened and what they can do, never "please try later". */
  description: string
  /**
   * Whether to render the authentication form.
   *
   * `false` for a configuration fault, and that is the whole point of this module: the cluster
   * cannot issue the credential the resource needs, so a sign-in form would be an action that
   * cannot succeed. Offering it loops the person through re-authentication forever while the real
   * fault — a cluster setting — reaches nobody.
   */
  showAuthForm: boolean
  /** The heading. */
  title: string
}

export const authFailurePresentation = (cause: AuthFailureCause): AuthFailurePresentation => {
  switch (cause.action) {
    case 'configuration-fault':
      return {
        description: 'This resource requires elevated authentication, but it is not set up on this cluster. Signing in again will not help. Ask an administrator to configure step-up authentication.',
        showAuthForm: false,
        title: 'Elevated access is not configured',
      }
    case 'server-fault':
      return {
        description: 'The server could not issue the credential this resource needs. This is not a problem with your account. Try again in a moment; if it keeps happening, report it to an administrator.',
        showAuthForm: false,
        title: 'Could not verify your access',
      }
    case 'step-up':
      return {
        description: 'This resource needs additional verification. Sign in again to confirm your identity and continue where you left off.',
        showAuthForm: true,
        title: 'Additional verification required',
      }
    default:
      return {
        description: 'Your session has expired. Sign in to continue right where you left off.',
        showAuthForm: true,
        title: 'Session expired',
      }
  }
}
