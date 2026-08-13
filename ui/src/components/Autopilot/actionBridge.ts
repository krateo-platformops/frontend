/**
 * Action bridge (component 6, read-only subset). The GOVERNING INVARIANT: Autopilot
 * never mutates and never reimplements behaviour — it drives the REAL portal by
 * compiling a proposal into a canonical `WidgetAction` and dispatching it through
 * the SAME `useHandleAction` dispatcher a Button/row-action uses.
 *
 * Deny-by-default: only the four read-only verbs are accepted; anything else (a
 * mutating rest, an unknown verb) is rejected here, never executed. The read-only
 * verbs are auto-applied (non-mutating); mutations are Phase 3 (gated by the real
 * control's own confirm).
 *
 * Proposals reach the bridge two ways, both produced by the orchestrator:
 *   - a `propose_portal_action` tool_call frame (the transport surfaces it), or
 *   - a fenced ```portal-action {json}``` block in the assistant text (parsed +
 *     stripped here). The fenced channel needs only a system-prompt addition.
 */

import { useQueryClient } from '@tanstack/react-query'
import { useCallback, useMemo, useState } from 'react'
import { type RouteObject } from 'react-router'

import { useConfigContext } from '../../context/ConfigContext'
import { useRoutesContext } from '../../context/RoutesContext'
import type { WriteOrigin } from '../../hooks/provenance'
import { useHandleAction } from '../../hooks/useHandleActions'
import type { ResourcesRefs, WidgetAction } from '../../types/Widget'

// applyResourceSet — the P1 applySet mutating branch (builder/fleet): an ORDERED set of up
// to 10 Krateo-scoped writes dispatched through the hook's handleActionSet → runRestSet,
// so the WHOLE set is gated behind ONE aggregated W0-4 blast-radius confirm.
import { applyResourceSet, type ApplyResourceSetOp, type ApplyResourceSetProposal } from './applyResourceSet'
// patchField — the day-2 mutating branch (a DISTINCT, explicitly-gated verb owned by the
// bridge, NOT a read-only registry entry): scoped by isPatchAllowed, dispatched through the
// SAME dispatcher so it flows through the W0-2 blast-radius gate.
import { applyPatchField, type PatchFieldProposal } from './patchField'
// Import the preview handlers module for its side effect: it registers previewBlueprint /
// previewPage into READONLY_VERB_REGISTRY on load, so they are present before any apply().
import './previewHandlers'
// previewPage v2 (FE-P4) — the SANDBOX live-preview branch. Config-gated: when
// api.PREVIEW_SANDBOX_NAMESPACE is set, `previewPage` is intercepted BEFORE the
// read-only registry (it APPLIES drafts to the quarantined sandbox and renders the
// root's real widgetEndpoint); absent config the registry's v1 source preview runs
// untouched. See previewPageV2.ts / previewSandbox.ts.
import { applyPreviewPageV2 } from './previewPageV2'
import { createPreviewPageSession } from './previewSandbox'
import type { AutopilotActionChip } from './types'
import { READONLY_VERB_REGISTRY } from './verbRegistry'

const MUTATING_VERBS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

const asRec = (value: unknown): Record<string, unknown> | undefined =>
  (value && typeof value === 'object' ? (value as Record<string, unknown>) : undefined)

/** The widget cache is useInfiniteQuery — entries are `{ pages: Widget[], … }`.
 * Unwrap the last page (fullest cumulative state) before reading the widget. */
const unwrapWidget = (data: unknown): unknown => {
  const pages = asRec(data)?.pages
  return Array.isArray(pages) && pages.length ? pages[pages.length - 1] : data
}

/**
 * Find a REAL on-screen action (+ its resolved refs) in the live widget cache, by
 * the widget's name and the action id. Returns null when absent — a hallucinated
 * control is therefore a no-op, never a synthesized call.
 */
