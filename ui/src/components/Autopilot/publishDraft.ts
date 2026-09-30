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
 *
 * DRIVEN BY THE BUILDER (T2, frontend#408). Nothing here switches on page vs blueprint. The publish
 * verb names the Builder that allows it (`spec.verbs.allowed`); that Builder's `spec.publish.builder`
 * picks the PUBLISHER (the registration file, the projection bundle), its `spec.draftKind` picks the
 * draft-kind plugin (the branch slug and the words a denial uses), and its `targetKey`/`templateKey`
 * pick the destination and the seed. The controller (KOG) publish, which used to be a separate
 * dispatch module (kogPublishDispatch.ts), is the third publisher here: one module, one claim,
 * whatever the builder, entered through `publishDraft`.
 */
import { builderRegistry } from '../../builders/builderRegistry'
import type { BuilderSpec, PublishBuilder } from '../../builders/builderSpec'
import { draftKindOf, draftKindPlugin } from '../../builders/draftKinds'
import type { Config } from '../../context/ConfigContext'
import { publishNameProblem } from '../../pages/BlueprintComposer/chartIdentity'
import { PROJECTION_BUNDLE_PATH, projectionForFiles } from '../../pages/BlueprintComposer/projectionCompile'
import { blueprintCompositionDefinition } from '../../pages/BlueprintComposer/startChart'

import type { PortalActionProposal } from './actionBridge'
import type { ApplyResourceSetOp } from './applyResourceSet'
import type { AuthorshipOrigin } from './authorship'
import { CHART_YAML_PATH, chartYamlVersion } from './blueprintDraft'
import { heldPublishFiles, type BlueprintDraftHeld, type BlueprintDraftStore } from './blueprintDraftStore'
import type { createBlueprintGate } from './blueprintGate'
import { buildClaimPublish } from './builderClaimPublish'
import type { PublishStatusClaim } from './builderPublishStatus'
import { builderTargetFor, builderTemplateUrl, type useBuilderTargets } from './builderTargets'
import { kogCompositionDefinition } from './kogChart'
import { REST_DEFINITION_GVR } from './kogMapping'
import { kogPublishFiles, resolveKogPublishDraft } from './kogPublish'
import { pageCompositionDefinition } from './pageDraft'
import type { PreviewGate } from './previewGate'
import type { PublishRequestDetail, PublishResultDetail } from './previewPublishRequest'
import { lintHeldDraft } from './proposedChart'
import { heldDraftIdentity, type PublishCompileResult } from './publishCompile'
import { askPublishDestination, type PublishInitiator, type PublishTargetRequest } from './publishTargetForm'
import type { AutopilotActionChip } from './types'
import type { DraftAutosave } from './useDraftAutosave'

/** What the controller publisher reads, beyond the shared deps. */
export interface ControllerPublishCtx {
  previewGate: PreviewGate
  /** oasStore.get()?.text ?? null — the held OAS document, committed in the paste case. */
  oasText: string | null
  /** The controller publish's own provenance: the agent turn's session and prompt. */
  origin: AuthorshipOrigin
}

export interface PublishDraftDeps {
  blueprintGate: ReturnType<typeof createBlueprintGate>
  blueprintStore: BlueprintDraftStore
  builderTargets: ReturnType<typeof useBuilderTargets>
  config: Config | undefined
  /** Authorship provenance stamped onto every op — who and what caused the write. */
  origin: AuthorshipOrigin
  /** Who asked for this publish — the destination form says so. Absent: the agent's verb. */
  initiator?: PublishInitiator
  /** What the controller publisher reads. Absent (a composer's button), a controller publish is refused. */
  controller?: ControllerPublishCtx
}

export interface PublishDraftOutcome {
  compiled: PublishCompileResult
  deepLink: string | null
  /**
   * The held draft this publish was OF, read before the destination form waited — the record a
   * landed claim marks published. Null for a publisher that publishes no held draft (the controller).
   */
  held?: BlueprintDraftHeld | null
}

/** Where the registration file is committed: the repo root, beside the chart it names. */
export const REGISTRATION_PATH = 'compositiondefinition.yaml'

/**
 * A held-draft PUBLISHER — what differs between the builders that publish the draft the provider
 * holds, keyed by the Builder's `spec.publish.builder`.
 *
 * `registration` is the CompositionDefinition a publish commits, or null when there is no owner to
 * put in its url. A page set's version is the release's placeholder (its Chart.yaml's is too); a
 * blueprint's is Chart.yaml's own, literally, because a merge releases exactly that version. The
 * lint has already refused a blueprint without a version, so the null there is unreachable rather
 * than a silent skip. `projection` is the status-projection bundle (S12) committed beside it: the
 * <chart>-status RESTAction and the apiRef + rows its CompositionDefinition carries.
 */
interface DraftPublisher {
  /** Which destination form asks where it goes. */
  formKind: PublishTargetRequest['kind']
  registration: (slug: string, owner: string, repo: string, files: Record<string, string>) => string | null
  projection: (files: Record<string, string>) => { bundle: string } | null
}

const DRAFT_PUBLISHERS: Partial<Record<PublishBuilder, DraftPublisher>> = {
  blueprint: {
    formKind: 'blueprint',
    projection: (files) => projectionForFiles(files),
    registration: (slug, owner, repo, files) => {
      const version = chartYamlVersion(files[CHART_YAML_PATH])
      return version ? blueprintCompositionDefinition(slug, owner, repo, version, projectionForFiles(files)) : null
    },
  },
  page: {
    formKind: 'page',
    projection: () => null,
    registration: (slug, owner, repo) => pageCompositionDefinition(slug, owner, repo),
  },
}

/**
 * Publish verbs no Builder declares YET, and the publisher each runs. `publishRestDef` is the
 * controller's until the Controller Builder (T8) lists it in its `verbs.allowed`; then this entry
 * goes and the Builder names it like every other.
 */
const UNDECLARED_PUBLISH_VERBS: Readonly<Record<string, PublishBuilder>> = { publishRestDef: 'controller' }

/** The Builder whose `verbs.allowed` carries this verb, or undefined. */
const builderOfVerb = (verb: string): BuilderSpec | undefined => builderRegistry.get({ verb })?.spec

/**
 * The publisher a verb runs — the `spec.publish.builder` of the Builder that allows it — or null when
 * the verb publishes nothing. What the provider asks before it treats a proposal as a publish.
 */
export const publisherOfVerb = (verb: string): PublishBuilder | null => {
  const declared = builderOfVerb(verb)?.publish.builder
  if (declared && DRAFT_PUBLISHERS[declared]) {
    return declared
  }
  return Object.prototype.hasOwnProperty.call(UNDECLARED_PUBLISH_VERBS, verb) ? UNDECLARED_PUBLISH_VERBS[verb] : null
}

const denied = (denial: string, held?: BlueprintDraftHeld | null): PublishDraftOutcome =>
  ({ compiled: { denial, ops: null }, deepLink: null, ...(held !== undefined ? { held } : {}) })

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
  const held = blueprintStore.get()
  const builder = builderOfVerb(proposal.verb)
  const publisher = builder ? DRAFT_PUBLISHERS[builder.publish.builder] : undefined
  if (!builder || !publisher) {
    return denied(`denied — no builder publishes a held draft with ${proposal.verb}`, held)
  }
  // The verb's draft kind: how its drafts are named, and what a denial calls them.
  const kind = draftKindPlugin(builder.draftKind)
  const identity = heldDraftIdentity(held)
  // The BRANCH slug, named the way the verb's draft kind names a draft (a page by its page-<slug>
  // root, a chart by its Chart.yaml name).
  const slug = held ? kind.publishSlug(held.files) : null
  // The destination, by the install-config key the Builder names.
  const bt = builderTargetFor(builderTargets, builder.publish.targetKey)
  // PER-ARTIFACT repos (#163), now for BOTH builders. It used to be blueprint-only: a blueprint got
  // its own repo named for the chart, while every page went to the one configured portal-chart repo,
  // because every page WAS a file in that one chart. A page set is its own chart now, so the same
  // rule applies to it for the same reason — one chart, one repo, one release cadence. The install
  // config supplies the OWNER (bt.owner); its repo segment is only the prefill when no draft is held
  // to name one. The slug is the repository prefill whatever a model emitted (askPublishDestination),
  // and — once the repo is seeded — the only repository the publish accepts (seededRepoProblem).
  const destRepo = slug || bt.repo
  // The VERB must match what is held. Everything below derives builder, slug and destination from
  // the verb alone, and the gate is keyed by name, so publishBlueprint over a held PAGE compiled a
  // blueprint claim out of page files — refused by name instead.
  if (held && held.kind !== builder.draftKind) {
    const heldNouns = draftKindOf(held.kind).nouns
    return denied(`denied — the open draft is ${heldNouns.artifact}, and ${proposal.verb} publishes ${kind.nouns.artifact}. Publish it from the ${heldNouns.composer} composer.`, held)
  }
  // A draft that fails the chart lint is refused BY NAME, before anyone is asked where to send it.
  // Its gate is already disarmed (a dirty hand edit forgets the arming), but that refusal says
  // "preview first" — the wrong reason, since previewing again cannot help until the file is fixed.
  const lintProblems = held ? lintHeldDraft(held.files, held.kind) : []
  if (lintProblems.length) {
    return denied(`denied — the draft fails the chart lint: ${lintProblems.join('; ')}`, held)
  }
  // A valid chart can still be unpublishable: the claim is named for it, and core-provider refuses a
  // long claim name at admission — the LAST step, after the person confirmed. Said here, first.
  const claimProblem = slug ? publishNameProblem(slug) : null
  if (claimProblem) {
    return denied(`denied — "${slug}" cannot be published through the builder: ${claimProblem}. Rename it in Chart.yaml${kind.nouns.renameHint}.`, held)
  }
  // SEED the new repository from the builder's template, for EITHER builder: a composed chart in a
  // bare repo has no release workflow, so it can never be released or registered. Null when no
  // template is configured — the claim then omits `source` and the repo is auto-init'd bare.
  const sourceUrl = builderTemplateUrl(builderTargetFor(builderTargets, builder.publish.templateKey), config?.api.AUTOPILOT_GIT_HOST)
  const dest = await askPublishDestination(proposal, publisher.formKind, destRepo, bt.owner, slug ? { seeded: sourceUrl !== null, slug } : undefined, deps.initiator ?? 'autopilot')

  if (!dest) {
    return denied('publish cancelled — destination not confirmed', held)
  }
  if (!held || !slug || !identity) {
    return denied(`denied — no previewed ${kind.nouns.previewed} to publish (draft + preview a ${kind.nouns.previewFirst} first)`, held)
  }

  // THE REGISTRATION FILE, for BOTH builders, written at publish time because it is the one file
  // that depends on the destination: its OCI url is `<owner>/charts/<chart name>` and it names the
  // release in `<owner>/<repo>`, and both are settled only once the human confirms them. Without it
  // the chart releases to OCI and nothing installs it — inert until a CompositionDefinition
  // registers it. It lands because the builder scaffold carries none: the claim never overwrites a
  // file the seed already put there. (A blueprint used to publish without one at all.)
  const registration = publisher.registration(slug, dest.owner || bt.owner, dest.repo || destRepo, held.files)
  const projection = publisher.projection(held.files)
  const publishFiles = {
    ...held.files,
    ...(registration ? { [REGISTRATION_PATH]: registration } : {}),
    ...(projection ? { [PROJECTION_BUNDLE_PATH]: projection.bundle } : {}),
  }

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
    builder: builder.publish.builder,
    config,
    dest,
    files,
    gate: (ops) => blueprintGate.evaluate(ops, identity),
    namespace: 'krateo-system',
    origin,
    slug,
    sourceUrl,
  })
  return { compiled: res.compiled, deepLink: res.deepLink, held }
}

