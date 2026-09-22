/**
 * "The sandbox now holds something different" — announced once, per apply.
 *
 * WHY A BUS AND NOT A DIRECT CALL. The apply happens in the Autopilot provider, which is mounted
 * outside React Query's provider in several test trees; calling `useQueryClient` there throws for
 * every one of them. The thing that must react — the widget cache — belongs to the app shell. So
 * the apply announces, and the shell listens.
 *
 * WHY ANYTHING MUST REACT AT ALL. Applying drafts changes what the sandbox SERVES; it does not
 * change the URL the rendered pane FETCHES. Widget queries are keyed `['widgets', endpoint,
 * extras]` — on exactly that URL — so every re-apply was answered from cache. Measured on a live
 * cluster: the sandbox served a Table with `dataSource: 23` while the pane beside it showed zero
 * rows, and still showed zero at +10s, +20s and +30s. Past the 30s staleTime, because going stale
 * is not the same as fetching: nothing was wrong with the data, and nobody asked for it again.
 */
const PREVIEW_APPLIED_EVENT = 'krateoPreviewApplied'

/** Announce that a preview apply has landed and the sandbox's contents have changed. */
export const emitPreviewApplied = (): void => {
  window.dispatchEvent(new CustomEvent(PREVIEW_APPLIED_EVENT))
}

/** Subscribe. Returns the unsubscribe, so a caller can hand it straight back from an effect. */
export const onPreviewApplied = (handler: () => void): (() => void) => {
  const listener = () => handler()
  window.addEventListener(PREVIEW_APPLIED_EVENT, listener)

  return () => window.removeEventListener(PREVIEW_APPLIED_EVENT, listener)
}
