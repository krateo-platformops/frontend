/**
 * Autopilot state machine + React context. Owns the rail open state, the
 * frontend-owned session/thread id (new-thread issues a fresh one), the transcript,
 * the streaming flag, and `send()`. It wires the context collector → delta budget →
 * redactor → transport, and folds normalized frames back into the transcript.
 *
 * Mounted inside `ShellRoute` (under ConfigProvider + QueryClientProvider + Router),
 * so it has the live widget cache, identity, route, and the dispatcher the Phase-2
 * bridge will reuse. The rail/toggle render only when Autopilot is `enabled`
 * (endpoint configured, or the dev echo flag) — graceful absence otherwise.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'

import { useConfigContext } from '../../context/ConfigContext'
import type { WriteOrigin } from '../../hooks/provenance'
import { randomId } from '../../utils/utils'

import type { PortalActionProposal, PortalTour } from './actionBridge'
import { parseAutopilotDirectives, sanitizeChatText, useAutopilotActionBridge } from './actionBridge'
import { AgentDraftProvider } from './agentDraft'
import { MAX_APPLY_SET_OPS } from './applyResourceSet'
import type { ApprovalDecision, ApprovalGovernor, ApprovalPause } from './approval'
import { createApprovalGovernor, summarizeApprovalTools } from './approval'
import { useAskDeepLink } from './askDeepLink'
import { draftDisplayName, lintBlueprintDraft } from './blueprintDraft'
import { createBlueprintDraftStore } from './blueprintDraftStore'
import { createBlueprintGate } from './blueprintGate'
import { buildBlueprintPublishOps } from './blueprintPublish'
import { buildClaimPublish } from './builderClaimPublish'
import { useBuilderTargets } from './builderTargets'
import { autopilotConversationStore } from './conversationStore'
import { recordToolFrame } from './evidence'
import { dispatchKogPublish } from './kogPublishDispatch'
import { createOasAttachmentStore, type OasAttachmentResult } from './oasAttachment'
import { isPageDraft, pageRootSlug } from './pageDraft'
import { buildPagePublishOps } from './pagePublish'
import { PREVIEW_SELF_CORRECTION_NUDGE } from './previewBus'
import { onRestDefEdit } from './previewEditBus'
import { onFileEdit } from './previewFileEdit'
import { buildKogPublishNudge, createPreviewGate, hydrateRestDefinitionOps } from './previewGate'
import { AutopilotPreviewDrawer } from './previewSurface'
import { compilePublishOps, heldDraftIdentity, recordPagePreview, type PublishCompileResult } from './publishCompile'
import { askPublishDestination, PublishTargetFormHost } from './publishTargetForm'
import type { ThreadSummary } from './sessionHistoryStore'
import { a2aAuthHeader, createEchoTransport, createKagentTransport } from './transport'
import type { AutopilotActionChip, AutopilotFrame, AutopilotMessage, AutopilotTransport, EvidenceEntry, PageContextEnvelope } from './types'
import { buildContextDelta, useAutopilotContext } from './useAutopilotContext'

interface AutopilotContextValue {
  /** Whether Autopilot is CONFIGURED (endpoint present / dev echo) — controls rail + toggle
   * VISIBILITY. The toggle renders whenever this is true, even if the agent is not currently
   * reachable, so the capability stays discoverable. */
  enabled: boolean
  /** Whether the configured agent is actually USABLE right now — controls CLICKABILITY. False when
   * the installer marks Autopilot unavailable (AUTOPILOT_AVAILABLE="false", e.g. agents not
   * deployed/licensed) OR the runtime reachability probe of the endpoint fails (agent down). When
   * `enabled && !reachable` the toggle renders grayed-out and non-clickable. `null` while probing. */
  reachable: boolean
  /** Whether the docked rail is open. */
  open: boolean
  setOpen: (open: boolean) => void
  toggle: () => void
  /** The conversation transcript for the current thread. */
  messages: AutopilotMessage[]
  /** True while an assistant turn is streaming. */
  streaming: boolean
  /** Send a user turn. No-op on empty text or while streaming. */
  send: (text: string) => void
  /** Abort the in-flight assistant turn, keeping the partial answer and thread intact. */
  stop: () => void
  /** Start a new thread: abort, ARCHIVE the current thread (if it has a user turn), fresh session id. */
  newThread: () => void
  /** Past (archived) thread summaries, newest first — the rail's browsable history list. */
  sessions: () => ThreadSummary[]
  /** Switch the live view to an archived thread's transcript (by sessionId). Marks it `restored`. */
  switchToThread: (sessionId: string) => void
  /** The current session's frontend-owned id — so the history list can mark the active thread. */
  sessionId: string
  /** True when viewing a RESTORED (past) thread. v1 does not live-resume the server A2A session —
   *  the next send starts a fresh contextId (phase-2). */
  restored: boolean
  /** The kagent HITL approval pause awaiting a decision (null when none). */
  pendingApproval: ApprovalPause | null
  /** Approve the pending tool call(s) and resume the paused task. */
  approvePending: () => void
  /** Deny the pending tool call(s) — also the dismiss path (deny-by-default). */
  denyPending: () => void
  /** Snapshot the live page context (for the rail's context strip). */
  collect: () => PageContextEnvelope
  /** W4 KOG (FE-K2): the held OAS attachment's size, or null when nothing is held.
   * The DOCUMENT itself never leaves the provider's store — it is NOT in the page
   * context (collect() never sees it) and is substituted only at publish time. */
  oasAttachment: { bytes: number } | null
  /** Hold a pasted OpenAPI document (512 KiB cap). Returns the cap error on reject. */
  attachOasDocument: (text: string) => OasAttachmentResult
  /** Drop the held OAS attachment. */
  clearOasAttachment: () => void
  /** Active guided spotlight tour, if one was proposed (null otherwise). */
  tour: PortalTour | null
  /** Whether the tour overlay is open. */
  tourOpen: boolean
  /** Dismiss the active tour. */
  closeTour: () => void
}

const AutopilotReactContext = createContext<AutopilotContextValue | null>(null)

