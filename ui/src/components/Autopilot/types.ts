/**
 * Krateo Autopilot — frontend integration types.
 *
 * Phase 1 (read-only Q&A MVP). The GOVERNING INVARIANT for the whole feature:
 * Autopilot never mutates directly — it acts ONLY by operating the real Krateo
 * frontend (navigate-then-drive the actual Form/Button/row-action via the existing
 * dispatcher). The portal's UI controls ARE the entire action surface. These types
 * model the read-only side (transcript + context grounding + transport) plus the
 * forward-declared action/proposal shapes the bridge will use in Phase 2/3, so the
 * transcript and frame handler are ready without a later type churn.
 */

import type { ApprovalDecision, ApprovalPause } from './approval'

/** Who authored a transcript message. */
export type AutopilotRole = 'user' | 'assistant'

/**
 * A single transcript message. `streaming` marks an assistant bubble still being
 * filled by the A2A stream. `actions`/`intent`/`confirm` are Phase-2/3 surfaces
 * (read-only action chips, "about to:" preview, HITL confirm) — optional here so
 * the transcript renderer is forward-compatible.
 */
export interface AutopilotMessage {
  id: string
  role: AutopilotRole
  text: string
  streaming?: boolean
  /** Auto-applied read-only action chips (Phase 2). */
  actions?: AutopilotActionChip[]
  /** Context-derived quick-prompts surfaced under an assistant turn (Phase 2). */
  suggestions?: string[]
  /** The turn's source trace. Empty array = the turn used no tools. */
  evidence?: EvidenceEntry[]
  createdAt: number
}

export type EvidenceKind = 'repo' | 'cluster' | 'graph' | 'delegation' | 'tool'

/** One tool call, as metadata only — never tool output (see evidence.ts). */
export interface EvidenceEntry {
  /** The function-call id, which the result frame is merged on. */
  id: string
  tool: string
  kind: EvidenceKind
  args?: Record<string, unknown>
  source?: EvidenceSource
  url?: string
  /** Delegation only: the specialist, the session its own calls are in, and the request text
   * that identifies its task there. */
  agent?: string
  sessionId?: string
  request?: string
  note?: string
  failed?: boolean
}

export interface EvidenceSource {
  org?: string
  repo: string
  path?: string
  ref?: string
  lines?: string
}

/** A read-only action chip rendered after it was auto-applied (component 7). */
export interface AutopilotActionChip {
  /** The executed verb (navigate / openDrawer / openModal / setExtras). */
  verb: string
  /** Human-readable target (e.g. "alb-ingress-prod · 1 / 3 resources Ready"). */
  label: string
  /** Marks the chip as non-mutating / auto-applied. Always true for Phase 2. */
  readOnly: boolean
  /** Optional external link — renders the label as an anchor (e.g. the "Open pull/merge request"
   *  deep link after an SCM-agnostic publish, which the human opens in their own SCM). */
  url?: string
}

// ────────────────────────────────────────────────────────────────────────────
// Context grounding (component 2) — what Autopilot is allowed to SEE.
// Built by the collector, scrubbed by the redactor (LAST), fenced as data.
// ────────────────────────────────────────────────────────────────────────────

/**
 * One on-screen widget, reconstructed from the live `['widgets', endpoint, extras]`
 * react-query cache — NOT model memory. Carries id/kind/title and a compact,
 * redaction-safe `summary`; never the raw resourceRef payload (the redactor drops
 * payloads entirely).
 */
export interface WidgetInventoryEntry {
  endpoint: string
  kind?: string
  name?: string
  title?: string
  /** A short, kind-aware summary (e.g. "Table · 248 rows"). */
  summary?: string
  /** For a single-value widget (Statistic / Alert / Paragraph / Descriptions …): its resolved
   * content (e.g. "27", "VPC failed — no matches for kind…"), so the agent reads the NUMBER /
   * text on screen instead of inventing one. */
  value?: string
  /** True while this widget's query is still fetching with no data yet — so the agent can defer
   * ("the list is still loading") instead of reading an empty/stale snapshot as truth. */
  loading?: boolean
  /** True when react-query considers this widget's data stale (snowplow L1 may be mid-revalidate);
   * a hint that the on-screen value may lag the cluster. */
  stale?: boolean
  /**
   * The widget's LIVE react-query load state — the actual on-screen render status,
   * read from the query cache (NOT model memory): `loading` (still fetching, showing
   * a skeleton), `error` (the fetch failed / red-cross state), or `ready` (rendered).
   * This is the grounded signal for "why isn't this showing?" questions. (Complements the
   * boolean `loading`/`stale` above: `loadState` also distinguishes the ERRORED render.)
   */
  loadState?: 'loading' | 'error' | 'ready'
  /**
   * True when this widget carries an unusually large row count (a client-render-scale
   * hazard: a big non-virtualized list/table can wedge the browser tab while it paints).
   * Grounds the RIGHT answer for a sluggish/blank page instead of guessing a cause.
   */
  large?: boolean
  /** For a Form widget: its top-level field names, so Autopilot can prefill them. */
  fields?: string[]
  /** For a list/table widget: a sample of the visible row labels (e.g. installed blueprint
   * names), so Autopilot can CHECK what is on screen — not just how many rows there are.
   * Capped + label-only (no payloads); the redactor still scrubs anything sensitive. */
  items?: string[]
  /** For an action-bearing widget (e.g. Button): the runnable actions on it, so
   * Autopilot can drive the REAL control (gated). `verb` GET = read-only. */
  actions?: { id: string; label?: string; verb: string }[]
  /**
   * The resolved cluster-object identity the widget renders, parsed from its
   * `status.resourcesRefs` path (the /apis/<group>/<version>/… URL snowplow targets):
   * the GVR plus name/namespace for the primary GET, and uid when the widget shows a
   * single object. This is the day-2 grounding hook — Autopilot needs the GVR to
   * reason about "why is THIS composition failing" or propose a targeted patch against
   * the actual object instead of a title. NON-SENSITIVE identity (no payload/token):
   * it passes through the redactor UNCHANGED. Absent for widgets with no resolved ref
   * (a static Paragraph, a purely-navigate Button), so the model is told nothing rather
   * than a fabricated GVR.
   */
  resource?: {
    group: string
    version: string
    resource: string
    namespace?: string
    name?: string
    uid?: string
  }
}

