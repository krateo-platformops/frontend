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
import { buildObjectTree, flattenTree } from '../../pages/PageComposer/objectTree'
import type { TreeNode } from '../../pages/PageComposer/objectTree'

import { CHART_YAML_PATH, chartYamlName, VALUES_SCHEMA_PATH } from './blueprintDraft'
import type { BlueprintDraftHeld } from './blueprintDraftStore'
import { redactValue } from './redact'
import type { ChartDraftSummary, DraftNodeSummary, DraftSummary, PageContextEnvelope } from './types'

/**
 * Cap on the nodes described. A hand-built page is a dozen nodes and a generated one rarely more;
 * this exists so a pathological draft cannot crowd the widget inventory out of the envelope. When
 * it bites, the summary says so rather than silently presenting a truncation as the whole page.
 */
const MAX_NODES = 80

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
      kind: node.kind,
      name: node.name,
      ...(node.resource ? { resource: node.resource } : {}),
    })
  }
  return out
}

/**
 * The structural summary of a held PAGE draft, or undefined when there is nothing to describe.
 *
 * Pages only: a blueprint draft is a Helm chart, its files are templates rather than widget CRs,
 * and `buildObjectTree` would find no containment in them. Reporting an empty tree for one would
 * read as "your draft is empty", which is worse than saying nothing.
 */
export const summarizeDraft = (held: BlueprintDraftHeld | null): DraftSummary | undefined => {
  if (!held || held.kind !== 'page') {
    return undefined
  }
  const roots = buildObjectTree(held.files)
  if (!roots.length) {
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
 * The held CHART, for the agent that edits it with chartPut / chartDelete / chartLink. Undefined
 * unless the held draft is a blueprint.
 *
 * AN ARRAY, NOT A PATH-KEYED MAP. The redactor replaces the value of every key that CONTAINS a
 * credential word, so `{"templates/username-secret.yaml": …}` would reach the model as
 * "[redacted]" — a file that looks empty, and a whole-file rewrite that would write that back.
 * And a file whose CONTENT the redactor would change (a JWT, a long base64 run) is withheld, not
 * sent altered, for the same reason: the model must only ever rewrite bytes it was shown exactly.
 */
export const summarizeChart = (held: BlueprintDraftHeld | null): ChartDraftSummary | undefined => {
  if (!held || held.kind !== 'blueprint') {
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

/** The envelope the collector produced, plus the draft the collector cannot see. */
export const withHeldDraft = (
  envelope: PageContextEnvelope,
  held: BlueprintDraftHeld | null,
): PageContextEnvelope => {
  const draft = summarizeDraft(held)
  if (draft) {
    return { ...envelope, draft }
  }
  const chart = summarizeChart(held)
  return chart ? { ...envelope, chart } : envelope
}

/** "Is this the same chart as last turn" — the bytes, since a chart verb addresses them. */
export const chartFingerprint = (chart: ChartDraftSummary | undefined): string => (chart ? JSON.stringify(chart) : '')

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
  return walk(draft.roots)
}
