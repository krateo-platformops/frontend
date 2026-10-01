/**
 * WHAT THE AGENT CAN SEE OF THE DRAFT IT IS RESTRUCTURING.
 *
 * `composeMove` / `composeAdd` name a widget and a container by CR name. Until now nothing told the
 * model what those names were. The page-context envelope reports the live widget cache — what the
 * BROWSER rendered — and the held draft is not in it: it lives in the composer's store, so a page
 * under construction showed up as its rendered preview at best and as nothing at all before the
 * first render. The model was naming handles it had never been shown.
 *
 * That is one half of why proposals were refused. The other half — that a refusal was discarded at
 * the bus boundary — is fixed in `composeRequest`. They are complementary and the order matters:
 * seeing the draft removes the guess, hearing the refusal recovers from the guesses that remain.
 *
 * AMBIENT, NOT A VERB. This rides the envelope the provider already sends every turn rather than
 * being something the agent must ask for. A read verb would cost a round trip to learn what the
 * portal could simply have said, and the model would have to know to ask — which is precisely the
 * knowledge it does not have before it has looked. The collector's own stance, snapshot at send
 * time, applies unchanged.
 *
 * DERIVED, NEVER STORED. `buildObjectTree` is the composer's parser and stays the only one. A
 * second parse here would be a second opinion about what a draft contains, and the two would drift
 * the moment either changed — the same argument that keeps `planMove`/`planAdd` the one kernel for
 * a drag and a proposal alike.
 */
import { findBuilderOf } from '../../builders/builderRegistry'
import { heldVerb, readController } from '../../pages/ControllerComposer/controllerChart'
import { VERB_ORDER } from '../../pages/ControllerComposer/operationMapping'
import { buildObjectTree, flattenTree, listDataSources } from '../../pages/PageComposer/objectTree'
import type { TreeNode } from '../../pages/PageComposer/objectTree'

import { CHART_YAML_PATH, chartYamlName, VALUES_SCHEMA_PATH } from './blueprintDraft'
import type { BlueprintDraftHeld } from './blueprintDraftStore'
import { lintHeldDraft } from './proposedChart'
import { lockedFor, publishedLocks } from './publishedLocks'
import { redactValue } from './redact'
import type { ChartDraftSummary, ControllerDraftSummary, ControllerKindSummary, DraftNodeSummary, DraftSummary, PageContextEnvelope } from './types'

/**
 * Cap on the nodes described. A hand-built page is a dozen nodes and a generated one rarely more;
 * this exists so a pathological draft cannot crowd the widget inventory out of the envelope. When
 * it bites, the summary says so rather than silently presenting a truncation as the whole page.
 */
const MAX_NODES = 80

/**
 * Cap on the RESTActions listed — its OWN budget, not MAX_NODES. A RESTAction is not a node of the
 * tree (the tree is layout), so a page at the node cap must still say which data sources back it,
 * and an orphan must still be visible. A page carries a handful; past the cap the summary says so.
 */
const MAX_DATA_SOURCES = 20

/**
 * Summarize depth-first against a shared budget.
 *
 * The budget is over NODES, not roots. Capping the root list instead would describe a page whose
 * whole structure hangs off one Flex — the normal shape — in full while still reporting it as
 * truncated: a false statement about the summary in the same breath as the summary.
 */
const summarizeNodes = (nodes: readonly TreeNode[], budget: { left: number }): DraftNodeSummary[] => {
  const out: DraftNodeSummary[] = []
  for (const node of nodes) {
    if (budget.left <= 0) {
      break
    }
    budget.left -= 1
    const children = summarizeNodes(node.children, budget)
    out.push({
      // ONLY AN AUTHORED LIST IS REPORTED AS A CONSTRAINT.
      //
      // `placeChild` appends each child's plural because the CRD requires it, so a container the
      // composer created carries a non-empty list that describes what it HOLDS rather than what it
      // MAY hold — and `canAccept` stopped treating those as rules. If they were still reported
      // here the model would route around a constraint that is no longer enforced: it would decline
      // to place a Card in a page whose list happens to read `[rows]`, and explain that decision to
      // the user, while a person dragging the same Card would succeed. A fence the agent believes
      // and the canvas does not is worse than no fence.
      ...(!node.allowedDerived && node.allowedResources?.length ? { allows: node.allowedResources } : {}),
      ...(children.length ? { children } : {}),
      ...(node.drafted ? {} : { external: true as const }),
      ...(node.dataSource ? { dataSource: node.dataSource } : {}),
      kind: node.kind,
      name: node.name,
      ...(node.resource ? { resource: node.resource } : {}),
    })
  }
  return out
}

/**
 * Whether the held draft's Builder names this summarizer (`spec.summarizer.plugin`). Each summarizer
 * describes only the drafts whose Builder chose it: a chart's files are templates rather than widget
 * CRs, and `buildObjectTree` would find no containment in them — an empty tree reads as "your draft is
 * empty", which is worse than saying nothing.
 */
