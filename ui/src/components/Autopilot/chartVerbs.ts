/**
 * The agent's verbs for a chart that is ALREADY OPEN in the Blueprint Composer (S5): chartPut and
 * chartDelete (a whole file) and chartLink (one dependency edge).
 *
 * WHY VERBS AND NOT A NEW previewBlueprint. previewBlueprint REPLACES the held tree, so to change one
 * template the agent had to hand back all of them — and anything the person had changed in the
 * composer since was silently overwritten by the agent's older copy. These verbs change one thing,
 * against the bytes held NOW.
 *
 * THE SAME PATHS A PERSON'S EDITS TAKE. Every write goes through the provider's atomic batch bus
 * (emitFilesBatch) with an `expect` of the bytes the verb read, so a write that raced a person's
 * edit is refused, not applied; every accepted write disarms publish until Preview renders the
 * chart again (render-gated, exactly as a person's edit). chartLink goes through planEdge — the
 * legality kernel and gate generator a drawn edge goes through — so the agent cannot declare an edge
 * a person could not draw, and gets the same refusal, with the same reason.
 *
 * DRAFT ONLY. Nothing here reaches the cluster or a repository: a verb edits the held draft in the
 * browser, and the person still previews and publishes it. A refusal is the chip's text, so the
 * model reads why in its own turn history.
 */
import { planEdge, type EdgeOp } from '../../pages/BlueprintComposer/planEdge'

import type { PortalActionProposal } from './actionBridge'
import { CHART_YAML_PATH, VALUES_SCHEMA_PATH } from './blueprintDraft'
import { type DraftChangedDetail, onDraftChanged, requestDraftReplay } from './previewDraftChanged'
import { emitFilesBatch } from './previewFilesBatch'
import type { AutopilotActionChip } from './types'

export const CHART_VERBS = new Set(['chartPut', 'chartDelete', 'chartLink'])

export const isChartVerb = (verb: string): boolean => CHART_VERBS.has(verb)

const ARCHITECTURE = 'templates/architecture.yaml'

/** The files a chart cannot do without — deleting one is refused by name. */
const REQUIRED: Record<string, string> = {
  [ARCHITECTURE]: 'it is the chart\'s descriptor — remove resources from it with chartPut instead',
  [CHART_YAML_PATH]: 'without it this is not a chart',
  [VALUES_SCHEMA_PATH]: 'it is the generated CRD\'s type — a chart without one can never be installed',
}

/** Paths the agent never writes: the portal writes them at publish. */
const PORTAL_OWNED: Record<string, string> = {
  'compositiondefinition.yaml': 'the portal writes the registration file when the chart is published',
}

const chip = (verb: string, label: string): AutopilotActionChip => ({ label, readOnly: true, verb })
const refusal = (verb: string, reason: string): AutopilotActionChip => chip(verb, `${verb} — this portal did not run it (${reason})`)

/**
 * The held draft, read synchronously: the replay request is answered on the draft-changed bus in the
 * same tick (useDraftFileBuses). Null when the provider is not mounted.
 */
export const readHeldDraft = (): DraftChangedDetail | null => {
  let held: DraftChangedDetail | null = null
  const stop = onDraftChanged((detail) => { held = detail })
  requestDraftReplay()
  stop()
  return held
}

/** A chart-relative path spelled the way the composer keys a tree, or why not. */
const pathProblem = (path: unknown): string | null => {
  if (typeof path !== 'string' || !path.trim()) { return 'a path is required' }
  if (path.startsWith('/') || path.split('/').some((segment) => segment === '' || segment === '.' || segment === '..')) {
    return `"${path}" is not a chart-relative path (no leading "/", no empty, "." or ".." segment)`
  }
  return null
}

