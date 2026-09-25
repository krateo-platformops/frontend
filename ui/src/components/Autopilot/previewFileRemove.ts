/**
 * The REMOVE counterpart of previewFileAdd: how a surface tells the provider a file the draft holds
 * should stop existing.
 *
 * WHY THIS HAD TO EXIST AT ALL. "Remove" in the object tree rewrote only the PARENT — it deleted
 * the reference and left the child's file in the held draft. `buildObjectTree` then saw a file
 * nothing referenced and drew it as a page ROOT, so the thing the person had just removed reappeared
 * on the canvas beside their page. It had no `parentPath`, so the tree rendered no action buttons on
 * it and there was no Remove to press a second time; and a publish commits every held key, so the
 * orphan shipped in the change request. Three surfaces, one missing verb.
 *
 * NOT A FLAG ON THE ADD BUS, for the reason previewFileAdd gives about not being a flag on the edit
 * bus: an add carries bytes and a remove carries none, the provider answers them with different
 * store calls, and a discriminator would put a branch in one handler whose arms share nothing.
 *
 * DELETION IS UNRECOVERABLE HERE — there is no undo anywhere in the composer. The surface confirms
 * before emitting; this bus does not, because a bus that asked would be a bus that could not be
 * used by anything else.
 *
 * Pure module: one event name, a dispatch/subscribe pair. No React, no module state.
 */

export const AUTOPILOT_PREVIEW_FILE_REMOVE_EVENT = 'autopilotPreviewFileRemoved'

/** A file the composer no longer wants held. Addressed by the key the draft holds it under. */
export interface FileRemoveDetail {
  path: string
}

/** Emit a file to drop from the held draft. */
export const emitFileRemove = (detail: FileRemoveDetail): void => {
  window.dispatchEvent(new CustomEvent<FileRemoveDetail>(AUTOPILOT_PREVIEW_FILE_REMOVE_EVENT, { detail }))
}

/** Subscribe to removals. Returns the unsubscribe fn (React effect cleanup). */
export const onFileRemove = (handler: (detail: FileRemoveDetail) => void): (() => void) => {
  const listener = (event: Event): void => {
    const { detail } = event as CustomEvent<FileRemoveDetail>
    if (detail && typeof detail.path === 'string' && detail.path) {
      handler(detail)
    }
  }
  window.addEventListener(AUTOPILOT_PREVIEW_FILE_REMOVE_EVENT, listener)
  return () => window.removeEventListener(AUTOPILOT_PREVIEW_FILE_REMOVE_EVENT, listener)
}
