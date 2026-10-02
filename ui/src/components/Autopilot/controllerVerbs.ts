/**
 * The agent's verbs for a CONTROLLER draft (frontend#429) — Autopilot authoring a controller THROUGH
 * the Controller Builder, the way chartVerbs.ts lets it author a chart through the Blueprint Builder.
 *
 *   controllerStart            {name, apiGroup, baseUrl, specUrl | specText | specAttached, paths?}
 *   controllerPlace            {group}
 *   controllerMapVerb          {kind, restAction, method, path} | {kind, restAction, omit: true}
 *   controllerSetIdentifiers   {kind, identifiers: [...]}
 *   controllerSetStatusFields  {kind, statusFields: [...]}
 *   controllerRemoveKind       {kind}
 *   controllerBindId           {kind, param, field}                 (round 2: a path id's source, confirmed)
 *   controllerSetExcludedFields {kind, excludedFields: [...]}       (round 2: what spec leaves out)
 *   controllerSetItemsPath     {kind, itemsPath | null}             (round 2: a findby envelope's collection)
 *   controllerSetConfigurationFields {kind, configurationFields: [{name, in}]} (round 2: beyond auth)
 *
 * plus `previewRestDef` with no RestDefinition, which renders the HELD controller (previewHeldController,
 * reached from previewHandlers.ts), and `publishRestDef`, which publishes it (publishDraft.ts).
 *
 * THE SAME KERNELS A PERSON'S GESTURES TAKE. A start is the Start modal's: readSpec / readSpecUrl /
 * startController (the 8 MiB text cap, YAML aliases refused, every `servers` list rewritten to the base
 * URL, reserved API groups refused, the draft budget), sent on the chart-start bus the modal sends on,
 * so the provider holds it exactly as it holds a person's. Every edit is the inspector's or the
 * palette's plan (planPlaceGroup, planSetVerb, planToggleField, planRemoveKind), pinned to the bytes it
 * was read from and written as ONE files batch of the controller draft kind — and, like every write,
 * it turns Publish off until Preview renders the controller again. A locked field of a published
 * controller is refused with the sentence the inspector shows.
 *
 * NEVER RESOLVED FOR THE AGENT. A verb two operations both look like (findby on petstore's pet:
 * findByStatus and findByTags) is placed as a CONFLICT and stays one until a controllerMapVerb names
 * the operation, or leaves the verb out. Nothing here picks a candidate; the lint refuses to publish
 * while one is unsettled, and the envelope's `controller` summary names each one with its candidates.
 *
 * DRAFT ONLY. Nothing here reaches the apiserver or a repository: the verbs edit the held draft in the
 * browser, a preview renders it as the person (controller-render-draft over /call), and the publish
 * is the human-confirmed BuilderPublish claim every builder publishes through. A refusal is the chip's
 * text for the person and a `composeRefusals` entry on the next turn's envelope for the model.
 *
 * GATED BY THE BUILDER. A verb runs only when it is registered here as a draft verb (verbRegistry's
 * DRAFT_VERB_REGISTRY, deny-by-default) AND the held draft's Builder allows it (`verbs.allowed`).
 */
import { findBuilderOf } from '../../builders/builderRegistry'
import { draftKindOf } from '../../builders/draftKinds'
import {
  configurationCandidates,
  type ControllerKind,
  exclusionCandidates,
  type ControllerModel,
  type ControllerPlan,
  heldVerb,
  pathIdBindings,
  planBindPathParam,
  planPlaceGroup,
  planRemoveKind,
  planSetItemsPath,
  planSetVerb,
  planToggleConfigurationField,
  planToggleField,
  readController,
} from '../../pages/ControllerComposer/controllerChart'
import { readSpec, readSpecUrl, serverRewriteSentence, startController, type StartControllerInput } from '../../pages/ControllerComposer/controllerStart'
import { type RestAction, VERB_ORDER } from '../../pages/ControllerComposer/operationMapping'

