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
 * destination form, one gate evaluation, one set of denial strings. Two publish
 * paths for one artifact is exactly how `compose-page` and the drawer drifted apart.
 *
 * WHAT IT DOES NOT DO. It does not dispatch. It returns the compiled op set and lets the caller
 * apply it, because applying is what raises the blast-radius confirm — a human decision that
 * belongs to the surface that asked, not to this function. The agent's never-submit guarantee is
 * untouched: the model can still only ever get as far as a compiled set a person then confirms.
 */
import type { Config } from '../../context/ConfigContext'

import type { PortalActionProposal } from './actionBridge'
import type { AuthorshipOrigin } from './authorship'
import { lintBlueprintDraft } from './blueprintDraft'
import { heldPublishFiles, type BlueprintDraftStore } from './blueprintDraftStore'
import type { createBlueprintGate } from './blueprintGate'
import { buildClaimPublish } from './builderClaimPublish'
import { builderTemplateUrl, type useBuilderTargets } from './builderTargets'
import { isPageDraft, pageCompositionDefinition, pageRootSlug } from './pageDraft'
import { heldDraftIdentity, type PublishCompileResult } from './publishCompile'
import { askPublishDestination } from './publishTargetForm'

export interface PublishDraftDeps {
  blueprintGate: ReturnType<typeof createBlueprintGate>
  blueprintStore: BlueprintDraftStore
  builderTargets: ReturnType<typeof useBuilderTargets>
  config: Config | undefined
  /** Authorship provenance stamped onto every op — who and what caused the write. */
  origin: AuthorshipOrigin
}

export interface PublishDraftOutcome {
  compiled: PublishCompileResult
  deepLink: string | null
}

/**
 * FE-BP6/BP7 — frontend-constructs-ops (blueprint + its near-identical PAGE variant, unified).
 * ONE scalar verb carries repo coords only; the HOST assembles the publish from the HELD previewed
 * tree as ONE BuilderPublish claim (git-provider LocalResources commit the files). The shared
 * blueprintGate identity (chart / page name) enforces preview-before-publish. There used to be a
 * second route — a host-built github.krateo.io GitRef / RepoContent / PullRequest set — removed
 * 2026-09-25: one publish path, whatever the SCM.
 *
 * `proposal` is the model's directive when the agent asked, and a synthetic one carrying just the
 * verb when a person clicked Publish. Everything downstream treats them identically, which is the
 * point — a UI publish that took a shortcut past the gate would be a way to ship un-previewed bytes.
 */
export const runDraftPublish = async (
  deps: PublishDraftDeps,
  proposal: PortalActionProposal,
): Promise<PublishDraftOutcome> => {
  const { blueprintGate, blueprintStore, builderTargets, config, origin } = deps
  const isPage = proposal.verb === 'publishPage'
  const held = blueprintStore.get()
  const identity = heldDraftIdentity(held)
  // The BRANCH slug: a page derives it from its page-<slug> root; a blueprint reuses the identity.
  const pageSlug = held && isPageDraft(held) ? pageRootSlug(held.files) : null
  const slug = isPage ? pageSlug : identity
  const builder = isPage ? 'page' : 'blueprint'
  const bt = isPage ? builderTargets.page : builderTargets.blueprint
  // PER-ARTIFACT repos (#163), now for BOTH builders. It used to be blueprint-only: a blueprint got
  // its own repo named for the chart, while every page went to the one configured portal-chart repo,
  // because every page WAS a file in that one chart. A page set is its own chart now, so the same
  // rule applies to it for the same reason — one chart, one repo, one release cadence. The install
  // config still supplies the OWNER (bt.owner) and the fallback repo; the human confirms or edits in
  // the blast-radius dialog, and a model-emitted repo still wins over this prefill.
  const destRepo = slug || bt.repo
  // The VERB must match what is held. Everything below derives builder, slug and destination from
  // the verb alone, and the gate is keyed by name, so publishBlueprint over a held PAGE compiled a
  // blueprint claim out of page files — refused by name instead.
  if (held && isPage !== (held.kind === 'page')) {
    const heldKind = held.kind === 'page' ? 'a portal page' : 'a blueprint chart'
    return { compiled: { denial: `denied — the open draft is ${heldKind}, and ${proposal.verb} publishes ${isPage ? 'a portal page' : 'a blueprint chart'}. Publish it from the ${held.kind === 'page' ? 'page' : 'blueprint'} composer.`, ops: null }, deepLink: null }
  }
  // A draft that fails the chart lint is refused BY NAME, before anyone is asked where to send it.
  // Its gate is already disarmed (a dirty hand edit forgets the arming), but that refusal says
  // "preview first" — the wrong reason, since previewing again cannot help until the file is fixed.
  const lintProblems = held ? lintBlueprintDraft(held.files, held.kind) : []
  if (lintProblems.length) {
    return { compiled: { denial: `denied — the draft fails the chart lint: ${lintProblems.join('; ')}`, ops: null }, deepLink: null }
  }
  const dest = await askPublishDestination(proposal, builder, destRepo, bt.owner)

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

  // THE REGISTRATION FILE, written at publish time because it is the one file that depends on the
  // destination: its OCI url is `<owner>/charts/<chart name>`, and the owner is only settled once
  // the human confirms it. Without it the page set releases to OCI and nothing installs it — the
  // chart is inert until a CompositionDefinition registers it. It also overwrites the copy a
  // template scaffold brings in, which still names the template's own chart.
  const owner = dest.owner || bt.owner
  const publishFiles = isPage && owner
    ? { ...held.files, 'compositiondefinition.yaml': pageCompositionDefinition(slug, owner) }
    : held.files

  // The claim commits each path VERBATIM (builder-publish only splits it into basename + dir), so
  // the full repo path is this caller's job — and both builders now hand it chart-relative keys,
  // so there is one mapping rather than a routed page branch beside a pass-through blueprint one.
  // That branch existed because a page's keys were bare identity tokens; publishing those unrouted
  // dropped every widget CR at the repo ROOT — outside the chart, packaged by nothing, merged
  // green and rendered never. The keys carry their own location now, so nothing has to re-derive
  // it and the three writers cannot disagree about it.
  //
  // NO FILE COUNT LIMIT. The claim is ONE write whatever the chart holds — the files ride inside
  // it — so the write-set cap (MAX_APPLY_SET_OPS) has nothing to count here. It used to be
  // borrowed as a file cap, which refused an ordinary blueprint: Chart.yaml, values, schema,
  // templates and architecture.yaml already make nine. What bounds a claim is its SIZE, and the
  // held-draft byte cap enforces that before anything reaches here.
  const files = heldPublishFiles(publishFiles)
  const res = await buildClaimPublish({
    builder,
    config,
    dest,
    files,
    gate: (ops) => blueprintGate.evaluate(ops, identity),
    namespace: 'krateo-system',
    origin,
    slug,
    // SEED a new page-set repo from the configured template, so what the claim creates is not a
    // bare repo holding an unreleasable chart. Null when no template is configured — the claim
    // then omits `source` and behaves exactly as before. Pages only: the blueprint builder has
    // the same gap and no template key yet.
    sourceUrl: isPage ? builderTemplateUrl(builderTargets.pageTemplate, config?.api.AUTOPILOT_GIT_HOST) : null,
  })
  return { compiled: res.compiled, deepLink: res.deepLink }
}
