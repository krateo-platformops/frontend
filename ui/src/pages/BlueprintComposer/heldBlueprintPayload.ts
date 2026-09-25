/**
 * The preview the Blueprint Composer shows under its canvas: the held chart, and its last render.
 *
 * The mirror of heldPagePayload, for the same reason: the composer does not receive a payload for
 * the draft it shows — it receives the held FILES on the draft broadcast, after every write, and a
 * render RESULT when a Preview (its own, or the agent's) comes back. This puts the two together
 * through buildBlueprintPreviewPayload, the one builder the agent's previewBlueprint verb uses too,
 * so the drawer and the composer cannot come to disagree about what a chart preview shows.
 *
 * `held: true` because the composer only ever shows the held draft — that is what makes Chart files
 * editable in place (an edit rides the file-edit bus into the provider, tagged as a blueprint) and
 * what makes it the draft a publish commits.
 *
 * NO `formSchema`. The builder attaches the create-form preview to the Source tab; the composer
 * shows it in the inspector beside the graph (mockup screen 3), and one form in two places would
 * be two things to read that must say the same.
 */
import { draftDisplayName } from '../../components/Autopilot/blueprintDraft'
import { buildBlueprintPreviewPayload } from '../../components/Autopilot/blueprintPreviewPayload'
import type { HelmRenderResult } from '../../components/Autopilot/previewBridge'
import type { AutopilotPreviewPayload, PreviewObjectEntry } from '../../components/Autopilot/previewBus'

/** Before any Preview: what the two tabs are, and that Source fills only on request. */
export const UNRENDERED_CAPTION = 'Chart files is the tree the change request commits — edit a file in place. Source fills when you press Preview: the chart rendered by helm as a dry run, nothing applied to the cluster.'

/** A render that no longer describes the files: kept on screen, and said to be old. */
export const STALE_RENDER_CAPTION = 'Source shows the last preview. The chart has changed since, so press Preview to render it as it is now.'

/** A render whose chart failed — kept on screen with its error, and said to have failed. */
export const FAILED_RENDER_CAPTION = 'The last preview did not render — its error is in Source. Fix the chart in Chart files and preview again.'

/** The render as the composer keeps it: its objects or its error, and the files it rendered. */
export interface LastRender {
  objects: PreviewObjectEntry[]
  error?: string
  /** The tree that was rendered, when the answer carried it — what "stale" is measured against. */
  files?: Record<string, string>
}

/** A render result's payload, reduced to what the Source tab shows and what it was a render of. */
export const lastRenderOf = (payload: Pick<AutopilotPreviewPayload, 'error' | 'files' | 'objects'>): LastRender => ({
  objects: payload.objects ?? [],
  ...(payload.error ? { error: payload.error } : {}),
  ...(payload.files ? { files: Object.fromEntries(payload.files.map((file) => [file.path, file.content])) } : {}),
})

/** Same paths, same bytes. */
export const sameFiles = (left: Record<string, string>, right: Record<string, string>): boolean => {
  const keys = Object.keys(left)
  return keys.length === Object.keys(right).length && keys.every((key) => right[key] === left[key])
}

/**
 * What the tabs say about the render they show. Measured against the files the render was OF, not
 * against the publish gate: a failed render disarms the gate without the chart having changed, and
 * "the chart has changed since" would then be false.
 */
export const renderCaption = (files: Record<string, string>, render: LastRender | null): string | undefined => {
  if (!render) {
    return UNRENDERED_CAPTION
  }
  if (render.files && !sameFiles(render.files, files)) {
    return STALE_RENDER_CAPTION
  }
  // undefined: the builder's own caption — what a blueprint preview is, and that nothing was applied.
  return render.error ? FAILED_RENDER_CAPTION : undefined
}

export const heldBlueprintPayload = (
  files: Record<string, string>,
  render: LastRender | null,
  caption?: string,
): AutopilotPreviewPayload | null => {
  if (!Object.keys(files).length) {
    return null
  }
  const rendered: HelmRenderResult | undefined = render ? { objects: render.objects, ...(render.error ? { error: render.error } : {}) } : undefined
  const payload = buildBlueprintPreviewPayload({ caption, held: true, name: draftDisplayName(files), rawTemplates: files, rendered })
  // The inspector owns the form preview — see the header.
  const { formSchema: _formSchema, ...shown } = payload
  return shown
}