import type { PortalActionProposal } from './actionBridge'
import { draftDisplayName } from './blueprintDraft'
import { readHeldDraft } from './chartVerbs'
import { recordChartOutcome } from './composeRequest'
import type { DraftChangedDetail } from './previewDraftChanged'
import {
  AGENT_RENDER_ID_PREFIX,
  type DraftRenderResultDetail,
  emitChartStart,
  emitDraftRenderRequest,
  onDraftRenderResult,
} from './previewDraftRender'
import { emitFilesBatch } from './previewFilesBatch'
import { lockedFor, publishedLocks } from './publishedLocks'
import type { AutopilotActionChip } from './types'
import { registerDraftVerb, type VerbDeps, type VerbSpec } from './verbRegistry'

export const CONTROLLER_VERBS = new Set([
  'controllerStart',
  'controllerPlace',
  'controllerMapVerb',
  'controllerSetIdentifiers',
  'controllerSetStatusFields',
  'controllerRemoveKind',
  'controllerBindId',
  'controllerSetExcludedFields',
  'controllerSetItemsPath',
  'controllerSetConfigurationFields',
])

export const isControllerVerb = (verb: string): boolean => CONTROLLER_VERBS.has(verb)

/** How long a start may take to be answered — the provider answers it in the same tick; this is "no provider". */
const START_TIMEOUT_MS = 4000
/** How long a preview may take — a render runs oasgen-render over /call. */
const RENDER_TIMEOUT_MS = 120_000

/** The one sentence every verb that needs a controller says when none is held. */
export const NO_CONTROLLER_HELD = 'no controller draft is open — start one with controllerStart (the OpenAPI document, its API group and the base URL the controller calls)'

const chip = (verb: string, label: string): AutopilotActionChip => ({ label, readOnly: true, verb })

/** A refusal: the chip the person reads, and the composeRefusals note the model reads next turn. */
const refuse = (verb: string, tried: string, reason: string): AutopilotActionChip => {
  recordChartOutcome(tried, reason)
  return { ...chip(verb, `${verb} — this portal did not run it (${reason})`), refused: true }
}

/** A verb that changed the draft: every held refusal was computed against the draft as it was. */
const done = (verb: string, tried: string, label: string): AutopilotActionChip => {
  recordChartOutcome(tried, null)
  return chip(verb, label)
}

const str = (value: unknown): string => (typeof value === 'string' ? value.trim() : '')

const listed = (items: readonly string[]): string => (items.length ? items.join(', ') : 'none')

// ── the held controller ─────────────────────────────────────────────────────────────────────────

interface HeldController {
  files: Record<string, string>
  model: ControllerModel
  /** What the published controller locks (publishedLocks), or null when it was never published. */
  locked: Record<string, Record<string, unknown>> | null
}

/**
 * Why the Controller Builder this portal runs does not allow `verb`, or null when it does. A verb a
 * Builder does not list in `verbs.allowed` is refused even though this frontend implements it — the
 * Builder CR on the cluster decides which verbs Autopilot may use.
 */
const verbNotAllowed = (verb: string): string | null => {
  const builder = findBuilderOf('controller')
  if (!builder) {
    return 'this portal runs no Controller Builder (none was listed from the cluster), so there is nothing to author a controller in'
  }
  return builder.verbs.allowed.includes(verb)
    ? null
    : `the Controller Builder on this cluster does not allow ${verb} — it is not in the Builder's verbs.allowed`
}

/**
 * The held controller a verb may edit, or why not: no draft at all, or a draft whose Builder does not
 * allow the verb (named by its draft-kind plugin as what it is).
 */
const heldController = (verb: string, held: DraftChangedDetail | null = readHeldDraft()): HeldController | string => {
  if (!held?.kind) {
    return NO_CONTROLLER_HELD
  }
  if (held.kind !== 'controller') {
    return `the open draft is ${draftKindOf(held.kind).nouns.artifact}, not a controller — ${verb} edits a controller draft`
  }
  const allowed = verbNotAllowed(verb)
  if (allowed) {
    return allowed
  }
  const model = readController(held.files)
  return { files: held.files, locked: lockedFor(publishedLocks.get(), held.kind, model.name), model }
}

/** The placed Kind a proposal names — by Kind (any case) or by its file — or why not. */
const kindNamed = (model: ControllerModel, raw: unknown): ControllerKind | string => {
  const name = str(raw)
  const placed = model.kinds.map((entry) => entry.kind)
  if (!name) {
    return `name the Kind by its kind (the Kinds placed: ${listed(placed)})`
  }
  const found = model.kinds.find((entry) => entry.kind === name || entry.path === name)
    ?? model.kinds.find((entry) => entry.kind.toLowerCase() === name.toLowerCase())
  return found ?? `${name} is not a placed Kind (the Kinds placed: ${listed(placed)}) — place its resource group with controllerPlace first`
}

