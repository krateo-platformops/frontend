/**
 * Publishing a held draft — the page/blueprint publish, lifted out of the verb branch.
 *
 * WHY IT MOVED. This was ~50 lines inline inside `AutopilotProvider.finalize`, reachable only when
 * the MODEL emitted a `publishPage`/`publishBlueprint` directive. So the one way to publish a draft
 * a person had authored was to ask the agent to do it — there is even a host-side trampoline that
 * re-prompts the model when a user says "publish" and it fails to emit the fence. A composer that
 * lets someone start, compose and edit a page, and then sends them to the chat to ship it, is not
 * the parity rule applied to the builder; it is the rail wearing a different hat.
 *
 * Extracted rather than duplicated, so the UI path and the verb path are the SAME code: one
 * destination form, one gate evaluation, one file-count cap, one set of denial strings. Two publish
 * paths for one artifact is exactly how `compose-page` and the drawer drifted apart.
 *
 * WHAT IT DOES NOT DO. It does not dispatch. It returns the compiled op set and lets the caller
 * apply it, because applying is what raises the blast-radius confirm — a human decision that
 * belongs to the surface that asked, not to this function. The agent's never-submit guarantee is
 * untouched: the model can still only ever get as far as a compiled set a person then confirms.
 */
import type { Config } from '../../context/ConfigContext'

import type { PortalActionProposal } from './actionBridge'
import { MAX_APPLY_SET_OPS } from './applyResourceSet'
import type { AuthorshipOrigin } from './authorship'
import type { BlueprintDraftStore } from './blueprintDraftStore'
import type { createBlueprintGate } from './blueprintGate'
import { buildBlueprintPublishOps } from './blueprintPublish'
import { buildClaimPublish } from './builderClaimPublish'
import type { useBuilderTargets } from './builderTargets'
import type { createOasAttachmentStore } from './oasAttachment'
import { isPageDraft, pagePublishFiles, pageRootSlug } from './pageDraft'
import { buildPagePublishOps } from './pagePublish'
import type { createPreviewGate } from './previewGate'
import { compilePublishOps, heldDraftIdentity, type PublishCompileResult } from './publishCompile'
import { askPublishDestination } from './publishTargetForm'

export interface PublishDraftDeps {
  blueprintGate: ReturnType<typeof createBlueprintGate>
  blueprintStore: BlueprintDraftStore
  builderTargets: ReturnType<typeof useBuilderTargets>
  config: Config | undefined
  oasStore: ReturnType<typeof createOasAttachmentStore>
  /** Authorship provenance stamped onto every op — who and what caused the write. */
  origin: AuthorshipOrigin
  previewGate: ReturnType<typeof createPreviewGate>
  /** AUTOPILOT_PUBLISH_VIA_GIT_PROVIDER — one BuilderPublish claim instead of the git-write set. */
  publishViaClaim: boolean
}

export interface PublishDraftOutcome {
  compiled: PublishCompileResult
  deepLink: string | null
}

/**
 * FE-BP6/BP7 — frontend-constructs-ops (blueprint + its near-identical PAGE variant, unified).
 * ONE scalar verb carries repo coords only; the HOST assembles the publish from the HELD previewed
 * tree — either the github git-write set (gitrefs + per-file repocontents + pullrequests, via
 * compilePublishOps' $fileContent→base64 + authorship) OR, when AUTOPILOT_PUBLISH_VIA_GIT_PROVIDER
 * is set, ONE BuilderPublish claim (git-provider LocalResources). Same destination form and
 * blast-radius confirm either way; the shared blueprintGate identity (chart / page name) enforces
 * preview-before-publish.
 *
 * `proposal` is the model's directive when the agent asked, and a synthetic one carrying just the
 * verb when a person clicked Publish. Everything downstream treats them identically, which is the
 * point — a UI publish that took a shortcut past the gate would be a way to ship un-previewed bytes.
 */
export const runDraftPublish = async (
  deps: PublishDraftDeps,
  proposal: PortalActionProposal,
): Promise<PublishDraftOutcome> => {
  const { blueprintGate, blueprintStore, builderTargets, config, oasStore, origin, previewGate, publishViaClaim } = deps
  const isPage = proposal.verb === 'publishPage'
  const held = blueprintStore.get()
  const identity = heldDraftIdentity(held)
  // The BRANCH slug: a page derives it from its page-<slug> root; a blueprint reuses the identity.
  const pageSlug = held && isPageDraft(held) ? pageRootSlug(held.files) : null
  const slug = isPage ? pageSlug : identity
  const builder = isPage ? 'page' : 'blueprint'
  const bt = isPage ? builderTargets.page : builderTargets.blueprint
  // PER-ARTIFACT repos (#163): a portal PAGE publishes to the single configured chart repo
  // (bt.repo), but each BLUEPRINT gets its OWN repo named for the chart — so the destination repo
  // prefill is the artifact slug, with the OWNER coming from install config (bt.owner). The human
  // still confirms/edits in the blast-radius dialog; a model-emitted repo still wins.
  const destRepo = isPage ? bt.repo : (slug || bt.repo)
  const dest = await askPublishDestination(proposal, builder, destRepo, bt.owner)
  const targeted = dest ? { ...proposal, ...dest } : proposal
  const overflow = isPage
    ? 'split the page across turns on the same branch'
    : 'trim the chart tree (large assets belong in a hosted values file)'

  if (!dest) {
    return { compiled: { denial: 'publish cancelled — destination not confirmed', ops: null }, deepLink: null }
  }
  if (!held || !slug || !identity) {
    return {
      compiled: {
        denial: `denied — no previewed ${isPage ? 'portal page' : 'blueprint'} to publish (draft + preview a ${isPage ? 'page-<slug>' : 'chart'} first)`,
        ops: null,
      },
      deepLink: null,
    }
  }

  if (publishViaClaim) {
    // The claim commits each path VERBATIM (builder-publish only splits it into basename + dir), so
    // the full repo path is this caller's job. A BLUEPRINT's held keys already ARE chart-relative
    // paths and pass straight through; a PAGE's are bare identity tokens, and publishing those
    // unrouted dropped every widget CR at the repo ROOT — outside the chart, packaged by nothing,
    // merged green and rendered never. pagePublishFiles applies the same routing the legacy
    // git-write path and the preview drawer use, so all three agree.
    const files = isPage
      ? pagePublishFiles(held.files)
      : Object.entries(held.files).map(([path, content]) => ({ content, path }))
    if (files.length > MAX_APPLY_SET_OPS) {
      return {
        compiled: { denial: `denied — "${slug}" has ${files.length} files; a single publish tops out at ${MAX_APPLY_SET_OPS} — ${overflow}.`, ops: null },
        deepLink: null,
      }
    }
    const res = await buildClaimPublish({
      builder,
      config,
      dest,
      files,
      gate: (ops) => blueprintGate.evaluate(ops, identity),
      namespace: 'krateo-system',
      origin,
      slug,
    })
    return { compiled: res.compiled, deepLink: res.deepLink }
  }

  const built = isPage ? buildPagePublishOps(targeted, held, slug) : buildBlueprintPublishOps(targeted, held, slug)
  if (built.length > MAX_APPLY_SET_OPS) {
    return {
      compiled: { denial: `denied — "${slug}" has ${Object.keys(held.files).length} files; a single publish tops out at ${MAX_APPLY_SET_OPS - 2} — ${overflow}.`, ops: null },
      deepLink: null,
    }
  }
  return {
    compiled: compilePublishOps(built, previewGate.evaluate(built), blueprintGate.evaluate(built, identity), oasStore.get(), held, origin),
    deepLink: null,
  }
}
