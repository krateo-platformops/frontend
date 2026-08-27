/**
 * Autopilot preview bus — the tiny, pure seam between the Wave-4 read-only preview
 * VERBS (previewBlueprint / previewPage / previewRestDef, see previewHandlers.ts) and
 * the drawer COMPONENT that renders them (previewSurface.tsx). Mirrors the portal's
 * existing global-overlay pattern (widgets/Drawer: a window CustomEvent opens the
 * mounted overlay), so the pure verb handlers can open UI without holding React state.
 */

export const AUTOPILOT_PREVIEW_EVENT = 'openAutopilotPreview'

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
   * the unified "Files" tab shared by BOTH builders (a page's widget CRs at chart/templates/… , a
   * blueprint's chart tree). Both are the same shape: a manifest tree → PR to a git repo, so both
   * surface it identically (and it IS the write-set the blast-radius later confirms). */
  files?: { content: string; path: string }[]
  /** Label for the files tab. A blueprint names it "Chart files" — the tree IS a Helm chart and
   * the tab is where the user sees that; a page keeps the generic "Files". */
  filesLabel?: string
  /** Where a publish writes — a one-line header on the drawer. Page → krateo-portal-chart, blueprint
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