/** Write a plan as one files batch of the controller draft — the composer's own write. */
const writePlan = (verb: string, tried: string, plan: ControllerPlan, label: string): AutopilotActionChip => {
  if (!plan.ok) {
    return refuse(verb, tried, plan.reason)
  }
  const outcome = emitFilesBatch({
    kind: 'controller',
    ...(plan.add ? { add: plan.add } : {}),
    ...(plan.edit ? { edit: plan.edit } : {}),
    ...(plan.remove ? { remove: plan.remove } : {}),
    ...(plan.expect ? { expect: plan.expect } : {}),
  })
  if (!outcome) {
    return refuse(verb, tried, 'the draft is not reachable in this portal, so nothing changed')
  }
  if (!outcome.ok) {
    return refuse(verb, tried, outcome.error)
  }
  return done(verb, tried, `${label} — Preview needed before it can be published`)
}

const operationLine = (entry: { method: string; path: string }): string => `${entry.method.toUpperCase()} ${entry.path}`

/** One line on a Kind as it now stands: its verbs, and what is still to settle. */
const kindLine = (files: Record<string, string>, path: string): string => {
  const entry = readController(files).kinds.find((kind) => kind.path === path)
  if (!entry) { return '' }
  const verbs = VERB_ORDER.flatMap((action) => {
    const set = heldVerb(entry.restDefinition, action)
    return set ? [`${action} ${operationLine(set)}`] : []
  })
  const conflicts = entry.conflicts.map((conflict) => `${conflict.action} is a conflict (${conflict.candidates.map(operationLine).join(' or ')}) — settle it with controllerMapVerb`)
  const ids = pathIdBindings(entry).map((binding) => (binding.confirm
    ? `{${binding.param}} is read from ${binding.field} but waits for a confirm (${binding.choices.join(' or ')}) — settle it with controllerBindId`
    : `{${binding.param}} is read from ${binding.field}`))
  return [`verbs: ${listed(verbs)}`, ...conflicts, ...ids].join('; ')
}

// ── start ───────────────────────────────────────────────────────────────────────────────────────

/** Ask the provider to hold these files as a new controller draft, and wait for its answer. */
const requestStart = (files: Record<string, string>): Promise<DraftRenderResultDetail> => new Promise((resolve) => {
  const id = `${AGENT_RENDER_ID_PREFIX}start-${Date.now()}-${Math.random().toString(36).slice(2)}`
  const sub: { stop?: () => void } = {}
  const timer = setTimeout(() => {
    sub.stop?.()
    resolve({ id, message: 'no Autopilot provider answered, so nothing was started', outcome: 'refused' })
  }, START_TIMEOUT_MS)
  sub.stop = onDraftRenderResult((detail) => {
    if (detail.id !== id) { return }
    clearTimeout(timer)
    sub.stop?.()
    resolve(detail)
  })
  emitChartStart({ files, id, kind: 'controller' })
})

type SpecSource = { text: string; from: string } | { problem: string }

/** The document a start reads: exactly one of a URL, the text itself, or the rail's attachment. */
const readSource = async (proposal: PortalActionProposal, deps: Pick<VerbDeps, 'readAttachedSpec'>): Promise<SpecSource> => {
  const url = str(proposal.specUrl)
  const text = typeof proposal.specText === 'string' ? proposal.specText : ''
  const attached = proposal.specAttached === true
  const given = [url !== '', text.trim() !== '', attached].filter(Boolean).length
  if (given !== 1) {
    return { problem: 'name exactly one source for the OpenAPI document: specUrl (an http(s) URL the browser reads as nobody), specText (the document itself), or specAttached: true (the document the person attached in the rail)' }
  }
  if (attached) {
    const held = deps.readAttachedSpec?.() ?? null
    return held ? { from: 'the document attached in the rail', text: held } : { problem: 'no OpenAPI document is attached in the rail — ask the person to paste it there, or start from a URL' }
  }
  if (url) {
    if (!/^https?:\/\//.test(url)) {
      return { problem: 'specUrl must be an absolute http(s) URL' }
    }
    const read = await readSpecUrl(url)
    return 'text' in read ? { from: url, text: read.text } : { problem: read.problem }
  }
  return { from: 'the document given', text }
}

