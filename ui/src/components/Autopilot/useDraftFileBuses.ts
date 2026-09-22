/**
 * The provider's two held-draft write paths, in one place.
 *
 * A surface that authors — the preview drawer's Files tab, the page composer's tree — holds neither
 * the draft nor the publish gate. Both live here, in the provider. So each surface emits on a
 * window CustomEvent and this hook is the single subscriber that turns those into store writes.
 *
 * WHY TWO BUSES AND NOT ONE WITH A FLAG. An edit means "new bytes for a file you already hold" and
 * resolves a DISPLAYED repo path back to the held key (a page is held under a bare identity token,
 * not the routed path the user sees). An add has neither property: no held key to resolve, no
 * previous content. One event with a discriminator would be a handler whose two arms share nothing,
 * and would let an add that should have been refused fall through the edit path.
 *
 * WHY `addFile` RATHER THAN RELAXING `updateFile`. updateFile refuses an unknown path — "only
 * previewed files can be edited" — and that refusal is load-bearing: it stops an edit inventing a
 * path the preview never validated and smuggling it into the publish set. Making it upsert would
 * delete that guarantee for every existing caller to serve one new one.
 *
 * THE GATE CONTRACT IS THE SAME ON BOTH. A successful write re-arms the preview gate for the held
 * draft's identity; a refused one arms nothing, so publishing stays deny-by-default. The bytes that
 * publish are the bytes a human produced — neither path round-trips the model.
 */
import { useCallback, useEffect, useRef } from 'react'

import type { BlueprintDraftStore } from './blueprintDraftStore'
import { clearComposeRefusals } from './composeRequest'
import { draftHistory } from './draftHistory'
import { pageDisplayName, pageDraftWidgets } from './pageDraft'
import { emitPreviewApplied } from './previewApplied'
import { buildPagePreviewPayload } from './previewBridge'
import { openAutopilotPreview } from './previewBus'
import { emitDraftChanged, onDraftReplayRequest } from './previewDraftChanged'
import { onDraftStart } from './previewDraftStart'
import { onDraftUndo } from './previewDraftUndo'
import { onFileAdd } from './previewFileAdd'
import { onFileEdit } from './previewFileEdit'
import { onFileRemove } from './previewFileRemove'
import { recordPagePreview } from './publishCompile'

/**
 * How long a burst of writes settles before the sandbox is re-applied. One gesture is several
 * emissions — a container drop adds a file and rewrites its parent — so this is the window that
 * turns a drag into one apply instead of three.
 */
const REAPPLY_DEBOUNCE_MS = 700

/** The slice of the preview gate this hook needs — narrowed so tests need not build a whole gate. */
interface PreviewGateLike {
  // Matches BlueprintGate exactly, `undefined` included. A narrower parameter type is NOT a
  // narrower function: one accepting only `string | null` cannot stand in where the real gate is
  // expected, which is how this drifted into rejecting the very gate it describes.
  recordPreview: (identity: string | null | undefined) => void
}

