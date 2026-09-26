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
import { regenerateGates } from '../../pages/BlueprintComposer/planEdge'

import { parseRawTemplates } from './blueprintDraft'

export const parseProposedChart = (value: unknown): Record<string, string> | null => {
  const tree = parseRawTemplates(value)
  return tree ? regenerateGates(tree) : null
}
