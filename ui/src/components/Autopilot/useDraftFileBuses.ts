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
import { useEffect } from 'react'

import type { BlueprintDraftStore } from './blueprintDraftStore'
import { clearComposeRefusals } from './composeRequest'
import { buildPagePreviewPayload } from './previewBridge'
import { openAutopilotPreview } from './previewBus'
import { emitDraftChanged, onDraftReplayRequest } from './previewDraftChanged'
import { onDraftStart } from './previewDraftStart'
import { onFileAdd } from './previewFileAdd'
import { onFileRemove } from './previewFileRemove'
import { onFileEdit } from './previewFileEdit'
import { recordPagePreview } from './publishCompile'

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
  // EDIT: an accepted per-file edit from a Files tab.
  //
  // updateDisplayedFile, not updateFile: the surface shows a page at its repo DESTINATION while the
  // draft holds it under a bare token, and updateFile matches on the held key — so the raw
  // displayed path would refuse every page edit, silently (a refused edit just leaves the bytes).
  useEffect(() => onFileEdit(({ content, path }) => {
    if (store.updateDisplayedFile(path, content).ok) {
      gate.recordPreview(identityOf(store.get()))
    }
  }), [gate, identityOf, store])

  // ADD: a file the composer just authored — a layout container, a new widget.
  useEffect(() => onFileAdd(({ content, path }) => {
    if (store.addFile(path, content).ok) {
      gate.recordPreview(identityOf(store.get()))
    }
  }), [gate, identityOf, store])

  // Removal re-arms the gate exactly as an add or an edit does: the draft's identity has changed,
  // and a gate still armed for the previous shape would let a publish commit a set nobody previewed.
  useEffect(() => onFileRemove(({ path }) => {
    if (store.removeFile(path).ok) {
      gate.recordPreview(identityOf(store.get()))
    }
  }), [gate, identityOf, store])

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
      void previewLive(widgets, title)
      return
    }
    openAutopilotPreview({ ...buildPagePreviewPayload(widgets), caption: undefined, title })
  }), [gate, previewLive, store])
}