/**
 * The CONTROLLER (KOG) publisher — formerly kogPublishDispatch.ts, absorbed so every builder
 * publishes from this one module. Given the last previewed RestDefinition + the held OAS document, it
 * asks the destination form, then compiles one BuilderPublish claim over the controller's chart
 * files — the same claim every builder publishes through. The KOG preview gate (a synthetic probe,
 * since the claim writes no restdefinitions op) enforces preview-before-publish. No React, no chips.
 */
export const dispatchKogPublish = async (
  proposal: { base?: string; owner?: string; repo?: string },
  ctx: ControllerPublishCtx & { config: Config | undefined; kogTarget: { owner: string; repo: string } },
): Promise<PublishDraftOutcome> => {
  const resolution = resolveKogPublishDraft(ctx.previewGate.lastDraft(), ctx.oasText)
  // The DESTINATION is user-owned: a proper form asks (fence coords are prefills); cancel → denied.
  // PER-ARTIFACT repos (#163): each controller/RestDefinition gets its OWN repo named for the kind —
  // so the repo prefill is the resolved kind, with the OWNER from install config (ctx.kogTarget.owner).
  const destRepo = resolution.held?.kind || ctx.kogTarget.repo
  const restDefTarget = await askPublishDestination(proposal, 'restdef', destRepo, ctx.kogTarget.owner)
  // Probe the KOG preview gate against the RESOLVED draft (the claim writes no restdefinitions op,
  // so the gate sees the draft via a synthetic probe op).
  const gateProbe: ApplyResourceSetOp[] | undefined = resolution.held
    ? [{ gvr: { ...REST_DEFINITION_GVR }, namespace: 'krateo-system', payload: resolution.held.draft, verb: 'POST' }]
    : undefined
  if (!restDefTarget) {
    return denied('publish cancelled — destination not confirmed')
  }
  if (resolution.missingOasDocument) {
    return denied('denied — the previewed mapping uses a configmap:// oasPath but no OpenAPI document is attached; paste the document in the rail first (it is held client-side and committed at publish), or preview a URL oasPath.')
  }
  if (!resolution.held) {
    return denied('denied — no previewed RestDefinition to publish (previewRestDef a mapping first)')
  }

  // THE REGISTRATION FILE, written at publish time because it is the one file that depends on the
  // DESTINATION: its OCI url is `<owner>/charts/<kind>`, and the owner is only settled once the
  // human confirms it in the blast-radius dialog. Without it the controller chart releases to OCI
  // and nothing installs it — core-provider generates the CRD from values.schema.json and serves it,
  // and only then can a claim create the RestDefinition that makes oasgen materialise the real kind.
  const kogOwner = restDefTarget.owner || ctx.kogTarget.owner
  const publishFiles = kogOwner
    ? [
      ...kogPublishFiles(resolution.held),
      { content: kogCompositionDefinition(resolution.held.kind, kogOwner), path: REGISTRATION_PATH },
    ]
    : kogPublishFiles(resolution.held)
  // SCM-agnostic: the RestDefinition (+ OAS ConfigMap) chart → ONE BuilderPublish claim.
  const res = await buildClaimPublish({
    builder: 'controller',
    config: ctx.config,
    dest: restDefTarget,
    files: publishFiles,
    gate: () => ctx.previewGate.evaluate(gateProbe),
    namespace: 'krateo-system',
    origin: ctx.origin,
    slug: resolution.held.kind,
  })
  return { compiled: res.compiled, deepLink: res.deepLink }
}

