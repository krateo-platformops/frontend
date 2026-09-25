/**
 * The preview payload for a blueprint — ONE builder for both callers: the agent's previewBlueprint
 * verb and the person's Preview in the Blueprint Composer. Two copies of "what a chart preview shows"
 * is how a drawer and a composer come to disagree about the same draft.
 *
 * `held` is decided by the CALLER, because only the caller knows it: the verb holds an inline draft
 * only when it rendered (a published chart's dry run, or a draft that failed to render, is looked at,
 * not held), while the composer previews the draft the provider already holds.
 */
import { buildFormSchemaText } from './blueprintDraft'
import type { HelmRenderResult } from './previewBridge'
import type { AutopilotPreviewPayload } from './previewBus'

/** Names the artifact: a blueprint IS a Helm chart, and Chart files is what the change request commits. */
export const BLUEPRINT_PREVIEW_CAPTION = 'This blueprint is a Helm chart — Chart files is the tree the change request commits; Source is its helm-rendered objects (dry run, nothing applied to the cluster)'

export interface BlueprintPreviewInput {
  /** The chart's display name (Chart.yaml name, or the chart URL's last segment). */
  name: string
  /** Whether the provider holds this tree — it decides the builder tag, and so who may edit it. */
  held: boolean
  /** The chart tree, when the preview is of an inline draft. Absent for a published chart's dry run. */
  rawTemplates?: Record<string, string>
  /** The render, when there is one. Absent: the Source tab has nothing yet (the composer before Preview). */
  rendered?: HelmRenderResult
  caption?: string
}

export const buildBlueprintPreviewPayload = ({ caption, held, name, rawTemplates, rendered }: BlueprintPreviewInput): AutopilotPreviewPayload => {
  const formSchema = buildFormSchemaText(rawTemplates, rendered?.valuesSchema, rendered?.error)
  return {
    builder: held ? 'blueprint' : 'inspect',
    caption: caption ?? BLUEPRINT_PREVIEW_CAPTION,
    ...(rendered?.error ? { error: rendered.error } : {}),
    // The authored chart tree IS the write-set a publish commits. A catalog dry run of an already
    // published chart has no tree, so no Files tab and no destination.
    ...(rawTemplates ? { files: Object.entries(rawTemplates).map(([path, content]) => ({ content, path })), filesLabel: 'Chart files' } : {}),
    // The chart's OWN repository, named for the chart — the destination form prefills exactly that,
    // and the person confirms the owner there. This used to say `krateo-blueprints`, the org, which
    // read as the repo.
    ...(rawTemplates ? { publishTarget: { base: 'main', note: 'merged, CI publishes it as a versioned OCI Helm chart', repo: name } } : {}),
    ...(formSchema ? { formSchema } : {}),
    objects: rendered?.objects ?? [],
    title: `Blueprint preview — ${name}`,
  }
}
