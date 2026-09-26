/**
 * A chart tree Autopilot PROPOSES, taken in the way the composer holds one: the inline-args guard
 * and de-fencing (parseRawTemplates, which also regenerates the graph block), then every node's
 * gate regenerated from the descriptor (regenerateGates). One function for both places a proposed
 * tree enters — the preview that renders it and the record that holds it — so the bytes rendered
 * are the bytes held.
 *
 * WHY HERE, not in blueprintDraft: the gate kernel lives with the composer's other kernels, and
 * planPlace already imports blueprintDraft; calling it from there would close an import cycle.
 */
import { ARCHITECTURE_TEMPLATE_PATH } from '../../pages/BlueprintComposer/architecture'
import { gateDrift, regenerateGates } from '../../pages/BlueprintComposer/planEdge'

import { lintBlueprintDraft, parseRawTemplates } from './blueprintDraft'
import type { DraftKind } from './blueprintDraftStore'

export const parseProposedChart = (value: unknown): Record<string, string> | null => {
  const tree = parseRawTemplates(value)
  return tree ? regenerateGates(tree) : null
}

/**
 * The chart lint for a HELD draft — the person's copy, which Chart files can edit by hand: the
 * composer's rules (lintBlueprintDraft) plus one problem per template whose gate has drifted from
 * the descriptor (gateDrift). A drifted gate renders a different order than the graph shows, so it
 * refuses Preview and Publish like any other lint problem until the gates are regenerated.
 */
export const lintHeldDraft = (files: Record<string, string>, kind: DraftKind): string[] => [
  ...lintBlueprintDraft(files, kind),
  ...(kind === 'blueprint'
    ? gateDrift(files).map((path) => `${path}: its dependency gate does not match ${ARCHITECTURE_TEMPLATE_PATH} — regenerate the gates, or undo the edit that changed it.`)
    : []),
]