const namedBy = (plugin: string, held: BlueprintDraftHeld | null): held is BlueprintDraftHeld =>
  held !== null && findBuilderOf(held.kind)?.summarizer?.plugin === plugin

/**
 * `page-tree` — the structural summary of a held draft whose Builder names it (the Portal Builder's
 * page), or undefined when there is nothing to describe.
 */
export const summarizeDraft = (held: BlueprintDraftHeld | null): DraftSummary | undefined => {
  if (!namedBy('page-tree', held)) {
    return undefined
  }
  const roots = buildObjectTree(held.files)
  const dataSources = listDataSources(held.files)
  if (!roots.length && !dataSources.length) {
    return undefined
  }
  const budget = { left: MAX_NODES }
  const described = summarizeNodes(roots, budget)
  return {
    files: Object.keys(held.files).length,
    roots: described,
    // Compare against what the draft ACTUALLY holds, so the flag tracks what was cut rather than
    // how the budget happened to be spent.
    ...(flattenTree(roots).length > MAX_NODES ? { truncated: true as const } : {}),
    // RESTActions are not in `roots` (they are data, not layout). Listed here, orphans included, so
    // the model still sees which data source backs a widget and that an unread one exists.
    ...(dataSources.length ? { dataSources: dataSources.slice(0, MAX_DATA_SOURCES) } : {}),
    ...(dataSources.length > MAX_DATA_SOURCES ? { dataSourcesTruncated: true as const } : {}),
  }
}

/**
 * Budget for the chart's bytes on the envelope. A composer-built chart is a few KiB a file; this
 * keeps a large imported one from crowding everything else out. What does not fit is NAMED as
 * withheld — never silently dropped, which would read as "the chart has no such file".
 */
const MAX_CHART_BYTES = 96 * 1024

const READING_ORDER = [CHART_YAML_PATH, 'templates/architecture.yaml', VALUES_SCHEMA_PATH, 'values.yaml']

/**
 * `chart-files` — the held CHART, for the agent that edits it with chartPut / chartDelete / chartLink.
 * Undefined unless the held draft's Builder names this summarizer (the Blueprint Builder's chart).
 *
 * AN ARRAY, NOT A PATH-KEYED MAP. The redactor replaces the value of every key that CONTAINS a
 * credential word, so `{"templates/username-secret.yaml": …}` would reach the model as
 * "[redacted]" — a file that looks empty, and a whole-file rewrite that would write that back.
 * And a file whose CONTENT the redactor would change (a JWT, a long base64 run) is withheld, not
 * sent altered, for the same reason: the model must only ever rewrite bytes it was shown exactly.
 */
export const summarizeChart = (held: BlueprintDraftHeld | null): ChartDraftSummary | undefined => {
  if (!namedBy('chart-files', held)) {
    return undefined
  }
  const paths = Object.keys(held.files).sort((left, right) => {
    const rank = (path: string) => (READING_ORDER.includes(path) ? READING_ORDER.indexOf(path) : READING_ORDER.length)
    return rank(left) - rank(right) || left.localeCompare(right)
  })
  const files: ChartDraftSummary['files'] = []
  const withheld: NonNullable<ChartDraftSummary['withheld']> = []
  let budget = MAX_CHART_BYTES
  for (const path of paths) {
    const content = held.files[path]
    if (redactValue(content) !== content) {
      withheld.push({ path, reason: 'it holds a value shaped like a credential, which the portal never sends' })
    } else if (content.length > budget) {
      withheld.push({ path, reason: 'the chart is larger than the context budget' })
    } else {
      budget -= content.length
      files.push({ content, path })
    }
  }
  return { files, name: chartYamlName(held.files[CHART_YAML_PATH]), ...(withheld.length ? { withheld } : {}) }
}

/** What the provider knows about the held draft that its files do not say. */
export interface HeldDraftState {
  /** Whether the gate is armed for it — its last preview stands. Absent: not reported. */
  previewed?: boolean
}

/** Budgets for the controller summary — what does not fit is said to be cut, never silently dropped. */
const MAX_GROUPS = 40
const MAX_OPERATIONS_PER_GROUP = 16
const MAX_PROBLEMS = 15

const names = (value: unknown): string[] => (Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [])

/**
 * `controller-model` — the HELD CONTROLLER, for the agent that edits it with the controller verbs
 * (controllerVerbs.ts). Undefined unless the held draft's Builder names this summarizer.
 *
 * DERIVED FROM THE FILES, by the composer's own reader (readController) and the publish lint
 * (lintHeldDraft) — the same model the palette, canvas and inspector draw, so the agent and the person
 * are told the same thing. NO FILE BYTES: the agent edits a controller by naming groups, Kinds, verbs
 * and operations, never by rewriting a file, so the document (which can be hundreds of KiB) never
 * rides the envelope; its resource groups and operations do, within a budget. Every value is a name, a
 * method and a path, or a lint sentence — and the redactor still runs over all of it last.
 */
