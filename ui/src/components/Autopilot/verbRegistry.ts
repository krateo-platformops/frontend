/**
 * Declarative read-only verb registry (W0-1). The GOVERNING INVARIANT of the action
 * bridge — Autopilot never mutates and only drives the REAL portal through the same
 * `useHandleAction` dispatcher a Button/row-action uses — is now expressed as DATA,
 * not scattered if-branches.
 *
 * Each verb is one `VerbSpec` carrying its side-effect class (`read` | `write`), an
 * `argSchema` guard (cheap shape check on the proposal), and an `apply` handler that
 * compiles the proposal into a canonical dispatch. Deny-by-default is a property of
 * this table: a verb ABSENT from the registry — OR any entry declaring
 * `sideEffect:'write'` — is rejected at the bridge (`apply` returns null) and can
 * NEVER reach a mutating dispatch through this path. `runAction` is deliberately NOT
 * in this registry: it is a distinct, explicitly-gated branch (forces
 * requireConfirmation:true) owned by the bridge itself.
 *
 * Adding a read-only verb (e.g. the Wave-4 previewBlueprint / previewPage /
 * previewRestDef) is now a one-line entry — see `previewHandlers.ts`.
 *
 * DRAFT VERBS (frontend#429) are the third class, in their own table (DRAFT_VERB_REGISTRY): a verb
 * that edits the HELD draft in the browser — the bytes a person is composing — through the same
 * kernels and the same files-batch bus the composer's own gestures use. It never reaches the
 * apiserver, a repository or a publish: the person still previews and publishes. Deny-by-default
 * holds here too — a verb is a draft verb only when it is registered in that table with
 * `sideEffect:'draft'`, and the Builder of the held draft must also allow it (`verbs.allowed`),
 * which each verb's own handler checks before it writes. The controller verbs (controllerVerbs.ts)
 * are registered there.
 */
import { matchPath } from 'react-router'

import type { ResourcesRefs, WidgetAction } from '../../types/Widget'

import type { PortalActionProposal } from './actionBridge'
import type { SandboxWriter } from './blueprintRenderSandbox'
import type { AutopilotActionChip } from './types'

/** navigate needs no page refs; openDrawer/openModal will pass resolved refs. */
export const EMPTY_REFS: ResourcesRefs = { items: [] }

/** setExtras merges only these whitelisted URL scope params into the current path. */
export const EXTRAS_WHITELIST = ['status', 'range', 'q']

/**
 * The runtime handlers a verb's `apply` may reach — the SAME real dispatcher a
 * hand-clicked control uses, plus the flattened route patterns for validating a
 * navigate/preview target against REAL routes (a hallucinated path matches nothing
 * and is dropped). Passed in from the bridge hook so the registry stays a pure module.
 */
export interface VerbDeps {
  handleAction: (action: WidgetAction, resourcesRefs: ResourcesRefs) => Promise<void>
  /** The registered route patterns (see collectRoutePatterns). Empty = table not ready yet. */
  routePatterns: string[]
  /** PREFERRED previewBlueprint transport: snowplow base URL (config api.SNOWPLOW_API_BASE_URL,
   * always present) → previewBlueprint fetches the `blueprint-render` RESTAction via `/call`
   * (server-side render, so the ClusterIP-only render service is never browser-exposed). Paired
   * with `frontendNamespace` (the RA's namespace). */
  snowplowBaseUrl?: string
  /** The frontend namespace (config params.FRONTEND_NAMESPACE) where the `blueprint-render`
   * RESTAction lives — the `namespace` of its `/call` fetch. */
  frontendNamespace?: string
  /** LEGACY previewBlueprint transport: base URL of the Wave-4 helm-render dry-run service
   * (config api.RENDER_API_BASE_URL) for a DIRECT browser fetch. Used only as the fallback
   * when the RA transport is not available. Absent AND no RA transport → previewBlueprint
   * degrades to a graceful "unavailable" chip. */
  renderBaseUrl?: string
  /** previewBlueprint's draft transport: write the chart into the preview sandbox and render it
   * by name (blueprintRenderSandbox.ts). Absent — no sandbox configured — the chart rides ?extras. */
  sandboxWriter?: SandboxWriter
  /** The OpenAPI document a person attached in the rail (the provider's OAS store), verbatim — what
   * controllerStart reads when it is asked to start from the attachment rather than a URL or text,
   * so the model never has to reproduce the document. Absent or null: nothing is attached. */
  readAttachedSpec?: () => string | null
}

/** A declarative verb: its side-effect class, a shape guard, and its dispatch handler. */
export interface VerbSpec {
  name: string
  /**
   * `read` verbs run from READONLY_VERB_REGISTRY; `draft` verbs run from DRAFT_VERB_REGISTRY and
   * edit only the held draft; `write` is denied in both.
   */
  sideEffect: 'read' | 'draft' | 'write'
  /** Cheap shape check on the proposal — a mismatch short-circuits `apply` to null. */
  argSchema: (proposal: PortalActionProposal) => boolean
  apply: (proposal: PortalActionProposal, deps: VerbDeps) => Promise<AutopilotActionChip | null>
}