const heldChart = (verb: string): { files: Record<string, string> } | AutopilotActionChip => {
  const held = readHeldDraft()
  if (!held || held.kind !== 'blueprint') {
    return refusal(verb, held?.kind === 'page' ? 'the open draft is a portal page, not a chart' : 'no chart is open — propose one with previewBlueprint first')
  }
  return { files: held.files }
}

const written = (verb: string, outcome: ReturnType<typeof emitFilesBatch>, label: string): AutopilotActionChip => {
  if (!outcome) { return refusal(verb, 'the composer is not reachable in this portal') }
  return outcome.ok ? chip(verb, `${label} — Preview needed before it can be published`) : refusal(verb, outcome.error)
}

const put = (proposal: PortalActionProposal): AutopilotActionChip => {
  const problem = pathProblem(proposal.path)
  if (problem) { return refusal('chartPut', problem) }
  if (typeof proposal.content !== 'string') { return refusal('chartPut', 'content must be the whole file, as text') }
  const path = proposal.path as string
  if (PORTAL_OWNED[path]) { return refusal('chartPut', PORTAL_OWNED[path]) }
  const held = heldChart('chartPut')
  if (!('files' in held)) { return held }
  const current = held.files[path]
  if (current === proposal.content) { return chip('chartPut', `${path} is already exactly that — nothing changed`) }
  const outcome = emitFilesBatch(current === undefined
    ? { add: { [path]: proposal.content }, kind: 'blueprint' }
    : { edit: { [path]: proposal.content }, expect: { [path]: current }, kind: 'blueprint' })
  return written('chartPut', outcome, current === undefined ? `Added ${path}` : `Rewrote ${path}`)
}

const remove = (proposal: PortalActionProposal): AutopilotActionChip => {
  const problem = pathProblem(proposal.path)
  if (problem) { return refusal('chartDelete', problem) }
  const path = proposal.path as string
  if (REQUIRED[path]) { return refusal('chartDelete', `${path} cannot be deleted: ${REQUIRED[path]}`) }
  const held = heldChart('chartDelete')
  if (!('files' in held)) { return held }
  if (held.files[path] === undefined) { return refusal('chartDelete', `${path} is not in the chart`) }
  return written('chartDelete', emitFilesBatch({ expect: { [path]: held.files[path] }, kind: 'blueprint', remove: [path] }), `Deleted ${path}`)
}

const link = (proposal: PortalActionProposal): AutopilotActionChip => {
  const { from, readyWhen, to } = proposal
  if (typeof from !== 'string' || !from || typeof to !== 'string' || !to) {
    return refusal('chartLink', 'an edge needs `from` (the dependent) and `to` (what it waits for), by node id')
  }
  if (readyWhen !== undefined && readyWhen !== null && typeof readyWhen !== 'string') { return refusal('chartLink', 'readyWhen must be text') }
  const held = heldChart('chartLink')
  if (!('files' in held)) { return held }
  const op: EdgeOp = proposal.unlink
    ? { from, op: 'remove', to }
    : { from, op: 'add', ready: proposal.ready === true, to, ...(typeof readyWhen === 'string' ? { readyWhen } : {}) }
  const plan = planEdge(held.files, op)
  if (!plan.ok) { return refusal('chartLink', plan.reason) }
  const label = proposal.unlink
    ? `Removed ${from} → ${to}`
    : `${from} now waits for ${to}${op.op === 'add' && op.ready ? ' to be ready' : ' to exist'}${plan.regated.length ? ` (also re-gates ${plan.regated.join(', ')})` : ''}`
  return written('chartLink', emitFilesBatch({ edit: plan.edit, expect: plan.expect, kind: 'blueprint' }), label)
}

/** Run a chart verb. Null for a verb that is not one. */
export const applyChartVerb = (proposal: PortalActionProposal): AutopilotActionChip | null => {
  switch (proposal.verb) {
    case 'chartPut': return put(proposal)
    case 'chartDelete': return remove(proposal)
    case 'chartLink': return link(proposal)
    default: return null
  }
}