const lookupAction = (
  queryClient: ReturnType<typeof useQueryClient>,
  widgetName: string | undefined,
  actionId: string | undefined,
): { action: WidgetAction; resourcesRefs: ResourcesRefs } | null => {
  if (!widgetName || !actionId) {
    return null
  }
  const entries = queryClient.getQueriesData<unknown>({ queryKey: ['widgets'] })
  for (const [, data] of entries) {
    const root = asRec(unwrapWidget(data))
    if (asRec(root?.metadata)?.name !== widgetName) {
      continue
    }
    // Read the RESOLVED status (widgetData + resourcesRefs, like WidgetRenderer), so
    // a templated action's refs (e.g. server-resolved toggle-pause-composition) are
    // present; spec.* holds the empty pre-template values. Falls back to spec.
    const status = asRec(root?.status)
    const spec = asRec(root?.spec)
    const actionsMap = asRec(asRec(status?.widgetData)?.actions ?? asRec(spec?.widgetData)?.actions)
    for (const arr of Object.values(actionsMap ?? {})) {
      if (!Array.isArray(arr)) {
        continue
      }
      const list: unknown[] = arr
      const match = list.find((entry) => asRec(entry)?.id === actionId)
      if (match) {
        const refs = asRec(status?.resourcesRefs) ?? asRec(spec?.resourcesRefs)
        return { action: match as WidgetAction, resourcesRefs: (refs ?? { items: [] }) as ResourcesRefs }
      }
    }
  }
  return null
}

/** The verb a real action will fire (from its resolved resourceRef; GET for navigate). */
const verbOf = (action: WidgetAction, resourcesRefs: ResourcesRefs): string => {
  const ref = action.resourceRefId
    ? resourcesRefs.items.find((item) => item.id === action.resourceRefId)
    : undefined
  return ref?.verb ?? (action.type === 'navigate' ? 'GET' : 'POST')
}

export interface PortalActionProposal {
  /** One of the read-only verbs; anything else is denied. */
  verb: string
  /** navigate: the client-side route (e.g. "/compositions/krateo-system/portal"). */
  route?: string
  /** setExtras: whitelisted URL scope params merged into the current path. */
  extras?: Record<string, string>
  /** openDrawer/openModal: a resourceRefId resolved against the page's refs. */
  resourceRefId?: string
  /** prefillForm: field-name → value to merge into the mounted create Form. */
  values?: Record<string, unknown>
  /** runAction: the widget name + action id of a REAL on-screen control to drive. */
  widget?: string
  actionId?: string
  title?: string
  /** patchField / applyResourceSet: the target object's namespace + name. */
  namespace?: string
  name?: string
  /** previewBlueprint (Wave 4): the chart to helm-render dry-run ({url, version?,
   * repo?}); `values` above (shared with prefillForm) carries the render values. */
  chart?: { url: string; version?: string; repo?: string }
  /** previewBlueprint INLINE-DRAFT mode (FE-B1): the draft chart tree as
   * {"<path>": "<content>"} — exactly ONE of `chart` | `rawTemplates` may be set. */
  rawTemplates?: Record<string, string>
  /** explainUpgradeImpact (Wave 4): the TARGET blueprint version to diff the installed
   * composition against. Read-only — forwards {namespace, name, to} to the server-side
   * `upgrade-impact` RESTAction (over snowplow /call), which fetches the CompositionDefinition,
   * helm-render `/diff`s installed-vs-target, and shapes the result. Shows what a gated Update
   * would change (added/removed/modified objects + whether the values schema changed) BEFORE
   * the Update runAction is proposed. `name`/`namespace` above scope the composition. */
  toVersion?: string
  /** previewPage (Wave 4): the proposed widget CR objects, shown as a read-only
   * source-preview drawer (kind/name headline + collapsible YAML each). */
  widgets?: unknown[]
  /** previewPage (#106): OPTIONAL sidebar hint for the page's auto-generated nav entry
   * ({label?, icon?, order?}); the portal synthesizes a nav fragment from the page's
   * `page-<slug>` root so the sidebar entry publishes WITH the page. All fields default. */
  nav?: { label?: string; icon?: string; order?: number }
  /** previewRestDef (Wave 4): a RestDefinition CR draft — previewed as YAML plus a
   * client-side summary of its mapped verbs/paths. */
  restDefinition?: Record<string, unknown>
  /** patchField (day-2, MUTATING): the on-page composition's GVR (from the page-context
   * `resource`), the single spec field to change (a `spec.<key>` path or a bare key), and
   * its new value. Routed through the W0-2 blast-radius gate; scoped by isPatchAllowed. */
  gvr?: { group: string; version: string; resource: string }
  field?: string
  value?: unknown
  /** applyResourceSet (builder/fleet, MUTATING): an ORDERED list of up to 10 write ops
   * ({verb, gvr, namespace, name?, payload?}) applied via the W0-4 set fabric — ONE
   * aggregated blast-radius confirm for the whole set, sequential dispatch, stop on
   * first error. Scoped by isApplySetAllowed (Krateo groups / core ConfigMaps only). */
  ops?: ApplyResourceSetOp[]
  /** publishBlueprint (FE-BP6) / publishPage (FE-BP7) / publishRestDef (FE-KOG-PR), MUTATING: the
   * git PR publish for a blueprint chart / a portal page / a KOG API mapping. The model emits ONLY
   * these repo-coordinate scalars; the HOST fans them out into the gitrefs + per-file repocontents +
   * pullrequests op set from the HELD previewed draft (the model stalls hand-writing that multi-op
   * payload). All optional — each defaults to the blueprint-catalog (publishBlueprint), portal-chart
   * (publishPage), or KOG-oas (publishRestDef) repo. `title`/`body`/`namespace` above are shared;
   * these add the rest. */
  owner?: string
  repo?: string
  base?: string
  configurationRef?: string
  message?: string
  body?: string
  /** Human-readable label for the auto-applied action chip. */
  label?: string
}

