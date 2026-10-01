/**
 * The preview the Controller Builder shows — the held controller and its last render (T9,
 * frontend#413). ONE builder for both callers, as heldBlueprintPayload is for charts: the provider's
 * answer to a Preview, and the workbench that redraws it after every edit, so the two cannot come to
 * disagree about what a controller preview shows.
 *
 *   Rendered     — the create form of each CRD oasgen-render generated (renderedForms), with what the
 *                  render applies anyway (a skipped security scheme) said above them
 *   Chart files  — the tree the change request commits
 *   Source       — the generated CRDs; a failed preview's problems in the problems alert; first, the
 *                  API the Kinds are served under (`<group>/v1alpha1`, pinned) and each Kind's notices
 *
 * A render that no longer describes the files is kept on screen and said to be old — the same rule
 * the Blueprint Composer's Source follows.
 */
import type { AutopilotPreviewPayload } from '../../components/Autopilot/previewBus'
import type { DraftRenderResultDetail } from '../../components/Autopilot/previewDraftRender'
import { sameFiles, type LastRender } from '../BlueprintComposer/heldBlueprintPayload'
import { renderOutcomeCopy, type OutcomeCopy } from '../BlueprintComposer/renderOutcome'

import { SERVED_VERSION, type ControllerModel } from './controllerChart'
import { renderedForms } from './controllerRender'

export const CONTROLLER_FILES_CAPTION = 'Chart files is the tree the change request commits — each Kind is its RestDefinition, and the OpenAPI document rides in its ConfigMap. Edit a file in place; the canvas and the inspector read it back.'

/** A render that shows as it is: what each tab holds, and that nothing was applied. */
export const CONTROLLER_RENDERED_CAPTION = 'Rendered is the create form of each Kind oasgen-render generated; Source is the CRDs themselves — rendered, nothing applied to the cluster. Chart files is the tree the change request commits.'

/** A render that no longer describes the files. */
export const CONTROLLER_STALE_CAPTION = 'Rendered and Source show the last preview. The controller has changed since, so press Preview to render it as it is now.'

/** A render that failed. */
export const CONTROLLER_FAILED_CAPTION = 'The last preview did not render — its problems are in Source. Fix the controller and preview again.'

export const RENDERED_PLACEHOLDER = 'Press Preview: oasgen-render generates each Kind\'s CRD, and its create form appears here. Nothing has been rendered.'
export const RENDERED_FAILED_PLACEHOLDER = 'The last preview did not render, so there is no create form — its problems are in Source.'
export const RENDERED_NO_FORM_PLACEHOLDER = 'The generated CRDs are in Source; none has a spec schema to draw as a create form.'

const verbLine = (model: ControllerModel): string[] => model.kinds.map((entry) => {
  const resource = (entry.restDefinition.spec as { resource?: { verbsDescription?: { action?: string; method?: string; path?: string }[] } } | undefined)?.resource
  const verbs = (resource?.verbsDescription ?? []).map((verb) => `${verb.action} ${verb.method} ${verb.path}`)
  return `${entry.kind} → ${verbs.length ? verbs.join(' · ') : 'no verbs yet'}`
})

/**
 * The line the Source tab opens with (round 2): the API the Kinds are served under — pinned to
 * v1alpha1 whatever the vendor's info.version says (servedVersion.ts).
 */
export const servedAsLine = (model: ControllerModel): string | null => {
  if (!model.group) { return null }
  const served = `Served as ${model.group}/${model.servedVersion ?? SERVED_VERSION}`
  return model.sourceVersion ? `${served} — the document says ${model.sourceVersion}; the served version is pinned` : served
}

/**
 * What each Kind does that a person should know though nothing refuses it (restDefinitionBuild.ts
 * controllerNotices): a jq valueMapping oasgen ignores on a request, a Kind whose status comes from the
 * findby envelope because it has no get. Said above the forms and in Source.
 */
export const controllerPreviewNotices = (model: ControllerModel): string[] =>
  model.kinds.flatMap((entry) => (entry.validation?.warnings ?? [])
    .filter((line) => !line.startsWith('security scheme ') && !line.startsWith('no security scheme'))
    .map((line) => (line.startsWith(entry.kind) ? line : `${entry.kind}: ${line}`)))

const captionOf = (files: Record<string, string>, render: LastRender | null): string => {
  if (!render) { return CONTROLLER_FILES_CAPTION }
  if (render.files && !sameFiles(render.files, files)) { return CONTROLLER_STALE_CAPTION }
  return render.problems?.length ? CONTROLLER_FAILED_CAPTION : CONTROLLER_RENDERED_CAPTION
}

const placeholderOf = (render: LastRender | null): string => {
  if (!render) { return RENDERED_PLACEHOLDER }
  return render.problems?.length ? RENDERED_FAILED_PLACEHOLDER : RENDERED_NO_FORM_PLACEHOLDER
}

const initialTabOf = (hasForms: boolean, render: LastRender | null): AutopilotPreviewPayload['initialTab'] => {
  if (hasForms) { return 'rendered' }
  return render?.problems?.length ? 'source' : 'files'
}

/** The Preview answer's notice, in the controller's words (renderOutcomeCopy speaks of a chart). */
export const CONTROLLER_STALE_OUTCOME = 'The controller changed while it rendered — preview again.'

/** The answer to a controller start with no Kind yet: held, and what Preview needs first. */
export const CONTROLLER_STARTED = 'The controller is held and saved as you edit it. Place a Kind from the palette, then press Preview — oasgen-render generates its CRD. Publish stays off until a preview has rendered the controller.'

export const controllerOutcomeCopy = (detail: DraftRenderResultDetail): OutcomeCopy => {
  const copy = renderOutcomeCopy(detail)
  switch (detail.outcome) {
    case 'stale':
      return { ...copy, title: CONTROLLER_STALE_OUTCOME }
    case 'rendered':
      return { ...copy, title: copy.title.replace('Publish is on until the chart changes.', 'Publish is on until the controller changes.') }
    case 'failed':
      return { ...copy, title: `${detail.message ?? 'The controller did not render, so it cannot be published yet.'} Its problems are in Source.` }
    case 'unavailable':
      // A start with nothing to render yet is guidance, not a warning; a render that could not run is one.
      return detail.message === CONTROLLER_STARTED ? { ...copy, type: 'info' } : copy
    default:
      return copy
  }
}

export const controllerPreviewPayload = (
  files: Record<string, string>,
  model: ControllerModel,
  name: string,
  render: LastRender | null,
): AutopilotPreviewPayload => {
  const forms = render && !render.problems?.length ? renderedForms(render.objects) : []
  const served = servedAsLine(model)
  const notices = controllerPreviewNotices(model)
  const renderedWarnings = [...(render?.renderedWarnings ?? []), ...notices]
  return {
    builder: 'controller',
    caption: captionOf(files, render),
    files: Object.entries(files).map(([path, content]) => ({ content, path })),
    filesLabel: 'Chart files',
    // Rendered once it has a form to show; Source after a failed preview (where its caption points);
    // Chart files before any.
    initialTab: initialTabOf(forms.length > 0, render),
    objects: render?.objects ?? [],
    ...(render?.problems?.length ? { problems: render.problems } : {}),
    publishTarget: { base: 'main', note: 'merged, CI publishes it as a versioned OCI Helm chart', repo: name },
    ...(forms.length ? { renderedForms: forms } : { renderedPlaceholder: placeholderOf(render) }),
    ...(renderedWarnings.length ? { renderedWarnings } : {}),
    summary: [...(served ? [served] : []), ...verbLine(model), ...notices],
    title: `Controller — ${name}`,
  }
}