const startVerb = async (proposal: PortalActionProposal, deps: Pick<VerbDeps, 'readAttachedSpec'>): Promise<AutopilotActionChip> => {
  const verb = 'controllerStart'
  const name = str(proposal.name)
  const tried = `start controller ${name || '(unnamed)'}`
  const notAllowed = verbNotAllowed(verb)
  if (notAllowed) {
    return refuse(verb, tried, notAllowed)
  }
  // Same precondition as the modal's empty page: a start never discards a held draft.
  const held = readHeldDraft()
  if (held?.kind) {
    return refuse(verb, tried, `a draft is already open (${draftKindOf(held.kind).nouns.artifact} ${draftDisplayName(held.files)}) — it must be published or discarded by the person before another is started`)
  }
  const source = await readSource(proposal, deps)
  if ('problem' in source) {
    return refuse(verb, tried, source.problem)
  }
  const paths = Array.isArray(proposal.paths) ? proposal.paths.filter((path): path is string => typeof path === 'string') : null
  const input: StartControllerInput = { apiGroup: str(proposal.apiGroup), baseUrl: str(proposal.baseUrl), name, paths, spec: source.text }
  const reading = readSpec(input.spec, input.baseUrl)
  const started = startController(input, reading)
  if (!started.ok) {
    return refuse(verb, tried, started.problems.map((problem) => `${problem.field}: ${problem.message}`).join(' '))
  }
  const answer = await requestStart(started.files)
  if (answer.outcome === 'refused') {
    return refuse(verb, tried, [answer.message, ...(answer.problems ?? [])].filter(Boolean).join(' '))
  }
  const groups = reading.oas ? [...new Set(readController(started.files).spec?.oas.operations.map((operation) => operation.group) ?? [])].sort() : []
  const rewritten = reading.oas ? serverRewriteSentence(reading.oas.doc, input.baseUrl) : null
  return done(
    verb,
    tried,
    `Started controller ${name} (Kinds served in ${input.apiGroup}, requests sent to ${input.baseUrl}) from ${source.from}. Resource groups to place: ${listed(groups)}.${rewritten ? ` ${rewritten}` : ''}`,
  )
}

// ── edits ───────────────────────────────────────────────────────────────────────────────────────

const placeVerb = (proposal: PortalActionProposal): AutopilotActionChip => {
  const verb = 'controllerPlace'
  const group = str(proposal.group)
  const tried = `place ${group || '(no group)'}`
  const held = heldController(verb)
  if (typeof held === 'string') { return refuse(verb, tried, held) }
  if (!group) {
    const groups = [...new Set(held.model.spec?.oas.operations.map((operation) => operation.group) ?? [])].sort()
    return refuse(verb, tried, `name the resource group to place (the document's: ${listed(groups)})`)
  }
  const plan = planPlaceGroup(held.files, group)
  if (!plan.ok) {
    return writePlan(verb, tried, plan, '')
  }
  const after = { ...held.files, ...(plan.add ?? {}) }
  const placed = readController(after).kinds.find((entry) => entry.path === plan.path)
  return writePlan(verb, tried, plan, `Placed ${group} as ${placed?.kind ?? 'a Kind'} (${plan.path}) — ${kindLine(after, plan.path)}`)
}

const isRestAction = (value: unknown): value is RestAction => typeof value === 'string' && (VERB_ORDER as readonly string[]).includes(value)

