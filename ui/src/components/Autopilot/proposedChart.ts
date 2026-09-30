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
import { builderOf } from '../../builders/builderRegistry'
import { ARCHITECTURE_TEMPLATE_PATH } from '../../pages/BlueprintComposer/architecture'
import { gateDrift, regenerateGates } from '../../pages/BlueprintComposer/planEdge'
import { lintControllerDraft } from '../../pages/ControllerComposer/controllerChart'

import { lintBlueprintDraft, parseRawTemplates } from './blueprintDraft'
import type { DraftKind } from './blueprintDraftStore'

export const parseProposedChart = (value: unknown): Record<string, string> | null => {
  const tree = parseRawTemplates(value)
  return tree ? regenerateGates(tree) : null
}

/**
 * The lints a Builder may name (`spec.lint`; pluginRegistry's check table lists the same names).
 * `chart-lint` is the composer's rules (lintBlueprintDraft); `gate-drift` is one problem per template
 * whose gate has drifted from the descriptor (gateDrift). A drifted gate renders a different order
 * than the graph shows, so it refuses Preview and Publish like any other lint problem until the
 * gates are regenerated. `restdef-validate` is the controller's (lintControllerDraft): the OpenAPI
 * document reads, no verb conflict is left unsettled, and T7's validator passes every RestDefinition.
 */
const LINTS: Record<string, (files: Record<string, string>, kind: DraftKind) => string[]> = {
  'chart-lint': (files, kind) => lintBlueprintDraft(files, kind),
  'gate-drift': (files) => gateDrift(files).map((path) => `${path}: its dependency gate does not match ${ARCHITECTURE_TEMPLATE_PATH} — regenerate the gates, or undo the edit that changed it.`),
  'restdef-validate': (files) => lintControllerDraft(files),
}

/**
 * The lint for a HELD draft — the person's copy, which Chart files can edit by hand: exactly the
 * lints its Builder names, in `spec.lint` order. A name this build has no lint for is never skipped
 * silently (a check not run would let through a draft its builder meant to stop): it is a problem.
 */
export const lintHeldDraft = (files: Record<string, string>, kind: DraftKind): string[] =>
  builderOf(kind).lint.flatMap((name) => (Object.prototype.hasOwnProperty.call(LINTS, name)
    ? LINTS[name](files, kind)
    : [`this frontend has no lint named "${name}", so the draft cannot be checked the way its builder asks`]))