export const summarizeController = (held: BlueprintDraftHeld | null, state: HeldDraftState = {}): ControllerDraftSummary | undefined => {
  if (!namedBy('controller-model', held)) {
    return undefined
  }
  const model = readController(held.files)
  const locked = lockedFor(publishedLocks.get(), held.kind, model.name)
  const operations = model.spec?.oas.operations ?? []
  const groupNames = [...new Set(operations.map((operation) => operation.group))].sort()
  const groups = groupNames.slice(0, MAX_GROUPS).map((group) => {
    const keys = operations.filter((operation) => operation.group === group).map((operation) => operation.key)
    const placedAs = model.kinds.find((entry) => entry.group === group)?.kind
    return {
      group,
      operations: keys.slice(0, MAX_OPERATIONS_PER_GROUP),
      ...(placedAs ? { placedAs } : {}),
      ...(keys.length > MAX_OPERATIONS_PER_GROUP ? { more: keys.length - MAX_OPERATIONS_PER_GROUP } : {}),
    }
  })
  const kinds = model.kinds.map((entry): ControllerKindSummary => {
    const resource = (entry.restDefinition.spec as { resource?: Record<string, unknown> } | undefined)?.resource ?? {}
    const statusFields = names(resource.additionalStatusFields)
    const identifierCandidates = entry.inference?.identifierCandidates.map((candidate) => candidate.field) ?? []
    const statusFieldCandidates = entry.inference?.statusFieldCandidates.map((candidate) => candidate.field) ?? []
    return {
      file: entry.path,
      group: entry.group,
      identifiers: names(resource.identifiers),
      kind: entry.kind,
      verbs: VERB_ORDER.flatMap((action) => {
        const set = heldVerb(entry.restDefinition, action)
        return set ? [{ operation: `${set.method} ${set.path}`, restAction: action }] : []
      }),
      ...(entry.omitted.length ? { omitted: [...entry.omitted] } : {}),
      ...(entry.conflicts.length
        ? { conflicts: entry.conflicts.map((conflict) => ({ candidates: conflict.candidates.map((candidate) => `${candidate.method} ${candidate.path}`), restAction: conflict.action })) }
        : {}),
      ...(identifierCandidates.length ? { identifierCandidates } : {}),
      ...(statusFields.length ? { statusFields } : {}),
      ...(statusFieldCandidates.length ? { statusFieldCandidates } : {}),
      ...(locked?.[entry.path] ? { published: true as const } : {}),
    }
  })
  const problems = lintHeldDraft(held.files, held.kind)
  let preview: ControllerDraftSummary['preview'] = 'unknown'
  if (state.previewed !== undefined) {
    preview = state.previewed ? 'armed' : 'needed'
  }
  return {
    apiGroup: model.group,
    baseUrl: model.baseUrl,
    groups,
    kinds,
    name: model.name,
    preview,
    ...(groupNames.length > MAX_GROUPS ? { groupsTruncated: true as const } : {}),
    ...(model.specProblem ? { documentProblem: model.specProblem } : {}),
    ...(problems.length ? { problems: problems.slice(0, MAX_PROBLEMS) } : {}),
    ...(problems.length > MAX_PROBLEMS ? { problemsTruncated: true as const } : {}),
  }
}

/** The envelope the collector produced, plus the draft the collector cannot see. */
export const withHeldDraft = (
  envelope: PageContextEnvelope,
  held: BlueprintDraftHeld | null,
  state: HeldDraftState = {},
): PageContextEnvelope => {
  const draft = summarizeDraft(held)
  if (draft) {
    return { ...envelope, draft }
  }
  const controller = summarizeController(held, state)
  if (controller) {
    return { ...envelope, controller }
  }
  const chart = summarizeChart(held)
  return chart ? { ...envelope, chart } : envelope
}

/** "Is this the same chart as last turn" — the bytes, since a chart verb addresses them. */
export const chartFingerprint = (chart: ChartDraftSummary | undefined): string => (chart ? JSON.stringify(chart) : '')

/** "Is this the same controller as last turn" — its whole summary: a verb, a conflict or the preview moved. */
export const controllerFingerprint = (controller: ControllerDraftSummary | undefined): string => (controller ? JSON.stringify(controller) : '')

/**
 * A cheap identity for "is this the same draft as last turn". Names, kinds and containment only —
 * the things a compose proposal addresses. Deliberately NOT the bytes: a `widgetData` edit changes
 * the draft without changing what can be placed where, and re-sending the whole envelope for it
 * would spend the delta budget the collapse exists to protect.
 */
export const draftFingerprint = (draft: DraftSummary | undefined): string => {
  if (!draft) {
    return ''
  }
  const walk = (nodes: readonly DraftNodeSummary[]): string =>
    nodes.map((node) => `${node.name}:${node.kind ?? ''}[${walk(node.children ?? [])}]`).join(',')
  // Which RESTAction backs which widget is structure too: a bind or an orphaned query changes it.
  const data = (draft.dataSources ?? []).map(({ name, usedBy }) => `${name}<${usedBy.join(',')}>`).join(',')
  return data ? `${walk(draft.roots)}|${data}` : walk(draft.roots)
}