const mapVerb = (proposal: PortalActionProposal): AutopilotActionChip => {
  const verb = 'controllerMapVerb'
  const action = proposal.restAction
  const omit = proposal.omit === true
  const method = str(proposal.method).toUpperCase()
  const path = str(proposal.path)
  const tried = omit
    ? `leave ${String(action)} out of ${String(proposal.kind)}`
    : `map ${String(proposal.kind)} ${String(action)} to ${method || '?'} ${path || '?'}`
  if (!isRestAction(action)) {
    return refuse(verb, tried, `restAction must be one of ${VERB_ORDER.join(', ')}`)
  }
  if (omit === Boolean(method || path)) {
    return refuse(verb, tried, 'name the operation (method and path) the verb maps to, or set omit: true to leave the verb out — exactly one of the two')
  }
  if (!omit && (!method || !path)) {
    return refuse(verb, tried, 'a mapping needs both the method and the path of one operation of the document')
  }
  const held = heldController(verb)
  if (typeof held === 'string') { return refuse(verb, tried, held) }
  const kind = kindNamed(held.model, proposal.kind)
  if (typeof kind === 'string') { return refuse(verb, tried, kind) }
  const plan = planSetVerb(held.files, kind.path, action, omit ? null : { method, path }, held.locked)
  const after = plan.ok ? { ...held.files, ...(plan.edit ?? {}) } : held.files
  const label = omit ? `Left ${action} out of ${kind.kind}` : `${kind.kind} ${action} is ${method} ${path}`
  return writePlan(verb, tried, plan, plan.ok ? `${label} — ${kindLine(after, kind.path)}` : label)
}

type FieldList = 'identifiers' | 'additionalStatusFields' | 'excludedSpecFields'

const currentList = (kind: ControllerKind, list: FieldList): string[] => {
  const value = (kind.restDefinition.spec as { resource?: Record<string, unknown> } | undefined)?.resource?.[list]
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string' && entry.length > 0) : []
}

/**
 * Set a field list to exactly `wanted`, as the inspector's toggles would get there — each toggle the
 * inspector's own plan (planToggleField, locks and all), chained over the bytes the last one left,
 * then written as ONE batch pinned to the bytes the first one read.
 */
const planSetList = (held: HeldController, kind: ControllerKind, list: FieldList, wanted: string[]): ControllerPlan | null => {
  const current = currentList(kind, list)
  const toggles = [...current.filter((field) => !wanted.includes(field)), ...wanted.filter((field) => !current.includes(field))]
  if (!toggles.length) { return null }
  let { files } = held
  for (const field of toggles) {
    const plan = planToggleField(files, kind.path, list, field, held.locked)
    if (!plan.ok) { return plan }
    files = { ...files, ...(plan.edit ?? {}) }
  }
  return { edit: { [kind.path]: files[kind.path] }, expect: { [kind.path]: held.files[kind.path] }, ok: true, path: kind.path }
}

