/**
 * MICROPHONE PERMISSION — the three-state watcher behind the control's `blocked` state.
 * Voice spec FR 16–20.
 *
 * WHY A WATCHER AND NOT A CHECK AT PRESS TIME. `denied` is the one failure the user can
 * fix themselves, and the fix is outside the page (the address-bar lock icon). A control
 * that looks ready and then does nothing — because a permanently denied permission makes
 * `getUserMedia` reject WITHOUT showing a prompt — teaches people the feature is broken.
 * So a denied permission is rendered as denied BEFORE it is pressed, with the instruction
 * attached, and the watcher flips it back live the moment the user allows it in the
 * browser: no reload, no second press, including a revocation that lands MID-RECORDING.
 *
 * WHY EVERY ACCESS IS WRAPPED. `navigator.permissions.query({name: 'microphone'})` is not
 * universally implemented — Safari throws on the descriptor rather than returning
 * `'prompt'`, and some embedded webviews have no `permissions` at all. Every one of those
 * means "we do not know", and the only safe reading of "we do not know" is `prompt`: the
 * control stays usable and the browser's own prompt settles it. Guessing `denied` would
 * disable dictation on Safari for no reason; guessing `granted` would claim an
 * authorisation nobody gave.
 */

/** The three states the control renders from. `prompt` is also the "we don't know" value. */
export type MicrophonePermission = 'denied' | 'granted' | 'prompt'

/** The slice of `PermissionStatus` this module reads (so a test can hand in a fake). */
export interface PermissionStatusLike {
  addEventListener?: (type: 'change', listener: () => void) => void
  onchange?: (() => void) | null
  removeEventListener?: (type: 'change', listener: () => void) => void
  state: string
}

/** The slice of `navigator` this module reads. */
export interface PermissionsNavigatorLike {
  permissions?: {
    query?: (descriptor: { name: string }) => Promise<PermissionStatusLike>
  }
}

const asPermission = (state: string): MicrophonePermission =>
  (state === 'granted' || state === 'denied' ? state : 'prompt')

/**
 * Subscribe to the microphone permission. Calls `onChange` once with the current value as
 * soon as it is known, then on every subsequent change. Returns an unsubscribe that is
 * safe to call before the query has even resolved (the late result is dropped).
 *
 * Never throws and never rejects: an unsupported browser simply never moves off `prompt`.
 */
export const watchMicrophonePermission = (
  onChange: (permission: MicrophonePermission) => void,
  navigatorLike: PermissionsNavigatorLike = globalThis.navigator as PermissionsNavigatorLike,
): (() => void) => {
  let disposed = false
  let detach: (() => void) | null = null

  const query = navigatorLike?.permissions?.query
  if (typeof query !== 'function') {
    return () => { disposed = true }
  }

  // The descriptor itself is what Safari throws on, so the CALL is inside the try as well
  // as the promise — a synchronous throw here must not take the rail down with it.
  try {
    void query.call(navigatorLike.permissions, { name: 'microphone' })
      .then((status) => {
        if (disposed) {
          return
        }
        const emit = () => onChange(asPermission(status.state))
        emit()
        if (typeof status.addEventListener === 'function') {
          status.addEventListener('change', emit)
          detach = () => status.removeEventListener?.('change', emit)
        } else {
          status.onchange = emit
          detach = () => { status.onchange = null }
        }
      })
      .catch(() => {
        // Unsupported descriptor (Safari) → we do not know → `prompt`, which is the
        // initial value the store already holds. Nothing to do but not crash.
      })
  } catch {
    // Same as above, for the browsers that throw synchronously.
  }

  return () => {
    disposed = true
    detach?.()
    detach = null
  }
}

/** FR 18: the instruction attached to the denied control, since the fix is not in the page. */
export const MICROPHONE_BLOCKED_HINT
  = 'Microphone access is blocked for this site. Allow it from the lock icon in the address bar, then try again.'