export const AutopilotProvider = ({ children }: { children: React.ReactNode }) => {
  const { config } = useConfigContext()
  const endpoint = config?.api.AUTOPILOT_API_BASE_URL
  // Dev/demo escape hatch: an "echo" endpoint (or VITE_AUTOPILOT_ECHO) drives the
  // local stub transport so the rail is exercisable before the live A2A handshake.
  const useEcho = endpoint === 'echo' || (import.meta.env.DEV && import.meta.env.VITE_AUTOPILOT_ECHO === 'true')
  const enabled = Boolean(endpoint) || useEcho

  // Availability (CLICKABILITY — distinct from `enabled`/visibility). The toggle grays out when EITHER
  //  (a) the installer marks Autopilot unavailable: config.api.AUTOPILOT_AVAILABLE === 'false' (set when
  //      agents are not deployed/licensed, features.coreAgents=false); OR
  //  (b) a runtime reachability probe of the endpoint fails (agent deployed but down/unreachable).
  // Echo/dev is always reachable. The probe re-runs when the endpoint changes and on window focus, so a
  // later-deployed or recovered agent flips the toggle live without a page reload.
  const flagAvailable = config?.api.AUTOPILOT_AVAILABLE !== 'false'
  // Per-builder publish destinations, resolved from install config (owner/repo slug) → the built-in
  // canonical fallback. Config-driven so an org/repo rename is a values change, not a rebuild.
  const builderTargets = useBuilderTargets(config)
  const [probeOk, setProbeOk] = useState(true)
  useEffect(() => {
    if (!enabled || useEcho || !flagAvailable || !endpoint) {
      return
    }
    const ctrl = new AbortController()
    // GET the A2A base, carrying the Bearer the real turns carry: a 5xx gateway error means the
    // proxy could not reach the agent upstream (not deployed / down), and 401/403 mean this user
    // cannot drive the agent at all (invalid session, or agentgateway RBAC denies them this
    // agent) — both are a dead click. Any other response (200/404/405/…) means it answered.
    const probe = () => {
      fetch(`${endpoint.replace(/\/$/, '')}/`, { headers: a2aAuthHeader(), method: 'GET', signal: ctrl.signal })
        .then((res) => setProbeOk(res.status !== 401 && res.status !== 403 && (res.status < 502 || res.status > 504)))
        .catch(() => {
          if (!ctrl.signal.aborted) {
            setProbeOk(false)
          }
        })
    }
    probe()
    window.addEventListener('focus', probe)
    return () => {
      ctrl.abort()
      window.removeEventListener('focus', probe)
    }
  }, [enabled, useEcho, flagAvailable, endpoint])
  const reachable = enabled && flagAvailable && (useEcho || probeOk)

  const { collect } = useAutopilotContext()
  const { apply } = useAutopilotActionBridge()

  const [open, setOpen] = useState(false)
  // The DURABLE conversation (transcript + thread identity) is held in a module-level
  // store, NOT component state, so it survives a provider remount. AutopilotProvider is
  // mounted under `<RouterProvider key={routerVersion}>`; a routerVersion bump (the
  // routes-as-data reload) remounts this subtree and would reset any useState to its
  // initial value — silently wiping the chat when navigating onto a freshly-registered
  // route (e.g. a composition-detail page). Reading via useSyncExternalStore re-hydrates
  // from the SURVIVING store on remount. The transcript is folded through the store's
  // `setMessages` (same value-or-updater setState contract), called directly as a stable
  // module member below — so it is NOT a hook dependency and the fold code is unchanged.
  const { contextId, messages, restored, sessionId } = useSyncExternalStore(
    autopilotConversationStore.subscribe,
    autopilotConversationStore.getSnapshot,
  )
  const { setMessages } = autopilotConversationStore
  const [streaming, setStreaming] = useState(false)
  const [tour, setTour] = useState<PortalTour | null>(null)
  const [tourOpen, setTourOpen] = useState(false)
  // Autopilot form draft (Phase 3 gated form-fill). The nonce re-keys the Form so a
  // new draft re-applies (antd initialValues is mount-only).
  const [agentDraft, setAgentDraft] = useState<Record<string, unknown> | null>(null)
  const [draftNonce, setDraftNonce] = useState(0)
  // kagent HITL (Phase 2): the current `input-required` approval pause, mirrored in
  // state for the rail card and in a ref (with its deny-by-default governor) for the
  // decision paths. Exactly one pause can be pending at a time — kagent aggregates all
  // paused tool calls of a turn into one input-required task status.
  const [pendingApproval, setPendingApproval] = useState<ApprovalPause | null>(null)
  // W4 KOG (FE-K3): the thread-scoped PREVIEW GATE — records every applied
  // previewRestDef and denies an applyResourceSet that writes restdefinitions unless
  // a matching (kind+resourceGroup) draft was previewed this thread. Reset on newThread.
  const [previewGate] = useState(createPreviewGate)
  // W4 KOG (FE-K2): the held OAS attachment. The store keeps the verbatim pasted
  // document OUTSIDE the page-context path (collect()/redactor never touch it, the
  // collected context does not grow); `oasHeld` mirrors only its SIZE for the rail.
  const [oasStore] = useState(createOasAttachmentStore)
  const [oasHeld, setOasHeld] = useState<{ bytes: number } | null>(null)
  // W4 BLUEPRINT-BUILDER: the thread-scoped BLUEPRINT preview gate (FE-BP2) records every
  // previewed chart name and denies a blueprint publish (git-write CRs / a register
  // CompositionDefinition) unless the CURRENTLY-HELD draft was previewed this thread; and
  // the held previewed chart tree (FE-BP1), kept OUTSIDE the page-context path like
  // oasStore — its bytes fill $fileContent tokens at publish-compile so published bytes ==
  // previewed bytes. Both reset on newThread.
  const [blueprintGate] = useState(createBlueprintGate)
  const [blueprintStore] = useState(createBlueprintDraftStore)

  const abortRef = useRef<(() => void) | null>(null)
  const approvalRef = useRef<{ governor: ApprovalGovernor; pause: ApprovalPause } | null>(null)
  // The governor's timeout closure calls back into dispatchDecision, which itself
  // depends on applyFrame (which arms governors) — break the useCallback cycle with a
  // ref kept current by the effect below.
  const timeoutDenyRef = useRef((_pause: ApprovalPause): void => undefined)
  // A2A conversation id AND the page-context delta base both live in the durable
  // conversation store (alongside the transcript), so a provider remount does not drop
  // thread continuity nor re-send a full page-context envelope mid-thread. The contextId is
  // assigned by the server on the first turn, replayed on follow-ups, cleared on new-thread.
  // Accumulated raw assistant text + pending proposals per in-flight turn, used to
  // finalize (strip fenced proposals, auto-apply read-only actions) on `done`.
  const assistantTextRef = useRef<Map<string, string>>(new Map())
  const proposalsRef = useRef<Map<string, PortalActionProposal[]>>(new Map())
  const evidenceRef = useRef<Map<string, EvidenceEntry[]>>(new Map())
  // Assistant turns already finalized, so a duplicate `done` frame can't re-run finalize
  // (which deletes the text buffer and would otherwise wipe the rendered answer).
  const finalizedRef = useRef<Set<string>>(new Set())
  // The user's latest message text — so finalize can gate a proposed tour on an EXPLICIT walk-me-through
  // request (the model still emits tours on direct actions despite the prompt; the host enforces it).
  const lastUserTextRef = useRef('')
  // DIRECTIVE-ERROR TRAMPOLINE (Gemini reliability): the model intermittently FUNCTION-CALLS a portal
  // verb (previewBlueprint / applyResourceSet / navigate / …) instead of emitting it as a fenced
  // directive; kagent then returns "Tool '<verb>' not found" as agent text and nothing drives (the
  // deployed prompt already forbids this — it is stochastic non-compliance, not a missing rule). When a
  // turn ends having applied NO proposal but whose text carries that error, finalize auto-recovers ONCE:
  // it re-prompts the model to re-issue the SAME action as fenced text. `sendRef` breaks the ordering
  // (send is declared after finalize); `recoveryCountRef` caps retries so a persistently-off turn can't loop.
  const sendRef = useRef<((text: string, opts?: { recovery?: boolean }) => void) | undefined>(undefined)
  const recoveryCountRef = useRef(0)

  const transport: AutopilotTransport = useMemo(() => (endpoint && endpoint !== 'echo' ? createKagentTransport(endpoint) : createEchoTransport()), [endpoint])

  // Abort any in-flight stream when the provider unmounts; disarm (without deciding)
  // any pending approval governor so its timer can't fire into an unmounted tree.
  useEffect(() => () => {
    abortRef.current?.()
    approvalRef.current?.governor.dispose()
  }, [])

  // Publish the docked rail's width as a :root CSS var so body-portalled overlays (the Filters
  // Drawer) can inset their right edge and not cover the rail. 0 when the rail is closed/disabled.
  // Kept in sync with `.apRail.open` width in AutopilotRail.module.css (384px).
  useEffect(() => {
    document.documentElement.style.setProperty('--autopilot-rail-width', enabled && open ? '384px' : '0px')
    return () => { document.documentElement.style.setProperty('--autopilot-rail-width', '0px') }
  }, [enabled, open])

  // On stream end: strip fenced `portal-action` blocks from the assistant text, then
  // auto-apply the read-only proposals (from tool_call frames + fenced blocks) through
  // the REAL dispatcher, attaching a chip per applied action. The bridge denies any
  // non-read-only verb, so this never mutates.
  const finalize = useCallback(async (assistantId: string) => {
    // A turn can receive `done` more than once (the `completed` status event AND the
    // transport's stream-close fallback). finalize() deletes the per-turn text buffer, so a
    // second run would read an empty buffer and WIPE the rendered answer. Finalize once.
    if (finalizedRef.current.has(assistantId)) {
      return
    }
    finalizedRef.current.add(assistantId)
    const rawText = assistantTextRef.current.get(assistantId) ?? ''
    const { cleanedText, proposals: textProposals, suggestions, tour: proposedTour } = parseAutopilotDirectives(rawText)
    const toolProposals = proposalsRef.current.get(assistantId) ?? []
    const evidence = evidenceRef.current.get(assistantId) ?? []
    assistantTextRef.current.delete(assistantId)
    proposalsRef.current.delete(assistantId)
    evidenceRef.current.delete(assistantId)

    setMessages((prev) => prev.map((message) => (
      message.id === assistantId
        ? { ...message, evidence, streaming: false, suggestions: suggestions.length ? suggestions : undefined, text: cleanedText }
        : message
    )))
    setStreaming(false)

    const chips: AutopilotActionChip[] = []
    // At most ONE action per reply — now ENFORCED, not just requested in the prompt. A model that
    // emits two navigates (or a duplicated tool_call + a fenced block) would otherwise run them
    // sequentially, flashing the page A then B while only the last chip's label matches. Take the first.
    const [proposal] = [...toolProposals, ...textProposals]
    if (proposal) {
      // W0-3 provenance: tag the dispatch as agent-origin with the identity context the
      // provider actually holds at dispatch time — the frontend-owned session id and the
      // user's latest chat message (the prompt that produced this proposal). If a write
      // is reached (a mutating runAction / patchField / applyResourceSet), its audit
      // record carries actor:'agent' + this context; read-only verbs never record.
      const origin: WriteOrigin = { actor: 'agent', agentSessionId: sessionId, ...(lastUserTextRef.current ? { prompt: lastUserTextRef.current } : {}) }
      // Shared tail of BOTH publish branches: a denial becomes a read-only chip; built ops flow
      // through the SAME apply (blast-radius confirm) as any model-emitted applyResourceSet.
      const pushChip = (chip: AutopilotActionChip | null) => {
        if (chip) { chips.push(chip) }
      }
      // SCM-agnostic publishing: when set, the builders emit ONE BuilderPublish claim (git-provider
      // LocalResources) instead of the github.krateo.io git-write set. Absent/anything-else → the
      // legacy github path, so existing installs are byte-identical. Flip on once git-provider + the
      // builder-publish composition are deployed.
      const publishViaClaim = config?.api.AUTOPILOT_PUBLISH_VIA_GIT_PROVIDER === 'true'
      const pushPublishOutcome = async (compiled: PublishCompileResult, label: string | undefined, deepLink: string | null = null) => {
        if (compiled.denial !== null) {
          chips.push({ label: compiled.denial, readOnly: true, verb: 'applyResourceSet' })
        } else if (compiled.ops) {
          pushChip(await apply({ label, ops: compiled.ops, verb: 'applyResourceSet' }, origin))
          if (deepLink) {
            // Option A: the branch is pushed; the human opens the PR/MR in their own SCM.
            chips.push({ label: 'Open change request', readOnly: true, url: deepLink, verb: 'openChangeRequest' })
          }
        }
      }
      if (proposal.verb === 'prefillForm') {
        // prefillForm sets provider state (not a dispatcher action): the mounted Form merges these into
        // its values; the user still reviews + submits via the form's own gate. Autopilot never submits.
        setAgentDraft(proposal.values ?? {})
        setDraftNonce((nonce) => nonce + 1)
        chips.push({ label: proposal.label ?? 'drafted the create form', readOnly: true, verb: 'prefillForm' })
      } else if (proposal.verb === 'publishBlueprint' || proposal.verb === 'publishPage') {
        // FE-BP6/BP7 — frontend-constructs-ops (blueprint + its near-identical PAGE variant, unified).
        // The model emits ONE scalar verb (repo coords only); the HOST assembles the publish from the
        // HELD previewed tree — either the github git-write set (gitrefs + per-file repocontents +
        // pullrequests, via compilePublishOps' $fileContent→base64 + authorship) OR, when
        // AUTOPILOT_PUBLISH_VIA_GIT_PROVIDER is set, ONE BuilderPublish claim (git-provider
        // LocalResources). Same destination form + blast-radius confirm either way; the shared
        // blueprintGate identity (chart / page name) enforces preview-before-publish.
        const isPage = proposal.verb === 'publishPage'
        const held = blueprintStore.get()
        const identity = heldDraftIdentity(held)
        // The BRANCH slug: a page derives it from its page-<slug> root; a blueprint reuses the identity.
        const pageSlug = held && isPageDraft(held.files) ? pageRootSlug(held.files) : null
        const slug = isPage ? pageSlug : identity
        const builder = isPage ? 'page' : 'blueprint'
        const bt = isPage ? builderTargets.page : builderTargets.blueprint
        // PER-ARTIFACT repos (#163): a portal PAGE publishes to the single configured chart repo
        // (bt.repo), but each BLUEPRINT gets its OWN repo named for the chart — so the destination
        // repo prefill is the artifact slug, with the OWNER coming from install config (bt.owner).
        // The human still confirms/edits in the blast-radius dialog; a model-emitted repo still wins.
        const destRepo = isPage ? bt.repo : (slug || bt.repo)
        const dest = await askPublishDestination(proposal, builder, destRepo, bt.owner)
        const targeted = dest ? { ...proposal, ...dest } : proposal
        const origin = { prompt: lastUserTextRef.current, sessionId }
        const overflow = isPage ? 'split the page across turns on the same branch' : 'trim the chart tree (large assets belong in a hosted values file)'
        let compiled: PublishCompileResult
        let deepLink: string | null = null
        if (!dest) {
          compiled = { denial: 'publish cancelled — destination not confirmed', ops: null }
        } else if (!held || !slug || !identity) {
          compiled = { denial: `denied — no previewed ${isPage ? 'portal page' : 'blueprint'} to publish (draft + preview a ${isPage ? 'page-<slug>' : 'chart'} first)`, ops: null }
        } else if (publishViaClaim) {
          const files = Object.entries(held.files).map(([path, content]) => ({ content, path }))
          if (files.length > MAX_APPLY_SET_OPS) {
            compiled = { denial: `denied — "${slug}" has ${files.length} files; a single publish tops out at ${MAX_APPLY_SET_OPS} — ${overflow}.`, ops: null }
          } else {
            const res = await buildClaimPublish({ builder, config, dest, files, gate: (ops) => blueprintGate.evaluate(ops, identity), namespace: 'krateo-system', origin, slug })
            compiled = res.compiled
            deepLink = res.deepLink
          }
        } else {
          const built = isPage ? buildPagePublishOps(targeted, held, slug) : buildBlueprintPublishOps(targeted, held, slug)
          if (built.length > MAX_APPLY_SET_OPS) {
            compiled = { denial: `denied — "${slug}" has ${Object.keys(held.files).length} files; a single publish tops out at ${MAX_APPLY_SET_OPS - 2} — ${overflow}.`, ops: null }
          } else {
            compiled = compilePublishOps(built, previewGate.evaluate(built), blueprintGate.evaluate(built, identity), oasStore.get(), held, origin)
          }
        }
        await pushPublishOutcome(compiled, proposal.label, deepLink)
      } else if (proposal.verb === 'publishRestDef') {
        // FE-KOG-PR (item #30) — the controller builder publishes via a git PR (github) OR, when
        // AUTOPILOT_PUBLISH_VIA_GIT_PROVIDER is set, a BuilderPublish claim. The dispatch (destination
        // form + KOG preview gate + compile) is factored into dispatchKogPublish.
        const { compiled, deepLink } = await dispatchKogPublish(proposal, {
          config,
          kogTarget: builderTargets.kog,
          oasText: oasStore.get()?.text ?? null,
          origin: { prompt: lastUserTextRef.current, sessionId },
          previewGate,
          publishViaClaim,
        })
        await pushPublishOutcome(compiled, proposal.label, deepLink)
      } else if (proposal.verb === 'applyResourceSet') {
        // Publish path, enforced HERE (finalize is the single entry point for model
        // proposals). Host-side checks BEFORE the bridge ever dispatches — a denial is the
        // standard denied chip (nothing dispatched, readOnly/honest):
        //  1a. KOG PREVIEW GATE (FE-K3): a set writing restdefinitions needs a matching
        //      (kind+resourceGroup) previewRestDef this thread.
        //  1b. BLUEPRINT PREVIEW GATE (FE-BP2): a blueprint publish (git-write CRs / a
        //      register CompositionDefinition) needs the CURRENTLY-HELD draft previewed.
        //  2a. $oasAttachment substitution (FE-K2): the held OAS replaces the token.
        //  2b. $fileContent substitution (FE-BP1): the held chart tree replaces per-file
        //      tokens, so published bytes == previewed bytes.
        //  3.  AUTHORSHIP stamp (FE-BP3): host-inject managed-by/authored-by/session/prompt
        //      onto every authored object (ownership can't be omitted or spoofed).
        // All at compile time — BEFORE the blast-radius confirm, so the human confirms the
        // REAL, owned payload.
        const held = blueprintStore.get()
        // The held draft's identity for the preview-gate — page slug or blueprint chart name
        // (heldDraftIdentity); the SAME store/gate/substitution serve both (FE-P2 reuses FE-BP1/BP2).
        const heldChartName = heldDraftIdentity(held)
        const { denial, ops: compiledOps } = compilePublishOps(
          hydrateRestDefinitionOps(proposal.ops, previewGate.lastDraft()),
          previewGate.evaluate(proposal.ops),
          blueprintGate.evaluate(proposal.ops, heldChartName),
          oasStore.get(),
          held,
          { prompt: lastUserTextRef.current, sessionId },
        )
        if (denial !== null) {
          chips.push({ label: denial, readOnly: true, verb: 'applyResourceSet' })
        } else if (compiledOps) {
          pushChip(await apply({ ...proposal, ops: compiledOps }, origin))
        }
      } else {
        const chip = await apply(proposal, origin)
        if (chip) {
          chips.push(chip)
          // W4 KOG (FE-K3): an APPLIED previewRestDef (chip ⇒ the drawer opened on a
          // parseable draft) arms the preview gate for that draft's kind+resourceGroup.
          if (proposal.verb === 'previewRestDef') {
            previewGate.recordPreview(proposal.restDefinition)
          } else if (proposal.verb === 'previewBlueprint' && proposal.rawTemplates && lintBlueprintDraft(proposal.rawTemplates).length === 0) {
            // FE-BP1/BP2: an APPLIED, lint-clean inline-draft previewBlueprint HOLDS the
            // previewed tree (so publish substitutes the SAME bytes) and arms the blueprint
            // gate for its Chart.yaml name. A remote-chart preview (no rawTemplates) holds
            // nothing — there is no authored tree to publish via git.
            const draft = blueprintStore.set(proposal.rawTemplates)
            if (draft.ok) { blueprintGate.recordPreview(draftDisplayName(draft.held.files)) }
          } else if (proposal.verb === 'previewPage') {
            // FE-P2: an APPLIED previewPage holds its widget CRs as a page draft + arms the shared
            // gate (recordPagePreview) — a page publish (RepoContent → krateo-portal-chart) is then
            // allowed ONLY after the SAME page was previewed this thread. FE-P1's ajv verdicts
            // (drawer) + CHART-P2's PR CI are the correctness gates; this is the preview gate.
            recordPagePreview(proposal.widgets, proposal.nav, blueprintStore, blueprintGate)
          }
        }
      }
    }
    if (chips.length) {
      setMessages((prev) => prev.map((message) => (
        message.id === assistantId ? { ...message, actions: chips } : message
      )))
    }

    // PREVIEW-VALIDATION TRAMPOLINE (FE-P5): an ajv-rejected previewPage self-corrects WITHOUT the human
    // asking — ONE hidden recovery turn; the every-turn PREVIEW SELF-CORRECTION directive drives the re-emit.
    if (chips.some((chip) => /^preview blocked — \d+ validation error/.test(chip.label)) && recoveryCountRef.current < 1) {
      recoveryCountRef.current += 1
      setTimeout(() => sendRef.current?.(PREVIEW_SELF_CORRECTION_NUDGE, { recovery: true }), 0)
      return
    }

    // DIRECTIVE-ERROR TRAMPOLINE (see sendRef/recoveryCountRef note above). No proposal was applied and
    // the reply text carries a kagent "Tool '<portal verb>' not found" — the model function-called a
    // directive instead of writing it as fenced text. Recover ONCE per user turn: hide the raw error and
    // re-prompt for the SAME action as a fenced directive. Restricted to the KNOWN portal verbs so a real
    // tool typo is never swallowed. Returns early (an errored turn proposes nothing to tour).
    if (!proposal && recoveryCountRef.current < 1) {
      const toolNotFound = /\bTool ['"`]?(navigate|setExtras|openDrawer|openModal|prefillForm|runAction|previewBlueprint|previewPage|previewRestDef|explainUpgradeImpact|describeResource|patchField|applyResourceSet)['"`]? (?:is |was )?not found/i.exec(cleanedText)
      if (toolNotFound) {
        recoveryCountRef.current += 1
        const [, verb] = toolNotFound
        setMessages((prev) => prev.map((message) => (message.id === assistantId ? { ...message, text: '↻ One moment — re-issuing that step correctly…' } : message)))
        const nudge = `Your previous turn tried to CALL \`${verb}\` as a function — it failed with "tool not found". \`${verb}\` is NOT a tool; it is a portal directive you REQUEST by WRITING a fenced code block in your reply TEXT (per the portal capabilities protocol you were given). Re-issue the SAME action now as a fenced portal directive block — do not call any tool by that name.`
        // Defer so finalize's state (streaming:false) commits before the recovery turn opens its bubble.
        setTimeout(() => sendRef.current?.(nudge, { recovery: true }), 0)
        return
      }

      // NARRATED-PUBLISH TRAMPOLINE: the model approved-published in PROSE but emitted no
      // applyResourceSet fence (the exact rail-publish stall) — so nothing was proposed and no
      // blast-radius dialog opened. If the user's last message was an approval AND a previewed
      // blueprint draft is held, re-prompt ONCE to emit STEP A (emitting the fence IS the gate).
      const held = blueprintStore.get()
      const heldName = heldDraftIdentity(held)
      const approvedPublish = /\b(publish|open the (?:pull request|pr|merge request|mr)|go ahead|do it|approve|proceed|looks good|ship it)\b/i.test(lastUserTextRef.current)
      if (held && heldName && approvedPublish) {
        recoveryCountRef.current += 1
        setMessages((prev) => prev.map((message) => (message.id === assistantId ? { ...message, text: '↻ One moment — preparing the change request…' } : message)))
        // Re-issue the scalar publish verb that matches the held draft: a page draft (no Chart.yaml)
        // → publishPage (FE-BP7), a blueprint chart → publishBlueprint (FE-BP6). The host fans either
        // out; the model must NEVER hand-write the multi-op payload (that is the stall we recover from).
        const pageSlug = isPageDraft(held.files) ? pageRootSlug(held.files) : null
        const scalarVerb = pageSlug
          ? `{"verb":"publishPage","owner":"${builderTargets.page.owner}","repo":"${builderTargets.page.repo}","base":"main","configurationRef":"github-blueprints-config","namespace":"krateo-system","title":"builder: page ${pageSlug}","body":"<one-line summary>"}`
          : `{"verb":"publishBlueprint","owner":"${builderTargets.blueprint.owner}","repo":"${builderTargets.blueprint.repo}","base":"main","configurationRef":"github-blueprints-config","namespace":"krateo-system","title":"feat(${heldName}): add ${heldName} blueprint","body":"<one-line summary>"}`
        const fanout = pageSlug
          ? 'the gitrefs + per-file repocontents (widget CRs + the nav fragment) + pullrequests set from the held page'
          : 'the gitrefs/repocontents/pullrequests set from the held tree'
        const nudge = `You approved publishing \`${heldName}\` but your reply contained NO portal-action fence, so nothing was proposed and no confirm dialog opened. Do NOT say the user "will be asked to confirm" — EMITTING the fence is ITSELF what opens the blast-radius dialog. Re-issue the PUBLISH step NOW as a single fenced \`\`\`portal-action block containing ONLY this one scalar verb: ${scalarVerb}. The portal fans that out into ${fanout} — you do NOT write those ops yourself.`
        setTimeout(() => sendRef.current?.(nudge, { recovery: true }), 0)
        return
      }

      // NARRATED-KOG-PUBLISH TRAMPOLINE: same stall class, RestDefinition variant — a previewed
      // API mapping was approved in prose but no applyResourceSet fence followed. The gate holds
      // the previewed draft; the nudge (previewGate.buildKogPublishNudge) rebuilds the exact op
      // shape (2-op $oasAttachment paste case / 1-op URL case) so the re-prompt is mechanical.
      const lastRestDef = previewGate.lastDraft()
      if (lastRestDef && approvedPublish) {
        recoveryCountRef.current += 1
        setMessages((prev) => prev.map((message) => (message.id === assistantId ? { ...message, text: '↻ One moment — opening the confirm…' } : message)))
        setTimeout(() => sendRef.current?.(buildKogPublishNudge(lastRestDef, Boolean(oasStore.get()), builderTargets.kog), { recovery: true }), 0)
        return
      }
    }

    // Start a guided spotlight tour AFTER applying the proposals, so a navigate/prefill in
    // the same reply has settled the destination page / filled the form before the tour
    // resolves its DOM anchors (an unsettled page would degrade every step to centered).
    // Host-side tour gate: honor a proposed tour ONLY if the user literally asked to be walked through.
    // The prompt says tours are off-by-default, but the model still emits them on direct actions
    // ("install it for me"); the host enforces the rule deterministically (prompts decay across a thread).
    const userAskedForTour = /\b(walk me through|guide me|show me around|walk through)\b/i.test(lastUserTextRef.current)
    if (proposedTour && userAskedForTour) {
      setTour(proposedTour)
      setTourOpen(true)
    }
  }, [apply, blueprintGate, blueprintStore, builderTargets, config, oasStore, previewGate, sessionId, setMessages])

  const applyFrame = useCallback((assistantId: string, frame: AutopilotFrame) => {
    switch (frame.kind) {
      case 'text': {
        const current = assistantTextRef.current.get(assistantId) ?? ''
        const next = frame.replace ? frame.delta : current + frame.delta
        // Keep the RAW text in the buffer (finalize parses directive fences from it), but render a
        // sanitized view so a raw tool-call echo never flashes on screen mid-stream.
        assistantTextRef.current.set(assistantId, next)
        const rendered = sanitizeChatText(next)
        setMessages((prev) => prev.map((message) => (
          message.id === assistantId ? { ...message, text: rendered } : message
        )))
        break
      }
      case 'session':
        autopilotConversationStore.setContextId(frame.contextId)
        break
      case 'tool_call':
        if (frame.name === 'propose_portal_action' && frame.args && typeof frame.args === 'object') {
          proposalsRef.current.set(assistantId, [...(proposalsRef.current.get(assistantId) ?? []), frame.args as PortalActionProposal])
        } else {
          evidenceRef.current.set(assistantId, recordToolFrame(evidenceRef.current.get(assistantId) ?? [], frame))
        }
        break
      case 'tool_result':
        evidenceRef.current.set(assistantId, recordToolFrame(evidenceRef.current.get(assistantId) ?? [], frame))
        break
      case 'error':
        assistantTextRef.current.delete(assistantId)
        proposalsRef.current.delete(assistantId)
        evidenceRef.current.delete(assistantId)
        setMessages((prev) => prev.map((message) => (
          message.id === assistantId
            ? { ...message, streaming: false, text: `${message.text}\n\n⚠ ${frame.message}`.trim() }
            : message
        )))
        setStreaming(false)
        break
      case 'done':
        void finalize(assistantId)
        break
      case 'require_approval': {
        // kagent paused on a `requireApproval` tool call (task → input-required).
        // Store the pause for the rail card and arm DENY-BY-DEFAULT: an unattended
        // approval self-denies after 5 minutes (via timeoutDenyRef, kept current below).
        approvalRef.current?.governor.dispose()
        const governor = createApprovalGovernor(() => timeoutDenyRef.current(frame.pause))
        approvalRef.current = { governor, pause: frame.pause }
        setPendingApproval(frame.pause)
        break
      }
      default:
        break
    }
  }, [finalize, setMessages])

  // Send a HITL decision over A2A (the `{decision_type}` DataPart on the paused task —
  // see approval.ts) and stream the agent's continuation into a NEW assistant bubble,
  // stamped with a decision chip so the transcript records what was decided.
  //
  // PROVENANCE — assessed and SKIPPED (deliberately): the W0-3 fabric on this branch
  // (recordProvenance) audits PORTAL writes and requires a BlastRadius (verb + GVR +
  // namespace of the apiserver target) plus an HTTP outcome. A kagent approval carries
  // only {toolName, args}; deriving a GVR/namespace would mean client-side parsing of
  // the manifest string (against the server-side-computation rule, and a fabrication
  // risk), and emitAuditRecord hard-skips records with no resolvable namespace anyway.
  // Forcing the mapping would produce empty/false audit targets — the kagent task
  // history already records the decision server-side. Revisit if the AuditRecord CRD
  // grows a tool-approval action shape.
  const dispatchDecision = useCallback((decision: ApprovalDecision, pause: ApprovalPause, chipLabel: string) => {
    const assistantId = randomId()
    setMessages((prev) => [
      ...prev,
      { actions: [{ label: chipLabel, readOnly: decision.type === 'reject', verb: 'approval' }], createdAt: Date.now(), id: assistantId, role: 'assistant', streaming: true, text: '' },
    ])
    setStreaming(true)
    abortRef.current = transport.respondToApproval(decision, pause, { onFrame: (frame) => applyFrame(assistantId, frame) })
  }, [applyFrame, setMessages, transport])

  // Keep the governor-timeout path pointing at the CURRENT dispatchDecision (the
  // governor closure is created inside applyFrame and must not go stale).
  useEffect(() => {
    timeoutDenyRef.current = (pause: ApprovalPause) => {
      approvalRef.current = null
      setPendingApproval(null)
      dispatchDecision(
        { reason: 'Auto-denied: no decision within 5 minutes (deny-by-default).', type: 'reject' },
        pause,
        `timed out — denied ${summarizeApprovalTools(pause)}`,
      )
    }
  }, [dispatchDecision])

  // User-driven decision (Approve / Deny / dismiss). The governor's settle() is the
  // single-decision gate: false means the pause was already decided or timed out.
  const resolveApproval = useCallback((decision: ApprovalDecision) => {
    const active = approvalRef.current
    if (!active || !active.governor.settle()) {
      return
    }
    approvalRef.current = null
    setPendingApproval(null)
    const tools = summarizeApprovalTools(active.pause)
    dispatchDecision(decision, active.pause, decision.type === 'approve' ? `approved ${tools}` : `denied ${tools}`)
  }, [dispatchDecision])

  const approvePending = useCallback(() => resolveApproval({ type: 'approve' }), [resolveApproval])
  const denyPending = useCallback(
    () => resolveApproval({ reason: 'Denied by the user in the Autopilot rail.', type: 'reject' }),
    [resolveApproval],
  )

  const send = useCallback((text: string, opts?: { recovery?: boolean }) => {
    const trimmed = text.trim()
    const recovery = opts?.recovery === true
    // A user turn is blocked while a stream is in flight; an internal recovery turn is NOT (it fires from
    // finalize, right after the errored turn ends, and must be allowed through to correct it).
    if (!trimmed || (streaming && !recovery)) {
      return
    }
    // Only a real user turn (re)sets the trusted "last prompt" used for write-provenance + the tour gate,
    // and refills the recovery budget. A recovery turn must not overwrite the user's audited prompt nor
    // grant itself more retries.
    if (!recovery) {
      lastUserTextRef.current = trimmed
      recoveryCountRef.current = 0
    }

    const envelope = collect()
    const baseContext = buildContextDelta(envelope, autopilotConversationStore.getLastEnvelope())
    autopilotConversationStore.setLastEnvelope(envelope)

    const assistantId = randomId()
    const now = Date.now()
    setMessages((prev) => [
      ...prev,
      // A recovery turn carries no user bubble — the user never typed the nudge; they see only the
      // corrected assistant reply that follows the "re-issuing…" note.
      ...(recovery ? [] : [{ createdAt: now, id: randomId(), role: 'user' as const, text: trimmed }]),
      { createdAt: now, id: assistantId, role: 'assistant', streaming: true, text: '' },
    ])
    setStreaming(true)

    abortRef.current = transport.send({ context: baseContext, contextId, sessionId, text: trimmed }, { onFrame: (frame) => applyFrame(assistantId, frame) })
  }, [applyFrame, collect, contextId, sessionId, setMessages, streaming, transport])

  // Keep the finalize-side recovery trampoline pointing at the CURRENT send closure.
  useEffect(() => { sendRef.current = send }, [send])

  const stop = useCallback(() => {
    // Abort the in-flight stream but keep the thread: the partial assistant answer stays,
    // the session/contextId are untouched (a follow-up continues the same conversation).
    abortRef.current?.()
    abortRef.current = null
    setStreaming(false)
    // Settle any still-streaming bubble so the UI drops the caret and re-enables the composer.
    setMessages((prev) => prev.map((message) => (message.streaming ? { ...message, streaming: false } : message)))
  }, [setMessages])

  // Tear down all PER-THREAD, in-flight machinery — shared by newThread (archive-then-reset)
  // and switchToThread (load an archived transcript). Everything here is thread-scoped state
  // that must NOT bleed across a thread boundary; the caller decides what the store does next.
  const teardownThread = useCallback(() => {
    abortRef.current?.()
    abortRef.current = null
    // DENY-BY-DEFAULT on thread reset: a pending approval is rejected (fire-and-forget,
    // no-op handlers — the new thread does not render the released task's stream) so
    // the paused kagent task is never left dangling toward an approve.
    const active = approvalRef.current
    if (active && active.governor.settle()) {
      transport.respondToApproval(
        { reason: 'Denied: the user started/switched threads (deny-by-default).', type: 'reject' },
        active.pause,
        { onFrame: () => undefined },
      )
    }
    approvalRef.current = null
    setPendingApproval(null)
    recoveryCountRef.current = 0
    assistantTextRef.current.clear()
    proposalsRef.current.clear()
    evidenceRef.current.clear()
    finalizedRef.current.clear()
    setStreaming(false)
    setTour(null)
    setTourOpen(false)
    // Clear any pending form draft and re-key (bump nonce) so the form reverts to base.
    setAgentDraft(null)
    setDraftNonce((nonce) => nonce + 1)
    // W4 KOG + BLUEPRINT: the preview gates are THREAD-scoped — a new thread forgets every
    // recorded preview (publish is denied again until re-previewed), and the held OAS
    // attachment + blueprint draft are dropped with the conversation that produced them
    // (deny-by-default posture).
    previewGate.reset()
    blueprintGate.reset()
    oasStore.clear()
    blueprintStore.clear()
    setOasHeld(null)
  }, [blueprintGate, blueprintStore, oasStore, previewGate, transport])

  const newThread = useCallback(() => {
    teardownThread()
    // Reset the durable conversation store in one shot: empty transcript, fresh session id,
    // cleared A2A contextId, cleared page-context delta base (so the first turn of the new
    // thread sends the full envelope again, not an "Unchanged:" note against the old one).
    // ARCHIVE (not discard) the outgoing thread first when it has a user turn, so a new
    // thread no longer loses the old one — it stays browsable in the rail's history list.
    autopilotConversationStore.archiveAndReset()
  }, [teardownThread])

  // Session history (item P): switch the live view to a previously-archived thread. The
  // store archives the CURRENT thread first (so switching never loses it), then loads the selected
  // transcript for VIEWING (marked `restored`). v1 does NOT live-resume the server A2A session (the
  // next send starts a fresh contextId); the rail's "viewing a past session" hint keeps that honest.
  const switchToThread = useCallback((id: string) => {
    if (id === sessionId) { return }
    teardownThread()
    autopilotConversationStore.loadThread(id)
  }, [sessionId, teardownThread])

  // W4 KOG (FE-K2): hold / drop a pasted OpenAPI document. The text lives ONLY in the
  // provider's store (never in the page-context envelope), mirrored as a byte count.
  const attachOasDocument = useCallback((text: string): OasAttachmentResult => {
    const result = oasStore.set(text)
    // Mirror whatever the store now holds (a rejected over-cap paste keeps a prior hold).
    const held = oasStore.get()
    setOasHeld(held ? { bytes: held.bytes } : null)
    return result
  }, [oasStore])

  const clearOasAttachment = useCallback(() => {
    oasStore.clear()
    setOasHeld(null)
  }, [oasStore])

  // FE-K(edit): the preview drawer lets the user EDIT the previewed RestDefinition source and
  // apply it. An accepted edit arrives here on the edit bus; recording it into the preview gate
  // re-arms the gate with the edited draft and makes it the LAST draft — so the subsequent KOG
  // publish (resolveKogPublishDraft(previewGate.lastDraft())) commits the EDITED bytes. recordPreview
  // re-validates once more (deny-by-default: an invalid edit arms nothing), and the drawer only
  // emits a clean edit anyway, so the held bytes are exactly the human-edited bytes.
  useEffect(() => onRestDefEdit(({ draft }) => previewGate.recordPreview(draft)), [previewGate])

  // FE-K(edit), page/blueprint half: an accepted "Files"-tab per-file edit arrives on the file-edit bus.
  // updateFile replaces that file's bytes in the held tree (deny-by-default: an over-cap / unknown-path
  // edit is rejected and the held tree stays put); on success we re-arm the page/blueprint gate for the
  // held draft's identity. The edited bytes then publish UNCHANGED via the $fileContent substitution —
  // published == the human-edited bytes, never retyped by the model.
  useEffect(() => onFileEdit(({ content, path }) => {
    if (blueprintStore.updateFile(path, content).ok) { blueprintGate.recordPreview(heldDraftIdentity(blueprintStore.get())) }
  }), [blueprintGate, blueprintStore])

  const toggle = useCallback(() => setOpen((prev) => !prev), [])
  const closeTour = useCallback(() => setTourOpen(false), [])

  // The `?ask=` deep-link (Diagnose / Troubleshoot buttons): enabled → open the rail
  // and seed one turn; disabled → honest UX-19 notice. All in useAskDeepLink.
  useAskDeepLink(enabled, useCallback((ask: string) => {
    setOpen(true)
    send(ask)
  }, [send]))

  // `sessions` is a stable bound-free store method (closes over its own state, no `this`) — passed
  // through directly; it reads the archive lazily each call, re-read on every provider re-render.
  const value = useMemo<AutopilotContextValue>(() => ({
    approvePending, attachOasDocument, clearOasAttachment, closeTour, collect, denyPending, enabled, messages, newThread, oasAttachment: oasHeld, open, pendingApproval, reachable, restored, send, sessionId, sessions: autopilotConversationStore.sessions, setOpen, stop, streaming, switchToThread, toggle, tour, tourOpen,
  }), [approvePending, attachOasDocument, clearOasAttachment, closeTour, collect, denyPending, enabled, messages, newThread, oasHeld, open, pendingApproval, reachable, restored, send, sessionId, stop, streaming, switchToThread, toggle, tour, tourOpen])

  return (
    <AutopilotReactContext.Provider value={value}>
      <AgentDraftProvider value={{ draft: agentDraft, nonce: draftNonce }}>
        {children}
        {/* Wave-4 preview surface: the read-only preview verbs (previewBlueprint /
            previewPage / previewRestDef) render into this global drawer. */}
        <AutopilotPreviewDrawer />
        {/* The publish-destination form (user-owned owner/repo/base, asked at every publish). */}
        <PublishTargetFormHost />
      </AgentDraftProvider>
    </AutopilotReactContext.Provider>
  )
}

export const useAutopilot = (): AutopilotContextValue => {
  const context = useContext(AutopilotReactContext)
  if (!context) {
    throw new Error('useAutopilot must be used within an AutopilotProvider')
  }
  return context
}