export const useDraftFileBuses = (
  store: BlueprintDraftStore,
  gate: PreviewGateLike,
  identityOf: (held: ReturnType<BlueprintDraftStore['get']>) => string | null,
  /**
   * Apply a freshly started draft to the preview sandbox and open it live — the host's own
   * `previewPage`. Optional: absent, a started draft opens source-only, as it always did.
   */
  previewLive?: (widgets: Record<string, unknown>[], title: string) => Promise<unknown>,
): void => {
  /*
   * RE-APPLY: what makes "Rendered (live)" actually live.
   *
   * The sandbox was seeded ONCE — `previewPage` on draft start — and never again. Every later
   * change went through the three handlers below, each of which updates the held store, pushes an
   * undo step and re-arms the publish gate, and NONE of which told the sandbox anything. Measured
   * on a live cluster: after dragging a Row onto the canvas and binding a Table to a RESTAction,
   * the sandbox held exactly the two objects the draft started with. The Row was in the tree, in
   * the files and in the publish set, and absent from the thing labelled "Rendered (live)"; the
   * RESTAction and the Table answered 404. The preview was not stale by a little — it was a
   * snapshot of a draft that no longer existed, and nothing anywhere said so.
   *
   * DEBOUNCED, because one gesture is several writes. A container drop adds a file AND rewrites its
   * parent; a bind adds two files and edits a third. Applying per-emission would fire three sandbox
   * sweeps for one drag, each tearing down and recreating the same names, and the last one would
   * race the first. One apply per settled burst is both correct and cheaper.
   *
   * THE SAME VERB, not a second implementation: `previewLive` is the host's own `previewPage`, with
   * its sweep, its ≤10-op chunking and its safety kernel. Absent (unit tests, a non-UI caller) this
   * is inert and the hook behaves exactly as it did.
   */
  const replayTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Read through refs so the runner below can be created ONCE and still see the current props. A
  // runner rebuilt on every render would make the in-flight flags below meaningless: each new
  // closure would carry its own idea of whether an apply was already running.
  const liveRef = useRef(previewLive)
  liveRef.current = previewLive
  const storeRef = useRef(store)
  storeRef.current = store
  /** An apply is between its sweep and its last POST. Nothing else may apply in that window. */
  const inFlight = useRef(false)
  /** Something changed while an apply was running — drain it when that one lands. */
  const pending = useRef(false)

  /*
   * ONE APPLY AT A TIME, and the reason is the 409 this replaced.
   *
   * An apply is not atomic: it DELETEs every name it is about to write (the sweep), then POSTs
   * them. The sweep exists because the sandbox uses the draft's real names — `page-<slug>`,
   * `platform-alerts` — since the preview has to render the same object graph that will be
   * published, wired by the same names. Two applies overlapping interleave into
   * sweep(A) POST(A) sweep(B) POST(B) at best, and sweep(B) POST(A) POST(B) at worst: B's create
   * then hits A's object and the apiserver answers 409 "already exists". Measured on a live
   * cluster, every recorded session produced exactly one:
   *
   *   Flex/page-proof-d: flexes.widgets.templates.krateo.io "page-proof-d" already exists
   *
   * That apply is abandoned and rolled back, and its drawer falls back to source-only — the live
   * render disappears until the next apply happens to succeed. It self-heals, which is precisely
   * what made it easy to miss.
   *
   * This was not possible before the re-apply existed: there was exactly ONE apply per session, at
   * draft start. It is a defect of this file, not of the apply path.
   *
   * DRAINED, NOT QUEUED. A request that arrives mid-flight sets a flag rather than joining a queue,
   * and the loop below re-reads the HELD DRAFT when it comes round. Ten edits during one apply
   * therefore cost one more apply of the final state, not ten applies of ten intermediate states —
   * and the sandbox never renders a shape the author has already moved past.
   */
  const runApply = useCallback(async (explicit?: { title: string; widgets: Record<string, unknown>[] }) => {
    const live = liveRef.current
    if (!live) {
      return
    }
    if (inFlight.current) {
      pending.current = true

      return
    }
    inFlight.current = true
    try {
      let job = explicit
      do {
        pending.current = false
        if (!job) {
          const held = storeRef.current.get()
          const widgets = held ? pageDraftWidgets(held.files) : []
          job = widgets.length && held ? { title: pageDisplayName(held.files), widgets } : undefined
        }
        if (!job) {
          break
        }
        // Serialising IS the point: the next apply must not start until this one's POSTs have
        // landed, or its sweep races them.
        // eslint-disable-next-line no-await-in-loop
        await live(job.widgets, job.title)
        // The announcement is what makes the RENDER follow: the apply changed what the sandbox
        // serves, and the pane's query is keyed on a URL that did not change. See previewApplied.
        emitPreviewApplied()
        job = undefined
      } while (pending.current)
    } catch {
      // Failures are the apply path's to report — it already turns one into a visible chip. What
      // must NOT happen here is an unhandled rejection taking the composer down with it.
    } finally {
      // The lint reads these as a possible interleaving. They cannot interleave: this ref IS the
      // mutex, JS runs one task at a time, and the only writer is this function — which is exactly
      // why the flag was added. Clearing it anywhere but `finally` would strand every later apply
      // behind a failed one.
      // eslint-disable-next-line require-atomic-updates
      inFlight.current = false
      pending.current = false
    }
  }, [])

  const scheduleReapply = useCallback(() => {
    if (!liveRef.current) {
      return
    }
    if (replayTimer.current) {
      clearTimeout(replayTimer.current)
    }
    replayTimer.current = setTimeout(() => {
      replayTimer.current = null
      void runApply()
    }, REAPPLY_DEBOUNCE_MS)
  }, [runApply])

  // Cancel in flight on unmount: a timer that fires after the composer is gone would apply a draft
  // nobody is looking at, into a sandbox the close path may already have torn down.
  useEffect(() => () => {
    if (replayTimer.current) {
      clearTimeout(replayTimer.current)
    }
  }, [])
  // EDIT: an accepted per-file edit from a Files tab.
  //
  // updateDisplayedFile, not updateFile: the surface shows a page at its repo DESTINATION while the
  // draft holds it under a bare token, and updateFile matches on the held key — so the raw
  // displayed path would refuse every page edit, silently (a refused edit just leaves the bytes).
  useEffect(() => onFileEdit(({ content, path }) => {
    // Captured BEFORE the call and pushed only if it was accepted: a refused or over-cap edit
    // leaves the tree exactly as it was, and a snapshot for one would make Undo consume a step
    // without changing anything — the control would move and the draft would not.
    const before = store.get()?.files
    if (store.updateDisplayedFile(path, content).ok) {
      if (before) { draftHistory.push(before) }
      gate.recordPreview(identityOf(store.get()))
      scheduleReapply()
    }
  }), [gate, identityOf, scheduleReapply, store])

  // ADD: a file the composer just authored — a layout container, a new widget.
  useEffect(() => onFileAdd(({ content, path }) => {
    const before = store.get()?.files
    if (store.addFile(path, content).ok) {
      if (before) { draftHistory.push(before) }
      gate.recordPreview(identityOf(store.get()))
      scheduleReapply()
    }
  }), [gate, identityOf, scheduleReapply, store])

  // Removal re-arms the gate exactly as an add or an edit does: the draft's identity has changed,
  // and a gate still armed for the previous shape would let a publish commit a set nobody previewed.
  useEffect(() => onFileRemove(({ path }) => {
    const before = store.get()?.files
    if (store.removeFile(path).ok) {
      if (before) { draftHistory.push(before) }
      gate.recordPreview(identityOf(store.get()))
      scheduleReapply()
    }
  }), [gate, identityOf, scheduleReapply, store])

  // UNDO: put the whole tree back. `set` rather than a per-file replay, because the step being
  // undone may have added or removed files as well as changed them — a container drop does both.
  useEffect(() => onDraftUndo(() => {
    const previous = draftHistory.pop()
    const kind = store.get()?.kind
    if (!previous || !kind) {
      return
    }
    if (store.set(previous, kind).ok) {
      gate.recordPreview(identityOf(store.get()))
      scheduleReapply()
    }
  }), [gate, identityOf, scheduleReapply, store])

  // REPLAY: a surface that mounted AFTER the draft was seeded missed the store's broadcast, so it
  // asks and we answer on the same bus. Answering with an empty map when nothing is held is
  // deliberate — "no draft" is an answer, and silence leaves that surface waiting forever.
  useEffect(() => onDraftReplayRequest(() => {
    emitDraftChanged({ files: store.get()?.files ?? {} })
  }), [store])

  // START: a person creating a draft, rather than an agent proposing one.
  //
  // Through `recordPagePreview` — the SAME entry point a proposed page takes — so the two are
  // indistinguishable downstream and the publish rules cannot come to disagree about which is
  // which. It serializes the CRs into the held map and arms the gate; the preview event then makes
  // every surface show it exactly as it shows a proposal.
  //
  // REFUSED while a draft is held. Seeding over one would discard unpublished work with no way
  // back, and the surfaces already offer a close that tears the current draft down deliberately.
  useEffect(() => onDraftStart(({ title, widgets }) => {
    if (store.get()) {
      return
    }
    // A new page is not answerable for the last one's refusals: "page-x cannot hold a cards" is
    // about a draft that no longer exists, and carrying it forward would have the model correcting
    // a problem this page does not have.
    clearComposeRefusals()
    // A snapshot restored into a DIFFERENT page would be a worse data loss than the one undo fixes.
    draftHistory.clear()
    recordPagePreview(widgets, store, gate)

    // AND THEN THE SAME LIVE PREVIEW A PROPOSAL GETS.
    //
    // The comment above says this path takes "the SAME entry point a proposed page takes", and in
    // one sense it did — `recordPagePreview` is shared. But a PROPOSED page also goes through
    // `previewPage`, which applies the drafts to the sandbox and hands the drawer a `liveEndpoint`;
    // a hand-started one stopped at the held bytes. So the two were not indistinguishable at all:
    // the agent's page rendered, and the person's showed YAML.
    //
    // That asymmetry got worse the moment drag & drop became the ONLY way to build a portal page
    // (portal#237). The path we made primary was the one without a live preview, and the path we
    // de-emphasised was the one that rendered.
    //
    // `previewLive` is the host's own `previewPage` apply — the identical verb, deps and safety
    // kernel, not a second implementation. It is OPTIONAL: with no host wired (unit tests, a
    // non-UI caller) this falls back to the source-only payload exactly as before, so nothing
    // that worked without a sandbox starts depending on one.
    if (previewLive) {
      // THROUGH THE SAME GATE. The start apply is an apply: a drag a moment later must queue behind
      // it rather than sweep underneath it.
      void runApply({ title, widgets })

      return
    }
    openAutopilotPreview({ ...buildPagePreviewPayload(widgets), caption: undefined, title })
  }), [gate, previewLive, runApply, store])
}
