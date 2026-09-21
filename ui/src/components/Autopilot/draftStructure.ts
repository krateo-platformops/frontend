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

import type { BlueprintDraftHeld } from './blueprintDraftStore'
import type { DraftNodeSummary, DraftSummary, PageContextEnvelope } from './types'

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
      ...(node.allowedResources?.length ? { allows: node.allowedResources } : {}),
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

/** The envelope the collector produced, plus the draft the collector cannot see. */
export const withHeldDraft = (
  envelope: PageContextEnvelope,
  held: BlueprintDraftHeld | null,
): PageContextEnvelope => {
  const draft = summarizeDraft(held)
  return draft ? { ...envelope, draft } : envelope
}

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