/** One spotlight step in a guided tour: a semantic anchor + popover copy. */
export interface AutopilotTourStep {
  /** Semantic anchor resolved to a DOM element (nav:<Label> / action:<Label> / text:<substring>). */
  anchor: string
  title: string
  description: string
}

export interface PortalTour {
  steps: AutopilotTourStep[]
}

const PROPOSAL_FENCE = /```portal-action\s*\n([\s\S]*?)```/g
const SUGGEST_FENCE = /```portal-suggest\s*\n([\s\S]*?)```/g
const TOUR_FENCE = /```portal-tour\s*\n([\s\S]*?)```/g

// Un-fenced fallback: the orchestrator sometimes drops the ```fence``` and emits the directive JSON
// as a bare line (observed live: a raw `{"verb":"navigate","route":"/blueprints",…}` in the prose).
// We parse those too — so the action still FIRES (the deny-by-default verb check applies downstream
// exactly as for the fenced form) instead of silently no-op'ing — and strip them so the raw JSON
// never renders to the user. One line per object (the model emits each directive on its own line).
const PROPOSAL_BARE = /^[ \t]*(\{[^\n]*?"verb"\s*:[^\n]*\})[ \t]*,?[ \t]*$/gm
const TOUR_BARE = /^[ \t]*(\{[^\n]*?"steps"\s*:[^\n]*\})[ \t]*,?[ \t]*$/gm

export interface AutopilotDirectives {
  /** Assistant prose with all directive fences stripped out. */
  cleanedText: string
  /** Read-only actions to auto-apply. */
  proposals: PortalActionProposal[]
  /** Context-derived follow-up prompts to render as one-tap chips. */
  suggestions: string[]
  /** A guided spotlight tour to start, if proposed. */
  tour?: PortalTour
}

/**
 * Extract + STRIP the directive fences (`portal-action`, `portal-suggest`,
 * `portal-tour`) from assistant text. The JSON never shows to the user — actions
 * become chips, suggestions become quick-prompt chips, a tour starts a spotlight
 * walkthrough. Malformed blocks are dropped.
 */
/**
 * Strip raw tool-call echoes the model occasionally emits (e.g. a failed document fetch surfacing as
 * "Malformed function call: print(default_api.fetch(...))"). These are backend artifacts, never meant
 * for the user. Applied to BOTH the streaming accumulator and the finalized text so they never flash.
 */
