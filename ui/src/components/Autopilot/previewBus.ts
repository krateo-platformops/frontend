/**
 * Autopilot preview bus — the tiny, pure seam between the Wave-4 read-only preview
 * VERBS (previewBlueprint / previewPage / previewRestDef, see previewHandlers.ts) and
 * the drawer COMPONENT that renders them (previewSurface.tsx). Mirrors the portal's
 * existing global-overlay pattern (widgets/Drawer: a window CustomEvent opens the
 * mounted overlay), so the pure verb handlers can open UI without holding React state.
 */

import { builderRegistry, findBuilderOf } from '../../builders/builderRegistry'

import type { DraftKind } from './blueprintDraftStore'

export const AUTOPILOT_PREVIEW_EVENT = 'openAutopilotPreview'

/**
 * The draft kind of a payload with no `builder`: every page payload predates the field, and the page
 * composer adopts exactly those (see `builder` below).
 */
export const LEGACY_PAYLOAD_DRAFT_KIND: DraftKind = 'page'

/** One previewed object: its identity headline + its YAML source. */
export interface PreviewObjectEntry {
  apiVersion?: string
  kind: string
  name?: string
  namespace?: string
  yaml: string
}

/** Everything the preview drawer renders. Pure data — the surface never fetches. */
export interface AutopilotPreviewPayload {
  /**
   * WHAT THIS PREVIEW IS. Absent means a PAGE draft — every page payload predates this field, and
   * the page composer adopts exactly those. `blueprint` is a chart draft the provider HOLDS: a clean
   * inline draft that rendered. `restdef` is a RestDefinition draft. `inspect` holds nothing — a
   * published chart's dry run, a draft that failed its lint or its render, a CRD description.
   *
   * Two decisions hang on it. WHERE it shows: the page composer claims the preview surface while
   * mounted and the drawer defers to it, so a chart or an inspection routed there was shown nowhere.
   * And WHETHER it is the held draft: its Files tab writes into the held draft by path, its lint is
   * the held draft's lint, and a discard closes it — none of which is true of a preview nothing
   * holds, whose edits would land in whatever draft happened to be held under the same file names.
   */
  builder?: 'blueprint' | 'controller' | 'restdef' | 'inspect'
  /** Drawer title, named by the verb (e.g. "Blueprint preview — aws-vpc"). */
  title: string
  /** One-line qualifier under the title (e.g. "source preview — not a live render"). */
  caption?: string
  /** Render-failure text shown AS the preview content — a bad chart is data, not a crash. */
  error?: string
  /** Client-side VALIDATION errors of the previewed draft (FE-K1: the RestDefinition
   * checked against the live CRD shape) — the draft would be rejected if published. */
  problems?: string[]
  /** Warning lines (FE-K1: the CEL-immutable fields — wrong first publish = delete + recreate). */
  warnings?: string[]
  /** Structured summary lines (e.g. a RestDefinition's mapped verbs/paths). */
  summary?: string[]
  /** The objects to list: kind/name/namespace headline + collapsible YAML each. */
  objects?: PreviewObjectEntry[]
  /** FE-B1: the RAW values.schema.json string of a previewed blueprint — rendered as a
   * read-only "Create form preview" section via the production SchemaForm. Kept a
   * STRING (parsed client-side) so the draft's authoring order survives verbatim. */
  formSchema?: string
  /** previewPage v2 (FE-P4, sandbox live preview): the ROOT draft's REAL served
   * `widgetEndpoint` — the drawer mounts the portal's own WidgetRenderer on it
   * ("Rendered (live)"), so snowplow compiles + serves the drafts exactly like a
   * production page. Absent = the classic source-only drawer. */
  liveEndpoint?: string
  /** The SOURCE tree that a publish commits, each file with its repo-relative destination path —
   * the unified "Files" tab shared by BOTH builders (a page's widget CRs under the portal chart's
   * templates/, a blueprint's chart tree). Both are the same shape: a manifest tree → PR to a git repo, so both
   * surface it identically (and it IS the write-set the blast-radius later confirms). */
  files?: { content: string; path: string }[]
  /** Label for the files tab. A blueprint names it "Chart files" — the tree IS a Helm chart and
   * the tab is where the user sees that; a page keeps the generic "Files". */
  filesLabel?: string
  /** Where a publish writes — a one-line header on the drawer. Page → the portal chart repo, blueprint
   * → krateo-blueprints; both open a PR into `base`. `note` qualifies WHAT ships after the merge
   * (a blueprint: a versioned OCI Helm chart). Absent for non-publishable previews (restdef). */
  publishTarget?: { base?: string; note?: string; repo: string }
  /** Invoked when the drawer CLOSES (the v2 teardown seam: best-effort sandbox
   * DELETEs, epoch-guarded upstream so a stale close is a no-op). Optional. */
  onClose?: () => void
  /** FE-K(edit): this is a RestDefinition preview whose SOURCE is editable in the drawer. The user
   * edits the held draft's YAML (a human action on the held bytes — not a model round-trip); an
   * accepted edit re-validates client-side and re-arms the preview gate (via the edit bus) so the
   * subsequent publish commits the edited bytes. Absent (blueprint/page/restdef-summary) = read-only. */
  editRestDef?: boolean
  /** The RestDefinition kind the editable source belongs to (headline for the edit section). */
  restDefKind?: string
  /**
   * A "Rendered" tab that says why nothing is rendered yet — the Controller Builder's until its render
   * (T9, frontend#413) draws the create form of the generated CRD there. Absent: no such tab.
   */
  renderedPlaceholder?: string
  /** The tab the files pane opens on, when not its first — a builder whose first tab is still empty. */
  initialTab?: 'files' | 'source'
}

