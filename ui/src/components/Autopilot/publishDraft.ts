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
 * pick the destination and the seed. The controller is the third publisher here: one module, one
 * claim, whatever the builder, entered through `publishDraft`.
 *
 * EVERY PUBLISHER PUBLISHES A HELD DRAFT (frontend#429). The rail's legacy controller publish — the
 * last previewed RestDefinition plus the OpenAPI document attached in the rail (dispatchKogPublish) —
 * is gone: Autopilot starts and edits a controller draft through the Controller Builder's verbs
 * (controllerVerbs.ts) and publishes the held, previewed draft like a person does.
 */
import { builderRegistry, registryUnavailable } from '../../builders/builderRegistry'
import type { BuilderSpec, PublishBuilder } from '../../builders/builderSpec'
import { draftKindOf, draftKindPlugin } from '../../builders/draftKinds'
import type { Config } from '../../context/ConfigContext'
import { publishNameProblem } from '../../pages/BlueprintComposer/chartIdentity'
import { PROJECTION_BUNDLE_PATH, projectionForFiles } from '../../pages/BlueprintComposer/projectionCompile'
import { blueprintCompositionDefinition } from '../../pages/BlueprintComposer/startChart'
import { controllerCompositionDefinition } from '../../pages/ControllerComposer/controllerChart'

import type { PortalActionProposal } from './actionBridge'
import type { ApplyResourceSetOp } from './applyResourceSet'
import type { AuthorshipOrigin } from './authorship'
import { CHART_YAML_PATH, chartYamlVersion } from './blueprintDraft'
import { heldPublishFiles, type BlueprintDraftHeld, type BlueprintDraftStore } from './blueprintDraftStore'
import type { createBlueprintGate } from './blueprintGate'
import { buildClaimPublish } from './builderClaimPublish'
import type { PublishStatusClaim } from './builderPublishStatus'
import { builderTargetFor, builderTemplateUrl, type useBuilderTargets } from './builderTargets'
import { pageCompositionDefinition } from './pageDraft'
import type { PublishRequestDetail, PublishResultDetail } from './previewPublishRequest'
import { lintHeldDraft } from './proposedChart'
import { heldDraftIdentity, type PublishCompileResult } from './publishCompile'
import { askPublishDestination, type PublishInitiator, type PublishTargetRequest } from './publishTargetForm'
import type { AutopilotActionChip } from './types'
import type { DraftAutosave } from './useDraftAutosave'

export interface PublishDraftDeps {
  blueprintGate: ReturnType<typeof createBlueprintGate>
  blueprintStore: BlueprintDraftStore
  builderTargets: ReturnType<typeof useBuilderTargets>
  config: Config | undefined
  /** Authorship provenance stamped onto every op — who and what caused the write. */
  origin: AuthorshipOrigin
  /** Who asked for this publish — the destination form says so. Absent: the agent's verb. */
  initiator?: PublishInitiator
}

export interface PublishDraftOutcome {
  compiled: PublishCompileResult
  deepLink: string | null
  /** The held draft this publish was OF, read before the destination form waited — the record a landed claim marks published. */
  held?: BlueprintDraftHeld | null
}

/** Where the registration file is committed: the repo root, beside the chart it names. */
export const REGISTRATION_PATH = 'compositiondefinition.yaml'

/** A controller publish with no draft held — what to do instead, for the agent and a person alike. */
export const NOTHING_HELD_CONTROLLER = 'denied — no controller draft is open, so there is nothing to publish. Start one first (controllerStart, or Start in the Controller Builder), place its Kinds and settle every verb conflict, then preview it; publishRestDef publishes the held, previewed controller.'

/** The claim a publish writes, as the preview gate is asked about it before the destination form. */
const PUBLISH_PROBE: ApplyResourceSetOp = {
  gvr: { group: 'composition.krateo.io', resource: 'builderpublishes', version: 'v1alpha1' },
  namespace: 'krateo-system',
  payload: {},
  verb: 'POST',
}

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
  /*
   * A controller the Controller Builder composed (T8, frontend#412) — by a person, or by Autopilot
   * through the controller verbs (frontend#429): the HELD tree — its RestDefinitions and the ConfigMap
   * carrying the document they read — exactly like a blueprint, registered at publish with Chart.yaml's
   * version.
   */
  controller: {
    formKind: 'controller',
    projection: () => null,
    registration: (slug, owner, repo, files) => {
      const version = chartYamlVersion(files[CHART_YAML_PATH])
      return version ? controllerCompositionDefinition(slug, owner, repo, version, files) : null
    },
  },
  page: {
    formKind: 'page',
    projection: () => null,
    registration: (slug, owner, repo) => pageCompositionDefinition(slug, owner, repo),
  },
}

/**
 * The publishers this frontend RUNS: the held-draft ones (DRAFT_PUBLISHERS). A Builder naming any
 * other `publish.builder` publishes nothing here.
 */