/**
 * Validate a client-side route against the registered route patterns: a hallucinated
 * path that matches no real route (e.g. `/compositions/new`, `/admin`) is a no-op,
 * never a synthesized navigation to a 404 the chat would still narrate as "opening X".
 * Fails OPEN if the route table hasn't registered yet (never block ALL navigation).
 */
export const isKnownRoute = (route: string, routePatterns: string[]): boolean => {
  const [pathname] = route.split(/[?#]/)
  return routePatterns.length === 0 || routePatterns.some((pattern) => matchPath(pattern, pathname) !== null)
}

/** A same-path URL carrying only whitelisted extras (merged by resolveNavigationTarget). */
export const buildExtrasPath = (extras: Record<string, string> | undefined): string | null => {
  if (!extras) {
    return null
  }
  const params = new URLSearchParams()
  for (const key of EXTRAS_WHITELIST) {
    if (extras[key]) {
      params.set(key, extras[key])
    }
  }
  const query = params.toString()
  return query ? `${window.location.pathname}?${query}` : null
}

/** navigate: a validated client-side route change through the real dispatcher. */
const navigateSpec: VerbSpec = {
  apply: async (proposal, deps) => {
    if (!proposal.route || !isKnownRoute(proposal.route, deps.routePatterns)) {
      return null
    }
    await deps.handleAction({ id: 'autopilot-navigate', path: proposal.route, type: 'navigate' }, EMPTY_REFS)
    return { label: proposal.label ?? `open ${proposal.route}`, readOnly: true, verb: 'navigate' }
  },
  argSchema: (proposal) => typeof proposal.route === 'string' && proposal.route.length > 0,
  name: 'navigate',
  sideEffect: 'read',
}

/** setExtras: scope the current list via whitelisted URL params (same-path navigate). */
const setExtrasSpec: VerbSpec = {
  apply: async (proposal, deps) => {
    const path = buildExtrasPath(proposal.extras)
    if (!path) {
      return null
    }
    await deps.handleAction({ id: 'autopilot-set-extras', path, type: 'navigate' }, EMPTY_REFS)
    const summary = Object.entries(proposal.extras ?? {})
      .filter(([key]) => EXTRAS_WHITELIST.includes(key))
      .map(([key, value]) => `${key}=${value}`)
      .join(' ')
    return { label: proposal.label ?? `scope ${summary}`, readOnly: true, verb: 'setExtras' }
  },
  argSchema: (proposal) => buildExtrasPath(proposal.extras) !== null,
  name: 'setExtras',
  sideEffect: 'read',
}

/**
 * openDrawer / openModal need a resourceRefId resolved against the page's allowed
 * resourcesRefs (collected from the widget cache). Deferred to the next increment;
 * the handler returns null so deny-by-default stays honest (no silent fake). Kept as
 * a read-only registry entry so the verb is declared, not merely absent.
 */
const openDrawerSpec: VerbSpec = {
  apply: () => Promise.resolve(null),
  argSchema: (proposal) => typeof proposal.resourceRefId === 'string' && proposal.resourceRefId.length > 0,
  name: 'openDrawer',
  sideEffect: 'read',
}

const openModalSpec: VerbSpec = {
  apply: () => Promise.resolve(null),
  argSchema: (proposal) => typeof proposal.resourceRefId === 'string' && proposal.resourceRefId.length > 0,
  name: 'openModal',
  sideEffect: 'read',
}

/**
 * The read-only verb registry. Deny-by-default is a property of this table: only the
 * `read` verbs present here are ever executed via the bridge's registry path. Preview
 * verbs (previewBlueprint / previewPage / previewRestDef) are appended from
 * `previewHandlers.ts` to avoid a circular import (it imports shared helpers from here).
 */
export const READONLY_VERB_REGISTRY: Record<string, VerbSpec> = {
  navigate: navigateSpec,
  openDrawer: openDrawerSpec,
  openModal: openModalSpec,
  setExtras: setExtrasSpec,
}

/** True iff the verb is a registered READ verb — the only verbs the bridge auto-applies. */
export const isReadOnlyVerb = (verb: string): boolean => READONLY_VERB_REGISTRY[verb]?.sideEffect === 'read'

/** Register a read-only verb spec (used by previewHandlers to seed the preview verbs). */
export const registerReadOnlyVerb = (spec: VerbSpec): void => {
  READONLY_VERB_REGISTRY[spec.name] = spec
}

/**
 * The DRAFT verb registry (frontend#429): verbs that edit the held draft through the composer's own
 * kernels and buses. Deny-by-default, like the read table: only a `draft` entry registered here runs
 * through it — an absent verb, or an entry declaring any other side effect, is refused at the bridge.
 */
export const DRAFT_VERB_REGISTRY: Record<string, VerbSpec> = {}

/** True iff the verb is a registered DRAFT verb. */
export const isDraftVerb = (verb: string): boolean => DRAFT_VERB_REGISTRY[verb]?.sideEffect === 'draft'

/** Register a draft verb spec (controllerVerbs.ts seeds the controller verbs on load). */
export const registerDraftVerb = (spec: VerbSpec): void => {
  DRAFT_VERB_REGISTRY[spec.name] = spec
}