/** The LAST previewPage's validation verdicts — held here so the CONTEXT COLLECTOR can
 * surface them to the model (page context `previewProblems`): Autopilot SEES its own
 * rejected preview and self-corrects without the user asking. Cleared on a live preview. */
let lastPreviewProblems: string[] | null = null

export const setPreviewProblems = (problems: string[] | null): void => {
  lastPreviewProblems = problems && problems.length ? [...problems] : null
}

export const getPreviewProblems = (): string[] | null => lastPreviewProblems

/** The hidden recovery-turn prompt fired by the provider's PREVIEW-VALIDATION TRAMPOLINE when a
 * previewPage was ajv-rejected — pairs with the every-turn PREVIEW SELF-CORRECTION directive. */
export const PREVIEW_SELF_CORRECTION_NUDGE = 'Your previewed page was REJECTED by validation — the EXACT schema errors are in your page context under `previewProblems` (one line per failing field). Fix exactly those errors in the affected CRs (re-delegate to the frontend specialist with the lines verbatim if it authored them) and re-emit the FULL corrected preview fence now (the SAME verb you used — previewPage or previewRestDef). Do NOT emit applyResourceSet or any publish in this reply — publishing is unlocked ONLY by a CLEAN preview that the human then approves.'

/** Open the Autopilot preview drawer (mounted once by AutopilotProvider). */
export const openAutopilotPreview = (payload: AutopilotPreviewPayload): void => {
  window.dispatchEvent(new CustomEvent(AUTOPILOT_PREVIEW_EVENT, { detail: payload }))
}

/**
 * The draft kind a payload shows, or null for an inspection (a payload nothing holds).
 *
 * A payload names its draft kind in `builder`; a Builder that declares that draftKind holds it. An
 * ABSENT `builder` is the draft kind every payload carried before the field existed
 * (LEGACY_PAYLOAD_DRAFT_KIND) — the protocol's default, not a builder switch. `restdef` and `inspect`
 * name no Builder's draft kind, so they are held by none.
 */
export const draftKindOfPayload = (payload: Pick<AutopilotPreviewPayload, 'builder'>): DraftKind | null => {
  // The legacy kind is said ONLY by absence, as it always was: a payload that spells it out is not
  // one any verb emits, and is held by no composer rather than adopted as that kind's draft.
  if ((payload.builder as string | undefined) === LEGACY_PAYLOAD_DRAFT_KIND) {
    return null
  }
  const kind = payload.builder ?? LEGACY_PAYLOAD_DRAFT_KIND
  return findBuilderOf(kind) ? (kind as DraftKind) : null
}

/** True when the payload shows the draft the provider holds — what a Files-tab edit writes into. */
export const isHeldDraftPayload = (payload: Pick<AutopilotPreviewPayload, 'builder'>): boolean =>
  draftKindOfPayload(payload) !== null

/** True for a payload the composer hosting the Builder named `builderName` owns — that Builder's held draft. */
export const isBuilderPayload = (payload: Pick<AutopilotPreviewPayload, 'builder'>, builderName: string): boolean => {
  const kind = draftKindOfPayload(payload)
  return kind !== null && kind === builderRegistry.get({ name: builderName })?.spec.draftKind
}

/**
 * Whether a payload's files are the CRs its Builder APPLIES to the preview sandbox (`preview.mode:
 * sandbox-apply`), so a Files-tab edit must parse as a CR; otherwise they are chart templates, parsed
 * as YAML only.
 */
export const payloadAppliesCrs = (payload: Pick<AutopilotPreviewPayload, 'builder'>): boolean =>
  findBuilderOf(draftKindOfPayload(payload))?.preview.mode === 'sandbox-apply'
