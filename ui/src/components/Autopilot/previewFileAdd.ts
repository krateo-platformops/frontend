/**
 * The ADD counterpart of previewFileEdit: how a surface hands the provider a file the draft does
 * not hold yet.
 *
 * WHY A SECOND BUS AND NOT A FLAG ON THE FIRST. `previewFileEdit` means "these are the new bytes of
 * a file you already hold", and the provider answers it with `updateDisplayedFile`, which resolves
 * a displayed repo path back to the held key. An addition has neither property: there is no held
 * key to resolve and no previous content to replace. Overloading one event with a discriminator
 * would put a branch in the provider's handler whose two arms share nothing, and would let an
 * `add` that should have been refused fall through the `edit` path by mistake.
 *
 * SAME IDIOM, SAME GUARANTEE. Like previewFileEdit and previewEditBus, this is a window
 * CustomEvent, because the held draft and the preview gate live in the provider while the surfaces
 * that author are pure and hold neither. The bytes are produced by a HUMAN acting in the composer —
 * placing a container, authoring a widget — and never round-trip the model. The provider re-checks
 * the path and the 512 KiB cap in `addFile` before anything is held, so a refusal is a refusal.
 *
 * Pure module: one event name, a dispatch/subscribe pair. No React, no module state.
 */

export const AUTOPILOT_PREVIEW_FILE_ADD_EVENT = 'autopilotPreviewFileAdded'

/** A file the composer created: where it belongs in the repo, and its bytes. */
export interface FileAddDetail {
  path: string
  content: string
}

/** Emit a newly authored file — the provider adds it to the held draft and re-arms the gate. */
export const emitFileAdd = (detail: FileAddDetail): void => {
  window.dispatchEvent(new CustomEvent<FileAddDetail>(AUTOPILOT_PREVIEW_FILE_ADD_EVENT, { detail }))
}

/** Subscribe to newly authored files. Returns the unsubscribe fn (React effect cleanup). */
export const onFileAdd = (handler: (detail: FileAddDetail) => void): (() => void) => {
  const listener = (event: Event): void => {
    const { detail } = event as CustomEvent<FileAddDetail>
    if (detail && typeof detail.path === 'string' && detail.path && typeof detail.content === 'string') {
      handler(detail)
    }
  }
  window.addEventListener(AUTOPILOT_PREVIEW_FILE_ADD_EVENT, listener)
  return () => window.removeEventListener(AUTOPILOT_PREVIEW_FILE_ADD_EVENT, listener)
}
