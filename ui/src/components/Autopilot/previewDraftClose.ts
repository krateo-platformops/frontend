/**
 * "Discard this draft" — a surface asking the provider to drop the held draft for real.
 *
 * WHY THIS EXISTS. The composer's Close draft asked "Discard this draft? The sandbox and its
 * unpublished files are deleted." and then cleared only its OWN view: the held draft lived on in the
 * provider's store. Two consequences, both silent. The files were not deleted — they were still
 * publishable. And every later "Start a page" was refused, because a draft start is refused while a
 * draft is held (seeding over one would discard unpublished work) — so after a "discard", starting a
 * new page did nothing at all for the rest of the session.
 *
 * Same idiom as the undo bus and for the same reason: the held draft lives in the provider, the
 * surfaces that author it hold none of it. The request carries nothing; WHICH draft is the store's
 * business, and a caller that named one could name one that has since been replaced.
 */

export const AUTOPILOT_PREVIEW_DRAFT_CLOSE_EVENT = 'autopilotPreviewDraftClose'

/** Ask for the held draft to be discarded. A no-op when nothing is held. */
export const emitDraftClose = (): void => {
  window.dispatchEvent(new CustomEvent(AUTOPILOT_PREVIEW_DRAFT_CLOSE_EVENT))
}

/** Subscribe. Returns the unsubscribe fn (React effect cleanup). */
export const onDraftClose = (handler: () => void): (() => void) => {
  const listener = (): void => { handler() }
  window.addEventListener(AUTOPILOT_PREVIEW_DRAFT_CLOSE_EVENT, listener)
  return () => window.removeEventListener(AUTOPILOT_PREVIEW_DRAFT_CLOSE_EVENT, listener)
}