const setListVerb = (proposal: PortalActionProposal, verb: 'controllerSetIdentifiers' | 'controllerSetStatusFields'): AutopilotActionChip => {
  const list: FieldList = verb === 'controllerSetIdentifiers' ? 'identifiers' : 'additionalStatusFields'
  const raw = verb === 'controllerSetIdentifiers' ? proposal.identifiers : proposal.statusFields
  const argument = verb === 'controllerSetIdentifiers' ? 'identifiers' : 'statusFields'
  const noun = verb === 'controllerSetIdentifiers' ? 'identifiers' : 'status fields'
  const tried = `set ${String(proposal.kind)} ${noun}`
  if (!Array.isArray(raw) || raw.some((field) => typeof field !== 'string' || !field.trim())) {
    return refuse(verb, tried, `${argument} must be the whole list, as field names (an empty list clears it)`)
  }
  const wanted = [...new Set(raw.map((field: string) => field.trim()))]
  if (list === 'identifiers' && !wanted.length) {
    return refuse(verb, tried, 'a Kind needs at least one identifier — the field the controller finds an existing resource by')
  }
  const held = heldController(verb)
  if (typeof held === 'string') { return refuse(verb, tried, held) }
  const kind = kindNamed(held.model, proposal.kind)
  if (typeof kind === 'string') { return refuse(verb, tried, kind) }
  const plan = planSetList(held, kind, list, wanted)
  if (!plan) {
    return done(verb, tried, `${kind.kind} ${noun} are already ${listed(wanted)} — nothing changed`)
  }
  const candidates = (list === 'identifiers' ? kind.inference?.identifierCandidates : kind.inference?.statusFieldCandidates)?.map((candidate) => candidate.field) ?? []
  const unusual = wanted.filter((field) => candidates.length && !candidates.includes(field))
  return writePlan(verb, tried, plan, `${kind.kind} ${noun}: ${listed(wanted)}${unusual.length ? ` (not among the document's candidates: ${unusual.join(', ')})` : ''}`)
}

const removeVerb = (proposal: PortalActionProposal): AutopilotActionChip => {
  const verb = 'controllerRemoveKind'
  const tried = `remove ${String(proposal.kind)}`
  const held = heldController(verb)
  if (typeof held === 'string') { return refuse(verb, tried, held) }
  const kind = kindNamed(held.model, proposal.kind)
  if (typeof kind === 'string') { return refuse(verb, tried, kind) }
  if (held.locked?.[kind.path]) {
    return refuse(verb, tried, `${kind.kind} was published — removing it would delete every ${kind.kind} it serves once the release installs; only the person can decide that, in the composer`)
  }
  return writePlan(verb, tried, planRemoveKind(held.files, kind.path), `Removed ${kind.kind} (${kind.path}); its resource group ${kind.group} can be placed again`)
}

// ── round 2: ids, excluded fields, itemsPath, configuration ─────────────────────────────────────────

/**
 * controllerBindId {kind, param, field} — the inspector's Path ids: read a path parameter from `field`
 * (`status.metadata.id`, `spec.name`) on every verb that carries it, and CONFIRM the binding. The only
 * way an ambiguous id (`{keyId}`: keyId or id) or a segment named two ways is settled — the lint holds
 * Publish until then, for the agent as for the person.
 */
const bindIdVerb = (proposal: PortalActionProposal): AutopilotActionChip => {
  const verb = 'controllerBindId'
  const param = str(proposal.param).replace(/^\{|\}$/g, '')
  const field = str(proposal.field)
  const tried = `bind ${String(proposal.kind)} {${param || '?'}} to ${field || '?'}`
  if (!param || !field) {
    return refuse(verb, tried, 'name the path parameter (param) and the field it is read from (field: status.<field> or spec.<field>)')
  }
  const held = heldController(verb)
  if (typeof held === 'string') { return refuse(verb, tried, held) }
  const kind = kindNamed(held.model, proposal.kind)
  if (typeof kind === 'string') { return refuse(verb, tried, kind) }
  const plan = planBindPathParam(held.files, kind.path, param, field, held.locked)
  const after = plan.ok ? { ...held.files, ...(plan.edit ?? {}) } : held.files
  return writePlan(verb, tried, plan, plan.ok ? `${kind.kind} reads {${param}} from ${field} (confirmed) — ${kindLine(after, kind.path)}` : '')
}

/**
 * controllerSetExcludedFields {kind, excludedFields: [...]} — the WHOLE list of fields the generated spec
 * leaves out, as the inspector's toggles would get there (each its own plan, locks and all).
 */
const setExcludedVerb = (proposal: PortalActionProposal): AutopilotActionChip => {
  const verb = 'controllerSetExcludedFields'
  const tried = `set ${String(proposal.kind)} excluded spec fields`
  const raw = proposal.excludedFields
  if (!Array.isArray(raw) || raw.some((field) => typeof field !== 'string' || !field.trim())) {
    return refuse(verb, tried, 'excludedFields must be the whole list, as field names (an empty list clears it)')
  }
  const wanted = [...new Set(raw.map((field: string) => field.trim()))]
  const held = heldController(verb)
  if (typeof held === 'string') { return refuse(verb, tried, held) }
  const kind = kindNamed(held.model, proposal.kind)
  if (typeof kind === 'string') { return refuse(verb, tried, kind) }
  // The inspector's own candidates (a field already excluded may stay, or be dropped): nothing else.
  const offered = exclusionCandidates(kind, held.model).map((candidate) => candidate.field)
  const current = currentList(kind, 'excludedSpecFields')
  const unknown = wanted.filter((field) => !offered.includes(field) && !current.includes(field))
  if (unknown.length) {
    return refuse(verb, tried, `${unknown.join(', ')} is not a field ${kind.kind}'s spec could leave out — the candidates are what a status binding reads, the path parameters read from status, and what create sends: ${listed(offered)}`)
  }
  const plan = planSetList(held, kind, 'excludedSpecFields', wanted)
  if (!plan) {
    return done(verb, tried, `${kind.kind} excluded spec fields are already ${listed(wanted)} — nothing changed`)
  }
  return writePlan(verb, tried, plan, `${kind.kind} spec leaves out: ${listed(wanted)}`)
}

/** controllerSetItemsPath {kind, itemsPath | null} — name the findby envelope's collection (`.data`), or clear it. */
const setItemsPathVerb = (proposal: PortalActionProposal): AutopilotActionChip => {
  const verb = 'controllerSetItemsPath'
  const itemsPath = proposal.itemsPath === null ? null : str(proposal.itemsPath)
  const tried = `set ${String(proposal.kind)} findby itemsPath to ${itemsPath ?? 'nothing'}`
  if (itemsPath === '') {
    return refuse(verb, tried, 'name the envelope property holding the collection (itemsPath: ".data"), or itemsPath: null to clear it')
  }
  const held = heldController(verb)
  if (typeof held === 'string') { return refuse(verb, tried, held) }
  const kind = kindNamed(held.model, proposal.kind)
  if (typeof kind === 'string') { return refuse(verb, tried, kind) }
  const plan = planSetItemsPath(held.files, kind.path, itemsPath, held.locked)
  const after = plan.ok ? { ...held.files, ...(plan.edit ?? {}) } : held.files
  return writePlan(verb, tried, plan, plan.ok ? `${kind.kind} findby itemsPath: ${itemsPath ?? 'cleared'} — ${kindLine(after, kind.path)}` : '')
}

/**
 * controllerSetConfigurationFields {kind, configurationFields: [{name, in}]} — the WHOLE list of header /
 * query parameters read from the <Kind>Configuration instead of every resource's spec. Each must be a
 * parameter of the Kind's verbs (configurationCandidates), and takes the verbs the inspector would give
 * it (`*` when every verb carries it) — the agent names parameters, never actions.
 */
const setConfigurationVerb = (proposal: PortalActionProposal): AutopilotActionChip => {
  const verb = 'controllerSetConfigurationFields'
  const tried = `set ${String(proposal.kind)} configuration fields`
  const raw = proposal.configurationFields
  const valid = Array.isArray(raw) && raw.every((entry) => typeof entry === 'object' && entry !== null && typeof (entry as { name?: unknown }).name === 'string' && typeof (entry as { in?: unknown }).in === 'string')
  if (!valid) {
    return refuse(verb, tried, 'configurationFields must be the whole list, as [{name, in}] (in: header or query); an empty list clears it')
  }
  const held = heldController(verb)
  if (typeof held === 'string') { return refuse(verb, tried, held) }
  const kind = kindNamed(held.model, proposal.kind)
  if (typeof kind === 'string') { return refuse(verb, tried, kind) }
  const candidates = configurationCandidates(held.model, kind)
  const wanted = (raw as { name: string; in: string }[]).map((entry) => ({ in: entry.in.trim(), name: entry.name.trim() }))
  const unknown = wanted.filter((entry) => !candidates.some((candidate) => candidate.name === entry.name && candidate.in === entry.in))
  if (unknown.length) {
    return refuse(verb, tried, `${unknown.map((entry) => `${entry.name} (${entry.in})`).join(', ')} is not a header or query parameter of ${kind.kind}'s verbs (its parameters: ${listed(candidates.map((entry) => `${entry.name} (${entry.in})`))})`)
  }
  const resource = (kind.restDefinition.spec as { resource?: Record<string, unknown> } | undefined)?.resource ?? {}
  const current = (Array.isArray(resource.configurationFields) ? resource.configurationFields : [])
    .map((entry) => (entry as { fromOpenAPI?: { name?: string; in?: string } }).fromOpenAPI ?? {})
  const same = (left: { name?: string; in?: string }, right: { name?: string; in?: string }) => left.name === right.name && left.in === right.in
  const toggles = [
    ...current.filter((entry) => !wanted.some((want) => same(want, entry))),
    ...wanted.filter((entry) => !current.some((have) => same(have, entry))),
  ]
  if (!toggles.length) {
    return done(verb, tried, `${kind.kind} configuration fields are already ${listed(wanted.map((entry) => entry.name))} — nothing changed`)
  }
  let { files } = held
  for (const toggle of toggles) {
    const candidate = candidates.find((entry) => same(entry, toggle))
    const plan = planToggleConfigurationField(files, kind.path, { actions: candidate?.actions ?? ['*'], in: String(toggle.in), name: String(toggle.name) }, held.locked)
    if (!plan.ok) { return writePlan(verb, tried, plan, '') }
    files = { ...files, ...(plan.edit ?? {}) }
  }
  const plan: ControllerPlan = { edit: { [kind.path]: files[kind.path] }, expect: { [kind.path]: held.files[kind.path] }, ok: true, path: kind.path }
  return writePlan(verb, tried, plan, `${kind.kind} reads ${listed(wanted.map((entry) => `${entry.name} (${entry.in})`))} from its Configuration`)
}

// ── preview ─────────────────────────────────────────────────────────────────────────────────────

/** Ask the provider to render the held draft, and wait for its answer. */
const requestRender = (timeoutMs = RENDER_TIMEOUT_MS): Promise<DraftRenderResultDetail> => new Promise((resolve) => {
  const id = `${AGENT_RENDER_ID_PREFIX}${Date.now()}-${Math.random().toString(36).slice(2)}`
  const sub: { stop?: () => void } = {}
  const timer = setTimeout(() => {
    sub.stop?.()
    resolve({ id, message: 'the preview did not answer in time — preview again', outcome: 'stale' })
  }, timeoutMs)
  sub.stop = onDraftRenderResult((detail) => {
    if (detail.id !== id) { return }
    clearTimeout(timer)
    sub.stop?.()
    resolve(detail)
  })
  emitDraftRenderRequest({ id })
})

/**
 * `previewRestDef` of the HELD controller — the composer's Preview, exactly: the provider lints it,
 * renders it through the Builder's controller-render-draft over /call as the person, and arms Publish
 * only for a render with CRDs and zero problems. A mounted composer shows the render (useChartRequests
 * adopts an agent render's payload); the chip and the envelope tell the model how it went.
 */
export const previewHeldController = async (held: DraftChangedDetail | null = readHeldDraft()): Promise<AutopilotActionChip> => {
  const verb = 'previewRestDef'
  const controller = heldController(verb, held)
  const name = held ? draftDisplayName(held.files) : 'the controller'
  const tried = `preview ${name}`
  if (typeof controller === 'string') { return refuse(verb, tried, controller) }
  const answer = await requestRender()
  const problems = answer.problems?.length ? ` Problems: ${answer.problems.join('; ')}` : ''
  if (answer.outcome === 'rendered') {
    const kinds = controller.model.kinds.map((entry) => entry.kind)
    return done(verb, tried, `Previewed ${name} — oasgen-render generated ${listed(kinds)}; Publish is armed (publishRestDef)`)
  }
  return refuse(verb, tried, `${answer.message ?? 'the preview did not render'}${problems}`)
}

/** True when a held draft is a controller — previewRestDef then renders it. */
export const holdsController = (held: DraftChangedDetail | null = readHeldDraft()): boolean => held?.kind === 'controller'

// ── registration ────────────────────────────────────────────────────────────────────────────────

const draftVerb = (name: string, apply: VerbSpec['apply']): VerbSpec => ({
  apply,
  // Every argument problem is a refusal with a reason (and a composeRefusals note), never a silent null.
  argSchema: () => true,
  name,
  sideEffect: 'draft',
})

registerDraftVerb(draftVerb('controllerStart', (proposal, deps) => startVerb(proposal, deps)))
registerDraftVerb(draftVerb('controllerPlace', (proposal) => Promise.resolve(placeVerb(proposal))))
registerDraftVerb(draftVerb('controllerMapVerb', (proposal) => Promise.resolve(mapVerb(proposal))))
registerDraftVerb(draftVerb('controllerSetIdentifiers', (proposal) => Promise.resolve(setListVerb(proposal, 'controllerSetIdentifiers'))))
registerDraftVerb(draftVerb('controllerSetStatusFields', (proposal) => Promise.resolve(setListVerb(proposal, 'controllerSetStatusFields'))))
registerDraftVerb(draftVerb('controllerRemoveKind', (proposal) => Promise.resolve(removeVerb(proposal))))
registerDraftVerb(draftVerb('controllerBindId', (proposal) => Promise.resolve(bindIdVerb(proposal))))
registerDraftVerb(draftVerb('controllerSetExcludedFields', (proposal) => Promise.resolve(setExcludedVerb(proposal))))
registerDraftVerb(draftVerb('controllerSetItemsPath', (proposal) => Promise.resolve(setItemsPathVerb(proposal))))
registerDraftVerb(draftVerb('controllerSetConfigurationFields', (proposal) => Promise.resolve(setConfigurationVerb(proposal))))
