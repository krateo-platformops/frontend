/**
 * A preview for a page draft the composer never saw proposed.
 *
 * The composer adopts a page's preview from the preview bus, and only while it is mounted. A draft
 * started or proposed BEFORE it mounted reaches it by replay — files, no payload — and the composer
 * used to answer that with "No draft open" and a Start button the provider silently refused, because
 * a draft was held. So it said the one thing that was false, and offered the one action that could
 * not work, with no way to discard what was actually there.
 *
 * Built from the held files, source-only: no live render is attached to THIS view. The next apply —
 * the start's own, or the re-apply after an edit — brings one, and this view adopts it. (It is also
 * what a just-started page shows while its first apply is on the wire, so the caption claims no
 * history.)
 */
import { pageDisplayName, pageDraftWidgets } from '../../components/Autopilot/pageDraft'
import { buildPagePreviewPayload } from '../../components/Autopilot/previewBridge'
import type { AutopilotPreviewPayload } from '../../components/Autopilot/previewBus'

export const HELD_PAGE_CAPTION = 'The held draft, shown from its files — its live render appears here when it is next applied.'

export const heldPagePayload = (files: Record<string, string>): AutopilotPreviewPayload | null => {
  if (!Object.keys(files).length) {
    return null
  }
  return { ...buildPagePreviewPayload(pageDraftWidgets(files)), caption: HELD_PAGE_CAPTION, title: pageDisplayName(files) }
}