/**
 * THE ONE PUBLISH ENTRY, for any builder's publish verb. The verb's publisher (publisherOfVerb)
 * decides: the controller's reads its preview gate and OAS document, every other publishes the held
 * draft. `held` on the outcome is the draft the publish was of — null for the controller's.
 */
export const publishDraft = async (deps: PublishDraftDeps, proposal: PortalActionProposal): Promise<PublishDraftOutcome> => {
  if (publisherOfVerb(proposal.verb) !== 'controller') {
    return runDraftPublish(deps, proposal)
  }
  if (!deps.controller) {
    return denied(`denied — ${proposal.verb} publishes a previewed RestDefinition, which only Autopilot holds`, null)
  }
  const outcome = await dispatchKogPublish(proposal, {
    ...deps.controller,
    config: deps.config,
    kogTarget: builderTargetFor(deps.builderTargets, 'AUTOPILOT_KOG_BUILDER_REPO'),
  })
  return { ...outcome, held: null }
}

export interface PersonPublishDeps extends PublishDraftDeps {
  /** The provider's `apply` of the compiled set, as a HUMAN write — it raises the blast-radius confirm. */
  apply: (ops: ApplyResourceSetOp[]) => Promise<AutopilotActionChip | null>
  /** Watch the claim's LocalResources in the rail. */
  track: (claim: PublishStatusClaim) => void
  /** Mark the published draft's record published (useDraftAutosave). Optional: absent, no record is kept. */
  markPublished?: DraftAutosave['markPublished']
}

