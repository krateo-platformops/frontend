/**
 * FE-K(edit), page/blueprint half — the PER-FILE PREVIEW-EDIT BUS: the tiny, pure seam by
 * which the preview DRAWER (previewSurface.tsx "Files" tab) hands an ACCEPTED single-file
 * edit back to the AutopilotProvider, which writes it into the held draft tree
 * (blueprintDraftStore.updateFile) and re-arms the page/blueprint preview gate.
 *
 * WHY A BUS (not a payload callback): this mirrors previewEditBus.ts exactly. The held-draft
 * store + the gate live in the provider; the preview payload is built by the PURE previewPage /
 * previewBlueprint handlers (previewHandlers/previewBridge), which hold no store/gate reference.
 * Rather than thread a live callback through the payload from a place that cannot supply one, the
 * drawer emits the accepted `{path, content}` on a window CustomEvent and the provider subscribes —
 * the SAME idiom previewBus.ts uses to open the drawer from a pure verb, and previewEditBus.ts uses
 * for the RestDefinition edit.
 *
 * THE "HELD-IN-PORTAL, NEVER RETYPED BY THE MODEL" GUARANTEE IS PRESERVED. The edited content is
 * plain text a HUMAN produced by editing the held file in the drawer; it never round-trips the model.
 * The drawer parses/validates it once (deny-by-default: an invalid edit is never emitted), and the
 * provider's updateFile re-checks the cap/held-path once more, so the bytes that publish (the claim
 * carries the held files verbatim) are exactly the human-edited bytes.
 *
 * Pure module: one CustomEvent name + a dispatch/subscribe pair. No React, no module state.
 */

import type { DraftKind } from './blueprintDraftStore'

export const AUTOPILOT_PREVIEW_FILE_EDIT_EVENT = 'autopilotPreviewFileEdited'

/** The detail an accepted per-file drawer edit carries: which held file, and its new bytes. */
export interface FileEditDetail {
  path: string
  content: string
  /**
   * WHICH KIND of draft the edited preview showed. A page set holds Chart.yaml, values.yaml and
   * values.schema.json under the same names a chart does, so a path alone cannot tell the provider
   * that an edit made in a chart's preview is about to land in a held PAGE. With this it can refuse.
   * Optional so an emitter that predates it keeps working; the drawer and the composer both send it.
   */
  kind?: DraftKind
}

/** Emit an accepted per-file edit — the provider writes it into the held draft + re-arms the gate. */
export const emitFileEdit = (detail: FileEditDetail): void => {
  window.dispatchEvent(new CustomEvent<FileEditDetail>(AUTOPILOT_PREVIEW_FILE_EDIT_EVENT, { detail }))
}

/** Subscribe to accepted per-file edits. Returns the unsubscribe fn (React effect cleanup). */
export const onFileEdit = (handler: (detail: FileEditDetail) => void): (() => void) => {
  const listener = (event: Event): void => {
    const { detail } = event as CustomEvent<FileEditDetail>
    if (detail && typeof detail.path === 'string' && detail.path && typeof detail.content === 'string') {
      handler(detail)
    }
  }
  window.addEventListener(AUTOPILOT_PREVIEW_FILE_EDIT_EVENT, listener)
  return () => window.removeEventListener(AUTOPILOT_PREVIEW_FILE_EDIT_EVENT, listener)
}