const runsPublisher = (builder: PublishBuilder): boolean => DRAFT_PUBLISHERS[builder] !== undefined

/**
 * The verbs that PUBLISH — the frontend's own list, not the Builder's. A Builder's `verbs.allowed`
 * also carries its compose, chart and preview verbs; being allowed by a Builder says which builder a
 * verb belongs to, never that it publishes. Only a verb in this set AND in a Builder's allowed list is
 * that Builder's publish verb.
 */
export const PUBLISH_VERBS: ReadonlySet<string> = new Set(['publishPage', 'publishBlueprint', 'publishRestDef'])

/** The Builder whose `verbs.allowed` carries this PUBLISH verb, or undefined (not a publish verb, or none/several allow it). */
const builderOfVerb = (verb: string): BuilderSpec | undefined => {
  if (!PUBLISH_VERBS.has(verb)) { return undefined }
  const spec = builderRegistry.get({ verb })?.spec
  return spec?.verbs.allowed.includes(verb) ? spec : undefined
}

/**
 * The publisher a verb runs — the `spec.publish.builder` of the Builder that allows it — or null when
 * the verb publishes nothing. What the provider asks before it treats a proposal as a publish.
 */
export const publisherOfVerb = (verb: string): PublishBuilder | null => {
  if (!PUBLISH_VERBS.has(verb)) {
    return null
  }
  const declared = builderOfVerb(verb)?.publish.builder
  return declared && runsPublisher(declared) ? declared : null
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
    return denied(`denied — ${builderRegistry.verbProblem(proposal.verb) ?? registryUnavailable() ?? `no builder publishes a held draft with ${proposal.verb}`}`, held)
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
  // PREVIEW FIRST, said before anyone is asked where it goes — and in the held draft's own words. The
  // claim's gate would refuse it anyway, but only after the destination form, and with the blueprint's
  // preview verb whatever the draft was. The probe is the claim the publish would write.
  if (held && identity && !blueprintGate.evaluate([PUBLISH_PROBE], identity).allowed) {
    const previewVerb = builder.verbs.allowed.find((verb) => verb.startsWith('preview')) ?? 'Preview'
    return denied(`denied — preview first: ${kind.nouns.artifact} "${identity}" has not rendered since it last changed. Preview it (${previewVerb}) — a render with no problems arms publishing.`, held)
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
 * THE ONE PUBLISH ENTRY, for any builder's publish verb. The verb's publisher (publisherOfVerb)
 * decides, and every publisher publishes the HELD draft — the controller's included, whether a person
 * composed it or Autopilot did through the controller verbs (frontend#429).
 *
 * A controller publish with NOTHING held is refused before anything is asked: there is no other
 * source. (It used to fall back to the rail's last previewed RestDefinition and its attached OpenAPI
 * document — retired with the controller verbs.) The sentence tells the agent what to do instead.
 */
export const publishDraft = async (deps: PublishDraftDeps, proposal: PortalActionProposal): Promise<PublishDraftOutcome> => {
  if (publisherOfVerb(proposal.verb) === 'controller' && !deps.blueprintStore.get()) {
    return denied(NOTHING_HELD_CONTROLLER, null)
  }
  return runDraftPublish(deps, proposal)
}

/**
 * The NARRATED-PUBLISH recovery nudge: the person approved a publish, the model said so in prose and
 * emitted no publish fence, so nothing was proposed and no confirm opened. The nudge names the HELD
 * draft's own publish verb — the one its Builder allows — with its destination's prefills, so a held
 * controller is nudged to publishRestDef, never another builder's verb. Null when the held draft's
 * Builder publishes nothing this frontend runs.
 */
export const narratedPublishNudge = (held: BlueprintDraftHeld, heldName: string, targets: ReturnType<typeof useBuilderTargets>): string | null => {
  const builder = builderRegistry.get({ draftKind: held.kind })?.spec
  const verb = builder?.verbs.allowed.find((allowed) => PUBLISH_VERBS.has(allowed) && publisherOfVerb(allowed) !== null)
  if (!builder || !verb) {
    return null
  }
  const target = builderTargetFor(targets, builder.publish.targetKey)
  const scalarVerb = `{"verb":"${verb}","owner":"${target.owner}","repo":"${target.repo}","base":"main"}`
  return `You approved publishing \`${heldName}\` but your reply contained NO portal-action fence, so nothing was proposed and no confirm dialog opened. Do NOT say the user "will be asked to confirm" — EMITTING the fence is ITSELF what opens the blast-radius dialog. Re-issue the PUBLISH step NOW as a single fenced \`\`\`portal-action block containing ONLY this one scalar verb: ${scalarVerb}. The portal commits the held ${draftKindPlugin(builder.draftKind).nouns.short} as ONE publish claim — a branch with its files, and a change request for review — you do NOT write any of that yourself.`
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
