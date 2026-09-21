/**
 * "Put it back" — the composer asking the provider to restore the previous draft.
 *
 * Same idiom as the add/edit/remove buses and for the same reason: the held draft lives in the
 * provider, the surfaces that author are pure and hold none of it. This one carries no payload at
 * all, because WHICH tree to go back to is the history's business and not the caller's — a surface
 * that named a snapshot could name one belonging to a draft that has since been replaced.
 */

export const AUTOPILOT_PREVIEW_DRAFT_UNDO_EVENT = 'autopilotPreviewDraftUndo'

/** Ask for one step back. A no-op when there is nothing to undo. */
export const emitDraftUndo = (): void => {
  window.dispatchEvent(new CustomEvent(AUTOPILOT_PREVIEW_DRAFT_UNDO_EVENT))
}

/** Subscribe. Returns the unsubscribe fn (React effect cleanup). */
export const onDraftUndo = (handler: () => void): (() => void) => {
  const listener = (): void => { handler() }
  window.addEventListener(AUTOPILOT_PREVIEW_DRAFT_UNDO_EVENT, listener)
  return () => window.removeEventListener(AUTOPILOT_PREVIEW_DRAFT_UNDO_EVENT, listener)
}
