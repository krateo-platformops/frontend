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
  /**
   * Whether the held draft is armed to publish right now (its last preview still stands). A surface
   * shows the EXCEPTION — "Preview needed" — when this is false for a held draft, never a mark when
   * it is true. Absent from emitters that do not know the gate, which reads as "unknown", not false.
   */
  previewed?: boolean
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
/*
 * PER KIND. There are two composers — pages and blueprints — and each can show only its own kind of
 * draft. A single kind-blind counter meant a mounted blueprint composer made the drawer defer every
 * PAGE preview to a surface that cannot show it (shown nowhere), while its own chart previews still
 * opened the drawer over it. A claim names the kind it can show; the drawer defers only that kind.
 */
const composerMounted: Record<DraftKind, number> = { blueprint: 0, page: 0 }

/**
 * A CLAIM IS ANNOUNCED, not only recorded. Deferring the NEXT preview is half of "one surface per
 * draft": a drawer ALREADY OPEN on the held draft — the agent previewed the chart on another route,
 * then the person navigated to the composer — stayed open over it, and its Files tab, seeded from the
 * one-shot payload, wrote its stale bytes over whatever the person had since edited in the composer.
 * So a claim tells the drawer, which hands a held draft of that kind to the composer: it shuts without
 * firing the payload's close (for a live page render, the sandbox teardown) and re-announces the
 * payload, so the composer adopts the render and owns its close from then on.
 */
export const AUTOPILOT_PREVIEW_CLAIMED_EVENT = 'autopilotPreviewSurfaceClaimed'

/** Claim the preview surface for `kind` for as long as that composer is mounted. Returns the release fn. */
export const claimPreviewSurface = (kind: DraftKind): (() => void) => {
  composerMounted[kind] += 1
  window.dispatchEvent(new CustomEvent<DraftKind>(AUTOPILOT_PREVIEW_CLAIMED_EVENT, { detail: kind }))
  return () => {
    composerMounted[kind] = Math.max(0, composerMounted[kind] - 1)
  }
}

/** The drawer's side: hear each claim, by kind. Returns the unsubscribe fn. */
export const onPreviewSurfaceClaimed = (handler: (kind: DraftKind) => void): (() => void) => {
  const listener = (event: Event): void => {
    const { detail } = event as CustomEvent<DraftKind>
    if (detail === 'page' || detail === 'blueprint') {
      handler(detail)
    }
  }
  window.addEventListener(AUTOPILOT_PREVIEW_CLAIMED_EVENT, listener)
  return () => window.removeEventListener(AUTOPILOT_PREVIEW_CLAIMED_EVENT, listener)
}

/** True while a mounted composer owns incoming previews of `kind` — the drawer defers those to it. */
export const previewSurfaceClaimed = (kind: DraftKind | null): boolean => kind !== null && composerMounted[kind] > 0
