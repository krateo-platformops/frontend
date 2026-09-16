/**
 * "Start a draft" — a person creating one, on the same bus an agent proposes one.
 *
 * WHY A THIRD BUS AND NOT A FLAG ON AN EXISTING ONE. The edit bus means "new bytes for a file you
 * already hold"; the add bus means "a file the draft does not hold yet". Both presuppose a draft.
 * Starting one presupposes the opposite — there must be NO held draft, or a half-finished page is
 * silently discarded — so folding it into either would be a handler whose arms share nothing and
 * whose preconditions contradict.
 *
 * WHAT THE SUBSCRIBER DOES WITH IT. Exactly what a proposed page does: `recordPagePreview`, which
 * serializes the CRs into the held `{path: yaml}` map and arms the publish gate for that identity.
 * Passing the raw CR objects rather than YAML is what keeps that true — one seeding path, so a
 * human-started draft and an agent-proposed one are indistinguishable downstream, and the publish
 * rules cannot come to disagree about which is which.
 */

export const AUTOPILOT_DRAFT_START_EVENT = 'autopilotDraftStart'

export interface DraftStartDetail {
  /** The seed CRs, root first. Raw objects — the subscriber owns serialization. */
  widgets: Record<string, unknown>[]
  /** Drawer/page title for the resulting preview payload. */
  title: string
}

/** Ask the provider to hold this as the new draft. Refused upstream if one is already open. */
export const emitDraftStart = (detail: DraftStartDetail): void => {
  window.dispatchEvent(new CustomEvent<DraftStartDetail>(AUTOPILOT_DRAFT_START_EVENT, { detail }))
}

/** Provider side. Returns the unsubscribe fn. */
export const onDraftStart = (handler: (detail: DraftStartDetail) => void): (() => void) => {
  const listener = (event: Event): void => {
    const { detail } = event as CustomEvent<DraftStartDetail>
    if (detail && Array.isArray(detail.widgets) && detail.widgets.length > 0) {
      handler(detail)
    }
  }
  window.addEventListener(AUTOPILOT_DRAFT_START_EVENT, listener)
  return () => window.removeEventListener(AUTOPILOT_DRAFT_START_EVENT, listener)
}