/**
 * A PERSON'S Publish, end to end — the composer's button, answered on the publish-result bus.
 *
 * The same `publishDraft` the agent's verb takes, then the same `apply`, which raises the
 * blast-radius confirm: this proposes a write, a person answers it. Lifted out of the provider so
 * the ANSWER can be tested, because the answer is what the composer believes.
 *
 * NO DENIAL MEANS WRITTEN. A composer reads `denial: null` as "published" and links the change
 * request. The deep link is computed before anything is written, so it proves nothing; only the
 * apply's own result does. A declined confirm (apply → null: nothing dispatched) and a refused
 * claim (a chip carrying the apiserver's failure) are each a denial, with no link and no status
 * watch — there is no claim to watch.
 */
export const runPersonPublish = async (
  deps: PersonPublishDeps,
  verb: PublishRequestDetail['verb'],
): Promise<Omit<PublishResultDetail, 'id'>> => {
  // The draft being published, as it is NOW (the destination form is a wait): the publish reads it
  // before asking, and its record is the one that was asked to publish.
  const { compiled, deepLink, held } = await publishDraft({ ...deps, initiator: 'person' }, { label: 'Publish', verb })
  if (compiled.denial !== null) {
    return { deepLink: null, denial: compiled.denial }
  }
  if (!compiled.ops) {
    return { deepLink: null, denial: 'Not published — nothing was compiled to write.' }
  }
  const applied = await deps.apply(compiled.ops)
  if (!applied) {
    // apply answers null for two reasons it cannot tell apart here — the person declined the
    // confirm, or the set was refused before any write — and both mean the same thing to them.
    return { deepLink: null, denial: 'Not published — nothing was written: the confirm was declined, or the write was refused before it was sent.' }
  }
  if (applied.failure) {
    return { deepLink: null, denial: `Not published — the claim was refused: ${applied.failure}` }
  }
  if (compiled.claim) {
    deps.track(compiled.claim)
    // LANDED, so the draft's record says so — "published, awaiting merge", with where it went.
    if (held) { void deps.markPublished?.(held, compiled.claim, deepLink) }
  }
  return { deepLink, denial: null }
}