export const sanitizeChatText = (text: string): string => {
  // #103 (EdmondDantes21): preserve the agent's fenced code/YAML output (it used to be stripped
  // wholesale). Stash every non-directive fence so the un-fenced manifest/CLI strips below cannot reach
  // INSIDE a ```yaml block, then restore verbatim at the end. Sentinel is plain ASCII, never in agent
  // text. Only DIRECTIVE fences (portal-action/-suggest/-tour) below stay stripped.
  const fences: string[] = []
  const cleaned = text
    // 1. Fenced code blocks (kubectl/YAML manifests the model echoes at the create step). Autopilot
    //    drives the portal UI — it never needs to show code; the user provisions via the form's Create
    //    button. NOTE: affects only the RENDERED text — the raw buffer keeps the directive fences
    //    (```portal-action/-suggest/-tour```) so finalize still parses them.
    .replace(/```portal-(?:action|suggest|tour)\s*\n[\s\S]*?```/g, '')
    // an unclosed DIRECTIVE fence still streaming -> strip to end (no mid-stream flash)
    .replace(/```portal-(?:action|suggest|tour)[\s\S]*$/g, '')
    // #103: stash every remaining (non-directive) fence; restored verbatim at the end.
    .replace(/```[\s\S]*?```/g, (block) => `[[FENCE:${fences.push(block) - 1}]]`)
    .replace(/```[\s\S]*$/g, (block) => `[[FENCE:${fences.push(block) - 1}]]`)
    // 2. Un-fenced manifests the model emits as PLAIN text (the variant the fence strip misses, seen
    //    live): a `cat <<EOF … EOF` heredoc (closed, then an unclosed one still streaming) and a bare
    //    `apiVersion:`-rooted YAML block up to the next blank line.
    .replace(/<<-?\s*['"]?EOF['"]?[\s\S]*?\n[ \t]*EOF\b/gi, '')
    .replace(/<<-?\s*['"]?EOF\b[\s\S]*$/gi, '')
    // 3. Bare CLI command lines — Autopilot has no terminal step; the Create button is the mechanism.
    .replace(/^[ \t]*(kubectl|helm|krateoctl)\b[^\n]*$/gim, '')
    // 4. Imperative lead-ins that send the user to a terminal (else stripping the command leaves a
    //    dangling "run this:"). Gated on terminal/CLI words so ordinary "apply the filter" prose survives.
    .replace(/^[ \t]*[^\n]*\b(run|apply|paste|execute)\b[^\n]*\b(terminal|the following command|kubectl|manifest|this command)\b[^\n]*$/gim, '')
    .replace(/^[ \t]*[^\n]*\bin your terminal\b[^\n]*$/gim, '')
    // 5. Raw tool-call echoes (a failed doc-fetch etc.) in any wrapper, not just the one signature.
    .replace(/^[ \t]*[^\n]*(Malformed function call|default_api\.|tool_code|tool_outputs|<tool_call)[^\n]*$/gim, '')
    // 6. Residual un-fenced directive JSON: a bare `{"verb":…}` action or `{"steps":…}` tour the model
    //    emitted without a ```fence```. parseAutopilotDirectives parses + strips the valid ones (so they
    //    FIRE); this catches a malformed leftover, AND — second pattern — a still-streaming incomplete
    //    object (`{… "verb": …` with no closing brace yet) so it never flashes mid-stream.
    .replace(/^[ \t]*\{[^\n]*"(?:verb|steps)"\s*:[^\n]*\}[ \t]*,?[ \t]*$/gim, '')
    .replace(/^[ \t]*\{[^\n}]*"(?:verb|steps)"\s*:[^\n}]*$/gim, '')
    // tidy the gaps the removals leave
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/^\n+/, '')
  // #103: restore the preserved fenced blocks verbatim so the agent's code/YAML renders.
  return cleaned.replace(/\[\[FENCE:(\d+)\]\]/g, (_match, index: string) => fences[Number(index)] ?? '')
}

export const parseAutopilotDirectives = (text: string): AutopilotDirectives => {
  const proposals: PortalActionProposal[] = []
  const suggestions: string[] = []
  let tour: PortalTour | undefined

  let cleaned = text.replace(PROPOSAL_FENCE, (_match, body: string) => {
    try {
      const parsed = JSON.parse(body.trim()) as PortalActionProposal
      if (parsed && typeof parsed.verb === 'string') {
        proposals.push(parsed)
      }
    } catch {
      // Malformed proposal block — drop it.
    }
    return ''
  })

  cleaned = cleaned.replace(SUGGEST_FENCE, (_match, body: string) => {
    try {
      const parsed = JSON.parse(body.trim()) as unknown
      if (Array.isArray(parsed)) {
        suggestions.push(...parsed.filter((entry): entry is string => typeof entry === 'string'))
      }
    } catch {
      // Malformed suggest block — drop it.
    }
    return ''
  })

  cleaned = cleaned.replace(TOUR_FENCE, (_match, body: string) => {
    try {
      const parsed = JSON.parse(body.trim()) as PortalTour
      const steps = Array.isArray(parsed?.steps)
        ? parsed.steps.filter((step) => step && typeof step.anchor === 'string' && typeof step.title === 'string')
        : []
      if (steps.length) {
        tour = { steps }
      }
    } catch {
      // Malformed tour block — drop it.
    }
    return ''
  })

  // Un-fenced fallback (the model forgot the ```fence```): parse a bare `{"verb":…}` action / a bare
  // `{"steps":…}` tour so it FIRES, and strip it so it never renders as literal JSON. Only strips a
  // line that parses as the expected shape — a malformed line is left for sanitizeChatText/display.
  cleaned = cleaned.replace(PROPOSAL_BARE, (match, body: string) => {
    try {
      const parsed = JSON.parse(body) as PortalActionProposal
      if (parsed && typeof parsed.verb === 'string') {
        proposals.push(parsed)
        return ''
      }
    } catch { /* not valid JSON — leave it */ }
    return match
  })
  cleaned = cleaned.replace(TOUR_BARE, (match, body: string) => {
    try {
      const parsed = JSON.parse(body) as PortalTour
      const steps = Array.isArray(parsed?.steps)
        ? parsed.steps.filter((step) => step && typeof step.anchor === 'string' && typeof step.title === 'string')
        : []
      if (steps.length) {
        tour = tour ?? { steps }
        return ''
      }
    } catch { /* not valid JSON — leave it */ }
    return match
  })

  return { cleanedText: sanitizeChatText(cleaned).trim(), proposals, suggestions, tour }
}

/**
 * The bridge hook. `apply` compiles ONE proposal to a canonical action and drives
 * the real dispatcher, returning the chip to show (or null if denied / not
 * drivable). Reuses `useHandleAction`, so RBAC + the URL-merge semantics are
 * exactly those of a hand-clicked control.
 */
/** Flatten the registered route tree to its concrete path patterns (excluding the `*` catch-all), so
 * a navigate target can be validated against REAL routes — a hallucinated path (`/admin`,
 * `/compositions/new`) matches nothing and is dropped, instead of "opening" a 404 the chat claims is X. */
const collectRoutePatterns = (routes: RouteObject[]): string[] => {
  const out: string[] = []
  const walk = (rs: RouteObject[]): void => {
    for (const route of rs) {
      if (typeof route.path === 'string' && route.path && route.path !== '*') {
        out.push(route.path)
      }
      if (route.children) {
        walk(route.children)
      }
    }
  }
  walk(routes)
  return out
}

export const useAutopilotActionBridge = () => {
  const { handleAction, handleActionSet } = useHandleAction()
  const queryClient = useQueryClient()
  const { routes } = useRoutesContext()
  const routePatterns = useMemo(() => collectRoutePatterns(routes), [routes])
  // previewBlueprint render transport. PREFERRED: the server-side `blueprint-render`
  // RESTAction fetched via snowplow `/call` (snowplowBaseUrl + frontendNamespace) — the
  // ClusterIP-only render service is never browser-exposed. FALLBACK: the legacy direct
  // browser fetch (renderBaseUrl = RENDER_API_BASE_URL). Neither → a graceful "unavailable"
  // chip (zero network).
  const { config } = useConfigContext()
  const snowplowBaseUrl = config?.api.SNOWPLOW_API_BASE_URL
  const frontendNamespace = config?.params.FRONTEND_NAMESPACE
  const renderBaseUrl = config?.api.RENDER_API_BASE_URL
  // FE-P4: the quarantined preview sandbox. Absent/empty = previewPage v2 OFF (v1
  // source preview) AND the applyResourceSet widgets/restactions carve-out fully closed.
  const sandboxNamespace = config?.api.PREVIEW_SANDBOX_NAMESPACE
  // The provider-scoped teardown session for the CURRENT live preview (epoch-guarded:
  // a stale drawer-close never deletes a newer preview's drafts). One per bridge owner.
  const [previewPageSession] = useState(createPreviewPageSession)

  // `origin` is the W0-3 provenance tag the provider passes at dispatch time (actor:'agent'
  // + its session id + the user's latest prompt). It is threaded into EVERY dispatch this
  // bridge drives, so a write reached through runAction / patchField / applyResourceSet is
  // audited as agent-originated; read-only verbs carry it harmlessly (no write → no record).
  const apply = useCallback(async (proposal: PortalActionProposal, origin?: WriteOrigin): Promise<AutopilotActionChip | null> => {
    // runAction: drive a REAL on-screen control (Sync/Pause/Edit/Delete) through the
    // SAME useHandleAction dispatcher the button uses — never a synthesized call. On a
    // mutating verb, requireConfirmation is FORCED (never trusted from the model), so the
    // dispatcher's own modal.confirm is the binding HITL gate; the user confirms.
    if (proposal.verb === 'runAction') {
      const found = lookupAction(queryClient, proposal.widget, proposal.actionId)
      if (!found) {
        return null
      }
      const verb = verbOf(found.action, found.resourcesRefs)
      const mutating = MUTATING_VERBS.has(verb)
      const toDispatch = mutating && found.action.type === 'rest'
        ? { ...found.action, requireConfirmation: true }
        : found.action
      await handleAction(toDispatch, found.resourcesRefs, undefined, undefined, origin)
      return { label: proposal.label ?? `${verb} ${proposal.widget ?? ''}`.trim(), readOnly: !mutating, verb: 'runAction' }
    }

    // patchField: the day-2 MUTATING branch. A SCOPED merge-patch of ONE spec field of the
    // on-page composition, compiled into a PATCH `rest` WidgetAction and dispatched through
    // this SAME useHandleAction dispatcher — so it hits runRest's W0-2 blast-radius gate (the
    // human confirms the exact diff). applyPatchField enforces the isPatchAllowed scoping
    // kernel (composition-only + single simple spec field) and returns null on any reject,
    // so a denied patch is a no-op exactly like an unknown verb — NEVER a bypass of the gate.
    if (proposal.verb === 'patchField') {
      // Bind the agent origin into the dispatcher the branch uses (patchField itself stays
      // origin-agnostic): the resulting PATCH is audited as agent-originated (W0-3).
      return applyPatchField(proposal as unknown as PatchFieldProposal, {
        handleAction: (action, resourcesRefs) => handleAction(action, resourcesRefs, undefined, undefined, origin),
      })
    }

    // applyResourceSet: the P1 applySet MUTATING branch (builder/fleet). An ORDERED set of
    // up to 10 Krateo-scoped writes compiled into the W0-4 fabric's WriteOps and dispatched
    // via handleActionSet → runRestSet — ONE aggregated blast-radius confirm for the WHOLE
    // set (ordered op list + per-op irreversible flag), sequential dispatch, stop on first
    // error. applyResourceSet enforces the isApplySetAllowed scoping kernel (≤10 ops;
    // groups ending in .krateo.io, or core ConfigMaps only) and returns null on any reject
    // or on the human's decline — a denied set is a no-op, NEVER a bypass of the gate.
    if (proposal.verb === 'applyResourceSet') {
      // Same origin binding for the set fabric: the ONE per-set audit record (W0-3) carries
      // actor:'agent' + the session/prompt context. `sandboxNamespace` arms the A.3
      // carve-out: widget-CR / restactions ops are allowed ONLY into that exact
      // namespace (absent config = they are always denied — never hand-applied).
      return applyResourceSet(proposal as unknown as ApplyResourceSetProposal, {
        handleActionSet: (ops) => handleActionSet(ops, origin),
        ...(sandboxNamespace ? { sandboxNamespace } : {}),
      })
    }

    // previewPage v2 (FE-P4): with a configured sandbox, previewPage becomes the LIVE
    // preview — validate (ajv, co-located schemas) → rewrite to the sandbox → apply via
    // the SAME runRestSet fabric (confirm skipped ONLY because every op is verified
    // sandbox-confined; provenance still records) → drawer on the root draft's REAL
    // widgetEndpoint → teardown on close. Absent config: falls through to the registry's
    // v1 zero-network source preview, byte-identical to before this branch existed.
    if (proposal.verb === 'previewPage' && sandboxNamespace) {
      return applyPreviewPageV2(proposal, {
        handleActionSet: (ops, options) => handleActionSet(ops, origin, options),
        sandboxNamespace,
        session: previewPageSession,
        sessionId: origin?.agentSessionId ?? 'unattributed',
        // A.2.35 warm-up gate: hold the drawer until the root's serve resolves all children.
        ...(snowplowBaseUrl ? { snowplowBaseUrl } : {}),
      })
    }

    // Deny-by-default via the DATA in READONLY_VERB_REGISTRY: a verb absent from the
    // registry — OR any entry declaring sideEffect:'write' — returns null (denied) and
    // never reaches a dispatch. Only a registered `read` verb whose argSchema matches is
    // compiled + driven through the same real dispatcher a hand-clicked control uses.
    const spec = READONLY_VERB_REGISTRY[proposal.verb]
    if (!spec || spec.sideEffect !== 'read' || !spec.argSchema(proposal)) {
      return null
    }
    return spec.apply(proposal, { frontendNamespace, handleAction, renderBaseUrl, routePatterns, snowplowBaseUrl })
  }, [frontendNamespace, handleAction, handleActionSet, previewPageSession, queryClient, renderBaseUrl, routePatterns, sandboxNamespace, snowplowBaseUrl])

  return { apply }
}