/** The whoami identity surfaced to ground greetings (no token, ever). */
export interface AutopilotIdentity {
  username?: string
  displayName?: string
}

/**
 * The page-context envelope. Serialized inside a `<page_context>` fence and sent
 * with every turn (full on turn 1, delta thereafter). Every field is observed
 * screen state, never an instruction.
 */
export interface PageContextEnvelope {
  /** Current route pathname. */
  route: string
  /** Whitelisted URL params describing the current scope (status / range / q). */
  extras?: Record<string, string>
  identity?: AutopilotIdentity
  /** The live on-screen widget inventory. */
  widgets: WidgetInventoryEntry[]
  /** The LAST previewPage's validation verdicts — present ONLY while the draft set is
   * REJECTED. The model must fix these exact errors and re-emit the full corrected
   * previewPage fence (see the PREVIEW SELF-CORRECTION routing rule). */
  previewProblems?: string[]
  /** A one-line kind-aware summary of the focused surface. */
  focus?: string
  /** When this snapshot was taken (ms epoch) — lets the model reason about freshness. */
  capturedAt?: number
  /**
   * The page's overall render/load state, derived from the widget cache — the
   * grounded answer to "why isn't the page loading?". `loading`: at least one widget
   * is still fetching. `error`: at least one widget's fetch failed. `heavy`: a widget
   * on the page is rendering a very large dataset (a client-render-scale hazard that
   * can make the tab unresponsive). `ready`: everything rendered normally. When absent
   * (no widgets in cache), page state is unknown — do NOT infer a cause.
   */
  pageStatus?: 'loading' | 'error' | 'heavy' | 'ready'
}

// ────────────────────────────────────────────────────────────────────────────
// Transport (components 4 & 5) — A2A stream to the kagent orchestrator.
// Phase-0 spike confirms the concrete wire format; this is the stable seam.
// ────────────────────────────────────────────────────────────────────────────

/** A request for one conversational turn. */
export interface AutopilotSendRequest {
  /** Frontend-owned session/thread id (created on new-thread; used by the echo stub). */
  sessionId: string
  /** A2A conversation continuity id, assigned by the server on the first turn and
   * echoed back on follow-ups. Undefined on the first turn of a thread. */
  contextId?: string
  /** The user's prompt text. */
  text: string
  /**
   * The redacted `<page_context>` fence (full envelope or delta), prepended to `text` on the wire.
   * This is the ONLY thing that rides ahead of the user's text — the portal-rail instruction
   * protocol lives in the orchestrator's system prompt, never in the turn.
   */
  context: string
}

/**
 * A normalized stream frame. The concrete transport translates kagent/ADK A2A
 * frames into these. Phase 1 only renders `text`; `tool_call` is forward-declared
 * for the action bridge interception; `require_approval` is the Phase-2 kagent HITL
 * pause (task `input-required` with `adk_request_confirmation` parts — see approval.ts).
 */
export type AutopilotFrame =
  // `replace` true → set the bubble to `delta` (an authoritative full text, e.g. a
  // kagent final message); otherwise append `delta` (a streamed chunk).
  | { kind: 'text'; delta: string; replace?: boolean }
  // A2A conversation id, surfaced so the provider can continue the thread.
  | { kind: 'session'; contextId: string }
  | { kind: 'tool_call'; name: string; args: unknown; id?: string }
  | { kind: 'tool_result'; name: string; id?: string; output?: string; isError?: boolean; sessionId?: string }
  | { kind: 'require_approval'; pause: ApprovalPause }
  | { kind: 'done' }
  | { kind: 'error'; message: string }

/** Per-stream callbacks. The transport invokes these as frames arrive. */
export interface AutopilotStreamHandlers {
  onFrame: (frame: AutopilotFrame) => void
}

/**
 * The transport seam. A concrete `KagentA2ATransport` targets the deployed
 * orchestrator's A2A endpoint (carrying the portal Bearer); an `EchoTransport`
 * backs local development before the live handshake is wired. `send` returns an
 * abort function that cancels the in-flight stream. `respondToApproval` resumes a
 * paused (`input-required`) task with the human's decision — the reply stream is
 * the agent's continuation, delivered through the same normalized frames.
 */
export interface AutopilotTransport {
  respondToApproval: (decision: ApprovalDecision, pause: ApprovalPause, handlers: AutopilotStreamHandlers) => () => void
  send: (request: AutopilotSendRequest, handlers: AutopilotStreamHandlers) => () => void
}
