/**
 * The held draft, broadcast after every accepted write.
 *
 * WHY THIS EXISTS. The preview payload is built ONCE, by a model-driven verb, and handed to the
 * surfaces. That is fine for a drawer that only displays, and wrong for a surface that EDITS: the
 * page composer read its file bytes out of that payload, so every structural edit was computed
 * from the bytes as they were when the draft was first previewed. Two edits to the same parent and
 * the second silently overwrote the first, because both started from the same original.
 *
 * The store is the source of truth and it lives in the provider. Rather than give every surface a
 * store reference — which is the coupling the whole composer split exists to avoid — the provider
 * broadcasts the held files after each accepted write, and a surface that edits re-reads from that.
 *
 * KEYS ARE HELD KEYS, NOT DISPLAYED PATHS. A page draft is held under bare identity tokens
 * (`flex.page-x.yaml`); `pagePublishPath` prefixes the chart root at publish and the Files tab
 * displays the same routed path. Broadcasting the held map verbatim keeps one vocabulary on this
 * bus — a surface that wants the repo path routes it, and a surface that wants to WRITE uses the
 * key it was given, which is what stops a path being prefixed twice.
 *
 * Pure module: one event name, a dispatch/subscribe pair. No React, no module state.
 */

import type { DraftKind } from './blueprintDraftStore'

export const AUTOPILOT_DRAFT_CHANGED_EVENT = 'autopilotDraftChanged'

/**
 * The whole held tree after a write: held key -> bytes — and WHICH BUILDER holds it.
 *
 * `kind` because a surface that edits pages must not run its object tree over a Helm chart: with a
 * blueprint draft held, navigating to /portal-builder/compose drew nonsense from chart files. The
 * store already knows who wrote the draft; the broadcast now says so, and a surface parks a draft
 * that is not its kind behind an honest empty state. Absent (a legacy emitter, a test harness) it
 * reads as a page, which is what every emitter was before this field existed. `null` means no
 * draft is held at all.
 *
 * `problems` because a blueprint edit is not verdicted by the drawer the way a page edit is: a hand
 * edit that puts a populated object default into values.schema.json used to re-arm the publish
 * gate with no lint at all. The provider lints on every broadcast and every surface sees the same
 * list; an empty list on a blueprint draft means it is clean.
 */
export interface DraftChangedDetail {
  files: Record<string, string>
  kind?: DraftKind | null
  problems?: string[]
}

/** Broadcast the held draft. Called by the provider after an accepted edit or add. */
export const emitDraftChanged = (detail: DraftChangedDetail): void => {
  window.dispatchEvent(new CustomEvent<DraftChangedDetail>(AUTOPILOT_DRAFT_CHANGED_EVENT, { detail }))
}

/** Subscribe to held-draft changes. Returns the unsubscribe fn (React effect cleanup). */
export const onDraftChanged = (handler: (detail: DraftChangedDetail) => void): (() => void) => {
  const listener = (event: Event): void => {
    const { detail } = event as CustomEvent<DraftChangedDetail>
    if (detail && typeof detail.files === 'object' && detail.files !== null) {
      handler(detail)
    }
  }
  window.addEventListener(AUTOPILOT_DRAFT_CHANGED_EVENT, listener)
  return () => window.removeEventListener(AUTOPILOT_DRAFT_CHANGED_EVENT, listener)
}

/**
 * REPLAY. The broadcast above fires on a write, which is the wrong moment for a surface that was
 * not mounted yet — navigate to the composer with a draft already held and the tree would sit empty
 * until the next edit, describing a draft that exists as if it did not.
 *
 * So a surface asks on mount and the provider answers on the same bus. A request carries nothing:
 * the provider holds the draft and is the only party that can say what it is.
 */
export const AUTOPILOT_DRAFT_REPLAY_EVENT = 'autopilotDraftReplay'

/** Ask the provider to re-broadcast the held draft. Safe with no draft — the answer is then empty. */
export const requestDraftReplay = (): void => {
  window.dispatchEvent(new Event(AUTOPILOT_DRAFT_REPLAY_EVENT))
}

/** Provider side: answer replay requests. Returns the unsubscribe fn. */
export const onDraftReplayRequest = (handler: () => void): (() => void) => {
  window.addEventListener(AUTOPILOT_DRAFT_REPLAY_EVENT, handler)
  return () => window.removeEventListener(AUTOPILOT_DRAFT_REPLAY_EVENT, handler)
}

/**
 * WHO OWNS THE OPEN DRAFT.
 *
 * The drawer and the page composer listen on the SAME preview bus, so on the composer route both
 * used to open on one payload and both mounted a live sandbox render of it. That is not merely
 * redundant: the drawer's close fires `payload.onClose`, which for a sandbox preview DELETEs every
 * draft CR — so closing the drawer to get back to the composer underneath tore the sandbox out from
 * under the composer, which went blank with nothing to explain why.
 *
 * So a draft has exactly one surface. While the composer is mounted it claims the preview and the
 * drawer stays shut; the composer then owns the close, and with it the teardown. Module state and
 * not a context because the two parties sit in different React trees — the drawer renders inside
 * AutopilotProvider, the composer is a route — which is the same reason the buses above exist.
 */
let composerMounted = 0

/** Claim the preview surface for as long as the composer is mounted. Returns the release fn. */
export const claimPreviewSurface = (): (() => void) => {
  composerMounted += 1
  return () => {
    composerMounted = Math.max(0, composerMounted - 1)
  }
}

/** True while a mounted composer owns incoming previews — the drawer defers to it. */
export const previewSurfaceClaimed = (): boolean => composerMounted > 0
