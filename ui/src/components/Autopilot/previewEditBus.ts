/**
 * FE-K(edit) — the PREVIEW-EDIT BUS: the tiny, pure seam by which the preview DRAWER
 * (previewSurface.tsx) hands an ACCEPTED edited RestDefinition draft back to the
 * AutopilotProvider, which re-arms the thread-scoped preview gate with the edited bytes.
 *
 * WHY A BUS (not a payload callback): the gate lives in the provider; the preview payload is
 * built by the PURE previewRestDef handler (previewHandlers/previewBridge), which has no gate
 * reference. Rather than thread a live callback through the payload from a place that cannot
 * supply one, the drawer emits the edited draft on a window CustomEvent and the provider
 * subscribes — the EXACT idiom previewBus.ts already uses to open the drawer from a pure verb.
 *
 * THE "HELD-IN-PORTAL, NEVER RETYPED BY THE MODEL" GUARANTEE IS PRESERVED. The edited draft is a
 * plain object the HUMAN produced by editing the held YAML in the drawer; it never round-trips the
 * model. The provider validates it once more (deny-by-default: an invalid edit arms nothing) before
 * the gate records it, so the published bytes are exactly the human-edited bytes.
 *
 * Pure module: one CustomEvent name + a dispatch/subscribe pair. No React, no module state.
 */

export const AUTOPILOT_PREVIEW_EDIT_EVENT = 'autopilotPreviewRestDefEdited'

/** The detail an accepted drawer edit carries: the edited RestDefinition draft object. */
export interface RestDefEditDetail {
  draft: Record<string, unknown>
}

/** Emit an accepted RestDefinition edit — the provider records it into the preview gate. */
export const emitRestDefEdit = (draft: Record<string, unknown>): void => {
  window.dispatchEvent(new CustomEvent<RestDefEditDetail>(AUTOPILOT_PREVIEW_EDIT_EVENT, { detail: { draft } }))
}

/** Subscribe to accepted RestDefinition edits. Returns the unsubscribe fn (React effect cleanup). */
export const onRestDefEdit = (handler: (detail: RestDefEditDetail) => void): (() => void) => {
  const listener = (event: Event): void => {
    const { detail } = event as CustomEvent<RestDefEditDetail>
    if (detail?.draft && typeof detail.draft === 'object') {
      handler(detail)
    }
  }
  window.addEventListener(AUTOPILOT_PREVIEW_EDIT_EVENT, listener)
  return () => window.removeEventListener(AUTOPILOT_PREVIEW_EDIT_EVENT, listener)
}
