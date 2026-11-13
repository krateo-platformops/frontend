import { useQueryClient } from '@tanstack/react-query'
import useApp from 'antd/es/app/useApp'
import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router'

import { buildBlastRadius, isMutatingVerb } from '../components/BlastRadius/buildBlastRadius'
import { useConfigContext } from '../context/ConfigContext'
import { useRoutesContext } from '../context/RoutesContext'
import { formSubmitInteraction, startFormSubmit, type FormSubmitInteraction, type InteractionHeld } from '../otel/interactions'
import { SIGN_IN_TO_ACT, useWidgetTransport } from '../transport/widgetTransport'
import type { ResourceRef, ResourcesRefs, Widget, WidgetAction } from '../types/Widget'
import { jqText, useResolveJqExpression } from '../utils/jq-expression'
import { navigateOrExternal } from '../utils/navigation'
import { omitSecretPaths, redactSecretValues, secretValuesOf, type SecretPath } from '../utils/secretFields'
import { SecretExpressionError } from '../utils/secretJq'
import type { RestApiResponse } from '../utils/types'
import { getHeadersObject, getResourceRef } from '../utils/utils'
import { closeDrawer, openDrawer } from '../widgets/Drawer/Drawer'
import { openModal } from '../widgets/Modal/Modal'

import { interpolateRedirectUrl, resolveNavigationTarget, updateNameNamespace } from './actionUrls'
import type { BlastRadius, BlastRadiusSet } from './blastRadius.types'
import { buildPayloadDetailed, templateJqInput } from './buildPayload'
import { writeTargetName } from './callPath'
import { withoutProvenanceHeader } from './callProvenance'
import { buildConfirmModalProps, confirmWithTimeout } from './confirmModalProps'
import { beginWriteProvenance, stampAgentCreated, type WriteOrigin, type WriteProvenance } from './provenance'
import { runRestFanOut } from './runRestFanOut'
import { runRestOps } from './runRestOps'
import { runRestSet, type SetDispatchOptions, type WriteOp, type WriteOpResult } from './runRestSet'
import { snowplowReadsCallProvenance } from './snowplowCapabilities'
import type { SseSubscriber } from './sseClient'

/**
 * How long a blast-radius confirm may sit unanswered before it DENIES.
 *
 * Deliberately the same five minutes as the Agentiko approval governor
 * (`components/Agentiko/approval.ts`), and deliberately duplicated rather than imported: this
 * hook gates every portal write, human or agent, and must not take a dependency on the
 * Agentiko component tree to do it. If one moves, move the other.
 */
const CONFIRM_TIMEOUT_MS = 5 * 60 * 1000

interface EventData {
  involvedObject: {
    uid: string
  }
  reason: string
}

/**
 * Background re-invalidation delays (ms) after a successful mutating rest action.
 * snowplow can read the just-written object through an informer/watch-cache that
 * lags the write, so the single immediate refetch can land on pre-write state.
 * These staggered background refetches converge the UI without a manual refresh;
 * the spread covers both fast and slow (loaded-node) propagation.
 */
export const POST_WRITE_REVALIDATE_DELAYS_MS = [800, 2200]

/**
 * fetch with an abort-based timeout so an action request can't hang forever
 * (no native fetch timeout). Aborts after `ms`; the AbortError propagates to the
 * caller's catch. The timer is always cleared, including when fetch rejects.
 */
export const fetchWithTimeout = async (input: string, init: RequestInit, ms = 30000): Promise<Response> => {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), ms)
  try {
    return await fetch(input, { ...init, signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Parse an action response body that may be empty. A successful DELETE (or any
 * 204) carries no body, so res.json() would throw on empty input; treat an
 * empty/whitespace body as {} (a valid, all-optional RestApiResponse).
 */
export const parseJsonResponse = (text: string): RestApiResponse => {
  return text.trim() ? (JSON.parse(text) as RestApiResponse) : {}
}

// buildPayload moved to ./buildPayload (max-lines); re-exported for its existing importers.
export { buildPayload, buildPayloadDetailed, templateJqInput } from './buildPayload'
// The three pure URL helpers moved to ./actionUrls, for the same reason; same re-export.
export { interpolateRedirectUrl, resolveNavigationTarget, updateNameNamespace } from './actionUrls'

/** Per-invocation data for an action (the widget instance it fires from). */
export interface ActionRuntime {
  resourcesRefs: ResourcesRefs
  /**
   * X2 — ids the RBAC filter removed from `resourcesRefs.items`, exactly as
   * `WidgetProps.deniedRefIds` carries them for rendering. Without it this path cannot tell a
   * DENIED ref from a TYPO'D one: the filter has already made them byte-identical, both simply
   * absent. WidgetRenderer got the distinction; the action path did not, so every denial was
   * reported as a broken widget definition — blaming the author for the viewer's permissions.
   */
  deniedRefIds?: string[]
  customPayload?: Record<string, unknown>
  /**
   * The submitting form's SECRET fields (`format: password` / `writeOnly`), as paths into
   * `customPayload`. They are never sent to `/jq` — see buildPayload and utils/secretJq.ts.
   */
  secretPaths?: readonly SecretPath[]
  widget?: Widget
  /** W0-3 origin tag: who initiated the write. Absent = a hand-clicked control ({actor:'human'});
   * the Agentiko bridge sets actor:'agent' + the session/prompt context it holds. */
  origin?: WriteOrigin
  /**
   * X5 — the SLO interaction this dispatch IS, and the templated route it happened on. Set only by
   * the Form widget (`krateo.form.submit`); absent everywhere else, and absent when no templated
   * route resolved, in which case nothing is measured rather than measured under a wrong route.
   *
   * THE SPAN IS STARTED HERE AND NOT BY THE CALLER, because the contract's boundary is "after
   * validation AND after confirm": the caller cannot see the end of the HITL gate, and a gate the
   * user can leave open for five minutes would dominate every p95 it entered.
   */
  interaction?: FormSubmitInteraction
}

/**
 * Everything the dispatcher needs from the outside, injected by the hook. Pulling
 * dispatch out of the React hook makes it a plain async function that can be unit
 * tested with a mocked context (no RTL/jsdom) and turns the per-type cases into a
 * small registry.
 */
export interface ActionContext {
  apiBaseUrl: string
  eventsBaseUrl: string
  navigate: (path: string) => void | Promise<void>
  /**
   * The HITL gate. When a `radius` is supplied (mutating verbs) the confirm modal renders
   * the structured BlastRadiusConfirm — the scalar verb+gvr+cluster/ns+count+diff shape, or
   * the aggregated W0-4 SET shape (ordered op list) for an applySet; otherwise it falls
   * back to the plain "Are you sure?" prompt (read-only navigate opt-in). Resolves true only
   * when the human clicks Confirm.
   */
  confirm: (radius?: BlastRadius | BlastRadiusSet) => Promise<boolean>
  resolveJq: (expression: string, values: Record<string, unknown>) => Promise<unknown>
  setLoading: (loading: boolean) => void
  invalidateQueries: () => Promise<unknown>
  reloadRoutes: () => void | Promise<void>
  getAccessToken: () => string
  /**
   * The shared signed-in SSE client, for an action that waits on an event (`onEventNavigateTo`).
   * The session's (transport/widgetTransport.ts), like `getAccessToken`: this module imports no SSE
   * client, and without a session there is none — the action is refused before it would subscribe.
   */
  subscribeSse: (url: string, topic: string, subscriber: SseSubscriber) => () => void
  /**
   * False when the transport in scope makes no writes (`WidgetTransport.writes`) — a public page. A snowplow write
   * (`rest`) is then refused before anything is sent: no capability probe, no /jq, no write, no
   * audit record — the person is told to sign in. Absent means signed in, so a context built
   * without it (every unit test) behaves exactly as before; the hook below always sets it.
   */
  writes?: boolean
  openDrawer: typeof openDrawer
  openModal: typeof openModal
  closeDrawer: typeof closeDrawer
  message: ReturnType<typeof useApp>['message']
  notification: ReturnType<typeof useApp>['notification']
  /** Register a teardown to run if the widget unmounts mid-action (e.g. close an SSE stream). */
  registerCleanup: (cleanup: () => void) => void
  /** W0-3 provenance flag (config.json api.PROVENANCE_ENABLED, default ON; only an explicit
   * "false" opts out). When enabled, every gated write carries the X-Krateo-Provenance header
   * (snowplow advertises `call.provenance`) or else fire-and-forgets ONE best-effort AuditRecord
   * CR after it resolves — see hooks/provenance.ts beginWriteProvenance. */
  provenanceEnabled: boolean
  /** Whether this snowplow advertises `call.provenance` (hooks/snowplowCapabilities.ts: read once
   * per session, false on an older snowplow or an unreadable /capabilities). */
  supportsCallProvenance: () => Promise<boolean>
}

const runNavigate = async (action: WidgetAction & { type: 'navigate' }, runtime: ActionRuntime, ctx: ActionContext): Promise<void> => {
  if (!action.path) {
    // Navigation must target a real route via `path`. The legacy resourceRefId →
    // `?widgetEndpoint=` content-swap bypass is removed.
    ctx.message.destroy()
    ctx.notification.error({
      description: 'A navigate action must specify a `path` (the route to navigate to).',
      message: 'Error while executing the action',
      placement: 'bottomLeft',
    })

    return
  }

  // A full `${…}` jq path resolves against the widget; otherwise, for a per-row action
  // (List rowAction) the row rides in as customPayload — interpolate `${field}` placeholders
  // from it (e.g. /marketplace/${name}/install), so one action serves every row. Static
  // paths (no placeholders / no customPayload) pass through unchanged.
  let updatedUrl = action.path
  if (action.path.startsWith('${')) {
    updatedUrl = jqText(await ctx.resolveJq(action.path, { widget: runtime.widget }))
  } else if (runtime.customPayload) {
    updatedUrl = interpolateRedirectUrl(runtime.customPayload, action.path) ?? action.path
  }

  if (!action.requireConfirmation || await ctx.confirm()) {
    await ctx.navigate(updatedUrl)
  }
}

const runOpenDrawer = (action: WidgetAction & { type: 'openDrawer' }, resourceRef: ResourceRef, ctx: ActionContext): void => {
  ctx.setLoading(false)
  ctx.openDrawer({ size: action.size, title: action.title, widgetEndpoint: resourceRef.path })
}

const runOpenModal = (action: WidgetAction & { type: 'openModal' }, resourceRef: ResourceRef, ctx: ActionContext): void => {
  ctx.setLoading(false)
  ctx.openModal({ customWidth: action.customWidth, size: action.size, title: action.title, widgetEndpoint: resourceRef.path })
}

const runRest = async (
  action: WidgetAction & { type: 'rest' },
  resourceRef: ResourceRef,
  url: string,
  runtime: ActionRuntime,
  ctx: ActionContext,
  // X5: filled in past the HITL gate, so the dispatcher's own catch-all can end the interaction
  // span whatever threw. Shared rather than returned because `runRest` has many exits.
  held: InteractionHeld = {}
): Promise<void> => {
  const { errorMessage, headers = [], onEventNavigateTo, onSuccessNavigateTo, successMessage } = action
  const { customPayload } = runtime
  // The form's secret fields and — only when it has any — their VALUES, to scrub from everything
  // but the write itself: template inputs, toasts, the audit outcome. Undefined = no secret
  // fields = every path below behaves exactly as it always has.
  const secretPaths = runtime.secretPaths ?? []
  const secrets = secretPaths.length > 0 ? secretValuesOf(customPayload, secretPaths) : undefined
  const scrub = <T>(text: T): T => (secrets ? redactSecretValues(text, secrets) : text)
  const { verb } = resourceRef

  // X5, BOTH SET-FABRIC BRANCHES BELOW ARE UNINSTRUMENTED, deliberately and not silently: one
  // `krateo.form.submit` would have to span N gated writes with N confirms between them, and the
  // contract excludes confirm time. Measuring that wrongly is worse than not measuring it, so a
  // set / fan-out submit produces no span and the gap is recorded in docs/observability.md.
  //
  // W3-2: `ops` routes the whole submit through the set fabric — N DISTINCT writes
  // (each entry resolves its own ref + builds its own payload) as ONE gated set.
  // Checked FIRST so ops×fanOutPath surfaces as runRestOps' mutual-exclusion error.
  if (action.ops) {
    await runRestOps(action, runtime, ctx)

    return
  }

  // W3-1: `fanOutPath` routes the whole submit through the set fabric instead.
  if (action.fanOutPath) {
    await runRestFanOut(action, resourceRef, runtime, ctx)

    return
  }

  let jsonResponse: RestApiResponse | null = null

  // A config error (both nav modes set) must not slip past into a write — surface it first.
  if (onSuccessNavigateTo && onEventNavigateTo) {
    ctx.message.destroy()
    ctx.notification.error({
      description: 'Action has defined both the "onSuccessNavigateTo" and "onEventNavigateTo" properties',
      message: 'Warning while executing the action',
      placement: 'bottomLeft',
    })
    ctx.setLoading(false)

    return
  }

  // Build the request body BEFORE the gate so the blast-radius diff shows the real create /
  // update body the write will send (not the pre-override ref payload).
  const { payload: builtPayload, secretTargets } = await buildPayloadDetailed(action, resourceRef.payload, customPayload, ctx.resolveJq, runtime.secretPaths)
  // A17: an object the agent created is identifiable as such. Stamped HERE — before the gate —
  // so the label appears in the blast-radius diff the human confirms, rather than being added to
  // the body afterwards. No-op for human-originated writes and for every verb but POST.
  const payload = stampAgentCreated(builtPayload, verb, runtime.origin) as typeof builtPayload

  // W0-2 HITL gate. Every MUTATING verb (POST/PUT/PATCH/DELETE) is ALWAYS gated — the human
  // must confirm the structured BlastRadius (verb+gvr+cluster/ns+object-count+diff) — regardless
  // of the CR's `requireConfirmation` opt-in (which is thus superseded for writes; it still gates
  // a read-only ref that opts in). This single chokepoint covers Form submit, row actions, AND
  // the Agentiko runAction (which already routes through this dispatcher).
  // The gated radius is kept for W0-3 provenance: the SAME shape the human confirmed is
  // logged verbatim on the audit record (reused, never rebuilt). undefined = read-only ref.
  let radius: BlastRadius | undefined
  if (isMutatingVerb(verb)) {
    radius = buildBlastRadius({ maskTargets: secretTargets, path: resourceRef.path, payload, verb })
    if (!(await ctx.confirm(radius))) {
      ctx.setLoading(false)

      return
    }
  } else if (action.requireConfirmation && !(await ctx.confirm())) {
    ctx.setLoading(false)

    return
  }

  // X5 — THE INTERACTION STARTS HERE: validation has passed, the gate (if any) has been confirmed,
  // and from this point on every millisecond is the portal's. A declined confirm returned above
  // and starts nothing: the user never waited on us. `verb` is the ref's, known on every path from
  // here, which is why `http.request.method` can be always-present on this span name.
  if (runtime.interaction) { held.span = startFormSubmit({ method: verb, route: runtime.interaction.route }) }

  // W0-3 provenance, decided here — past the gate, before anything is sent: the X-Krateo-Provenance
  // header on the write where snowplow advertises `call.provenance`, else the AuditRecord POST after
  // it resolves (hooks/provenance.ts beginWriteProvenance). requestedAt is the browser clock at the
  // confirmation. Only a gated write (radius set) has provenance; a declined confirm returned above.
  const requestedAt = new Date().toISOString()
  const provenance: WriteProvenance | undefined = radius
    ? await beginWriteProvenance(ctx, runtime.origin, radius, { confirmed: true, requestedAt })
    : undefined

  let resourceUid: string | null = null
  let eventReceived = false
  // (3) The awaited event can arrive before the POST response sets resourceUid; buffer
  // events received while resourceUid is unknown and replay them once it is set, instead
  // of dropping them (which let the timeout fire a false error on a successful action).
  const pendingEvents: EventData[] = []
  let processEvent: (eventData: EventData) => void = () => undefined

  if (onEventNavigateTo) {
    // Subscribe through the shared sseClient rather than opening our own connection to the
    // same endpoint. Two reasons: the Notifications bell is almost always already streaming
    // /notifications, so this used to hold a second socket alongside it; and the URL now
    // carries NO credential — sseClient authenticates with `Authorization: Bearer`
    // (installer#395 — the token used to ride as ?access_token= and reach the access logs).
    const eventsEndpoint = `${ctx.eventsBaseUrl}/notifications`
    const eventTimeoutSeconds = onEventNavigateTo.timeout ?? 30

    // Subscribed here, where the connection used to be opened. `processEvent` is assigned
    // further down and `resourceUid` is set by the POST response, but both are declared
    // above and only ever READ inside this callback, which fires later.
    const unsubscribeEvents = ctx.subscribeSse(eventsEndpoint, 'krateo', {
      onMessage: (raw) => {
        // Guarded like every other subscriber (useGetEvents, useLiveRefresh, useSseStream):
        // the stream is shared, so a malformed frame must be this subscriber's problem alone.
        let eventData: EventData
        try {
          eventData = JSON.parse(raw) as EventData
        } catch (error) {
          console.error('[action] could not parse an event from the stream:', error)

          return
        }

        if (!resourceUid) {
          pendingEvents.push(eventData)

          return
        }

        processEvent(eventData)
      },
    })
    // The page the click happened on, and whether the widget has unmounted since.
    const startPath = typeof window === 'undefined' ? '' : window.location.pathname
    let detached = false

    let description = `Timeout waiting for event ${onEventNavigateTo.eventReason}`
    if (errorMessage) {
      description = errorMessage.startsWith('${')
        ? jqText(await ctx.resolveJq(errorMessage, templateJqInput(payload, secretTargets, jsonResponse, {}, secrets)))
        : errorMessage
    }

    const timeoutId = setTimeout(() => {
      if (!eventReceived) {
        ctx.setLoading(false)
        unsubscribeEvents()
        ctx.notification.error({ description, message: 'Error while executing the action', placement: 'bottomLeft' })
        // X5: the outcome the user got is this error. ERROR status and NO status code — the write
        // itself answered 2xx, so a status code here would describe the wrong thing, and the SLI
        // reads "ERROR with no code" as the failure anyway.
        held.span?.failed('timeout waiting for the awaited event')
      }
      ctx.message.destroy()
    }, eventTimeoutSeconds * 1000)

    // (7) A widget that unmounts mid-wait (a refetch re-rendered it away, or the user left)
    // keeps waiting: the timeout bounds the stream, the result still shows, and the redirect
    // happens only if the user is still on the page of the click.
    ctx.registerCleanup(() => {
      detached = true
    })

    // GUARDED on `${`, like every other resolveJq site. This one tested only TRUTHINESS, so a
    // plain-text loadingMessage ("Creating your page…") was handed to the jq resolver — which
    // warned and returned it unchanged. That pass-through was load-bearing: the resolver doubled
    // as "resolve it, or else give it back". Now that a malformed expression throws, an unguarded
    // plain message would abort the very action it was announcing.
    const loadingMessage = onEventNavigateTo.loadingMessage?.startsWith('${')
      ? jqText(await ctx.resolveJq(onEventNavigateTo.loadingMessage, templateJqInput(payload, secretTargets, jsonResponse, {}, secrets)))
      : onEventNavigateTo.loadingMessage || 'Waiting for resource and redirecting...'

    ctx.message.loading(loadingMessage, eventTimeoutSeconds)

    // Match + act on a (live or replayed) event. The eventReceived guard + close run
    // synchronously, so it fires at most once; the redirect/notify tail is async.
    processEvent = (eventData: EventData) => {
      if (eventReceived || eventData.reason !== onEventNavigateTo.eventReason || eventData.involvedObject.uid !== resourceUid) {
        return
      }

      eventReceived = true

      if (onEventNavigateTo.reloadRoutes !== false) {
        void ctx.reloadRoutes()
      }

      unsubscribeEvents()
      clearTimeout(timeoutId)

      void (async () => {
        const redirectUrl = await (async () => {
          // if it starts with ${ resolve via the JQ endpoint, otherwise use the legacy method
          if (onEventNavigateTo.url.startsWith('${')) {
            return ctx.resolveJq(onEventNavigateTo.url, templateJqInput(payload, secretTargets, jsonResponse, { event: eventData }, secrets)).then(jqText)
          }

          if (customPayload) {
            return interpolateRedirectUrl(omitSecretPaths(customPayload, secretPaths), onEventNavigateTo.url)
          }

          return onEventNavigateTo.url
        })()

        if (!redirectUrl) {
          ctx.message.destroy()
          ctx.notification.error({
            description: 'Impossible to redirect, the route contains an undefined value',
            message: 'Error while redirecting',
            placement: 'bottomLeft',
          })
          held.span?.failed('the awaited event resolved no redirect target')

          return
        }

        let successDescription = 'The action has been executed successfully'
        if (successMessage) {
          successDescription = successMessage.startsWith('${')
            ? jqText(await ctx.resolveJq(successMessage, templateJqInput(payload, secretTargets, jsonResponse, { event: eventData }, secrets)))
            : successMessage
        }

        ctx.message.destroy()
        ctx.notification.success({ description: successDescription, message: 'Successfully executed action', placement: 'bottomLeft' })
        // X5: the outcome is on screen, so the interaction ends HERE — before the detach check
        // below, which decides only whether to also REDIRECT. The toast is raised app-wide whether
        // or not the widget is still mounted, so this is never an abandonment: what ended the span
        // is the awaited event, not the user leaving.
        held.span?.ok()

        ctx.setLoading(false)
        if (detached && typeof window !== 'undefined' && window.location.pathname !== startPath) {
          return
        }
        ctx.closeDrawer()
        void ctx.navigate(redirectUrl)
      })()
    }
  }

  const updatedUrl = customPayload
    ? updateNameNamespace(url, writeTargetName(verb, payload?.metadata?.name), payload?.metadata?.namespace)
    : url

  const headersObject = getHeadersObject(headers)
  if (!headersObject) {
    ctx.message.destroy()
    ctx.notification.error({ description: 'Headers are not in the key: value format', message: 'Error while executing the action', placement: 'bottomLeft' })
    held.span?.failed('the action\'s headers are not in the key: value format')

    return
  }

  const requestHeaders = {
    // A widget's own headers never assert provenance: that header is the portal's, sent once.
    ...withoutProvenanceHeader(headersObject),
    Accept: 'application/json',
    Authorization: `Bearer ${ctx.getAccessToken()}`,
    // A scalar write is op 0 of a confirmed set of one.
    ...provenance?.headerFor(0),
  }

  const shouldSendPayload = ['POST', 'PUT', 'PATCH'].includes(verb)

  // W0-3 provenance (record path): settled only AFTER the write resolves — success, HTTP failure,
  // or network throw. On the header path settling is a no-op: snowplow recorded the write.
  const res = await fetchWithTimeout(updatedUrl, {
    body: shouldSendPayload ? JSON.stringify(payload) : undefined,
    headers: requestHeaders,
    method: verb,
  }).catch((error: unknown) => {
    // The request itself failed (network error / timeout abort) — still an attempted write:
    // record it (fire-and-forget, best-effort), then rethrow to the dispatcher's catch.
    provenance?.settle({ message: scrub(error instanceof Error ? error.message : String(error)), ok: false, status: 0 })
    throw error
  })

  // Empty/204 bodies (e.g. a successful DELETE) → {} via parseJsonResponse.
  const responseText = await res.text()
  // eslint-disable-next-line require-atomic-updates
  jsonResponse = parseJsonResponse(responseText)

  ctx.setLoading(false)

  // W0-3: ONE audit record per resolved gated write — success AND failure both land here,
  // carrying the radius the human confirmed. Fire-and-forget inside recordProvenance (void,
  // never awaited): it can never block, delay, or fail the primary write.
  provenance?.settle({ message: secrets ? scrub(jsonResponse.reason ?? `HTTP ${res.status}`) : jsonResponse.message ?? '', ok: res.ok, status: res.status })

  if (!res.ok) {
    let description = scrub(jsonResponse.message)
    if (errorMessage) {
      description = errorMessage.startsWith('${')
        ? jqText(await ctx.resolveJq(errorMessage, templateJqInput(payload, secretTargets, jsonResponse, {}, secrets)))
        : errorMessage
    }

    ctx.message.destroy()
    ctx.notification.error({ description, message: `${jsonResponse.status} - ${jsonResponse.reason}`, placement: 'bottomLeft' })
    // X5: ERROR status, and NO `http.response.status_code` even though `res.status` is right here.
    // The key must be ALWAYS present or ALWAYS absent per span name (it is a metric dimension with
    // no default), and a network failure or an event timeout has no status to carry — so carrying
    // it here would split `krateo.form.submit` into two series. Resist adding it.
    held.span?.failed('the write was refused')

    return
  }

  if (jsonResponse.metadata?.uid) {
    resourceUid = jsonResponse.metadata.uid
    // (3) replay any events that arrived before resourceUid was known
    for (const eventData of pendingEvents) {
      processEvent(eventData)
    }
    pendingEvents.length = 0
  }

  if (!onEventNavigateTo) {
    ctx.closeDrawer()

    const actionName = (() => {
      switch (verb) {
        case 'DELETE':
          return 'deleted'
        case 'POST':
          return 'created'
        case 'PUT':
          return 'updated'
        case 'PATCH':
          return 'updated'
        default:
          return 'updated'
      }
    })()

    // Empty responses (e.g. DELETE 204) carry no metadata — fall back to the request payload's.
    const resourceName = jsonResponse.metadata?.name ?? payload?.metadata?.name
    const resourceNamespace = jsonResponse.metadata?.namespace ?? payload?.metadata?.namespace
    let description = `Successfully ${actionName} ${resourceName} in ${resourceNamespace}`
    if (successMessage) {
      description = successMessage.startsWith('${')
        ? jqText(await ctx.resolveJq(successMessage, templateJqInput(payload, secretTargets, jsonResponse, {}, secrets)))
        : successMessage
    }

    // The notification title (antd `message`) MUST be present — a successful k8s write returns the
    // OBJECT (no `.message` field), so `jsonResponse.message` is usually undefined, and antd renders
    // a title-less (effectively invisible) toast. Fall back to a verb-aware headline so every widget
    // action reliably shows a titled success toast.
    const successTitle = scrub(jsonResponse.message) || `Successfully ${actionName}`
    ctx.notification.success({ description, message: successTitle, placement: 'bottomLeft' })
    // X5: the outcome is rendered — the span ends OK here. Everything after it (cache
    // invalidation, an onSuccess redirect, the staggered re-invalidations) is the portal catching
    // up with a write the user has already been told about.
    held.span?.ok()
  }

  await ctx.invalidateQueries()

  if (onSuccessNavigateTo) {
    ctx.closeDrawer()

    const onSuccessUrl = onSuccessNavigateTo.startsWith('${')
      ? jqText(await ctx.resolveJq(onSuccessNavigateTo, templateJqInput(payload, secretTargets, jsonResponse, {}, secrets)))
      : onSuccessNavigateTo

    if (onSuccessUrl) {
      // SPA navigation — NOT window.location.replace. A hard reload remounted the whole app,
      // which (a) closed the Agentiko rail + wiped its conversation and (b) 404'd because the
      // server was asked for a client-only route. Routes are static conventions now, so no full
      // reload is needed; invalidate first so the destination reflects the just-written object.
      await ctx.invalidateQueries()
      void ctx.navigate(onSuccessUrl)
    }
    return
  }

  // Read-after-write coherence: snowplow may read the just-written object through an
  // informer/watch-cache that lags the write by a few hundred ms, so the immediate
  // invalidate above can refetch PRE-write state and the UI looks unchanged until a
  // manual refresh (e.g. a range chip that PATCHes its ConfigMap but doesn't flip to
  // selected). Schedule a couple of background re-invalidations to converge the UI
  // once the write has propagated — no skeleton flash (data already exists, so these
  // refetch in the background). Cleared if the widget unmounts first. Skipped for
  // event-driven actions: they navigate on their awaited event, not on a refetch.
  if (!onEventNavigateTo) {
    for (const ms of POST_WRITE_REVALIDATE_DELAYS_MS) {
      const timer = setTimeout(() => { void ctx.invalidateQueries() }, ms)
      ctx.registerCleanup(() => clearTimeout(timer))
    }
  }
}

/**
 * Pure action dispatcher: resolves the action's target then routes it to the
 * per-type handler (the registry). Side effects come in through `ctx`, so this is
 * unit-testable without React — the hook below is a thin wrapper that builds `ctx`.
 */
export const dispatchAction = async (action: WidgetAction, runtime: ActionRuntime, ctx: ActionContext): Promise<void> => {
  // X5: the interaction span, once `runRest` is past the gate and has started one. Held in a box
  // rather than returned so the catch below — the dispatcher's existing catch-all for every
  // unhandled throw — is also the span's, whatever path threw. First end wins, so a throw on the
  // tail of an already-reported outcome cannot overwrite it.
  const held: InteractionHeld = {}
  if (action.loading?.display) {
    ctx.setLoading(true)
  }

  if (action.type === 'navigate') {
    await runNavigate(action, runtime, ctx)
    ctx.setLoading(false)

    return
  }

  const resourceRef = action.resourceRefId ? getResourceRef(action.resourceRefId, runtime.resourcesRefs) : undefined

  if (!resourceRef) {
    ctx.message.destroy()
    // X2 — a denial is not a defect. The ref may be absent because the author never declared it
    // (a real authoring error, and the author's to fix) or because RBAC removed it for THIS viewer
    // (nothing is wrong, and nothing the viewer can fix). Reporting the second as the first blames
    // the author for the viewer's permissions and sends people hunting a typo that is not there.
    //
    // Deliberately says only that the action is not permitted, never which resource was withheld:
    // naming it would leak the existence of something outside the viewer's scope, which is the
    // same reason a denied child renders as absence rather than as an announcement.
    const denied = !!action.resourceRefId && !!runtime.deniedRefIds?.includes(action.resourceRefId)
    ctx.notification[denied ? 'warning' : 'error']({
      description: denied
        ? 'You do not have permission to perform this action.'
        : `The widget definition does not include a resource reference for resource (ID: ${action.resourceRefId})`,
      message: denied ? 'Action not permitted' : 'Error while executing the action',
      placement: 'bottomLeft',
    })

    return
  }

  // A public page's transport makes no writes. Refused HERE, before runRest builds
  // anything: building a write already reaches the network (the provenance capability probe, /jq
  // for payload overrides), and none of that may run on an anonymous transport. Drawers and modals
  // still open, and `navigate` was handled above.
  if (action.type === 'rest' && ctx.writes === false) {
    ctx.setLoading(false)
    ctx.message.destroy()
    ctx.notification.info({ description: SIGN_IN_TO_ACT, message: 'Sign in to do this', placement: 'bottomLeft' })

    return
  }

  const url = ctx.apiBaseUrl + resourceRef.path

  try {
    switch (action.type) {
      case 'openDrawer':
        runOpenDrawer(action, resourceRef, ctx)
        break
      case 'openModal':
        runOpenModal(action, resourceRef, ctx)
        break
      case 'rest':
        await runRest(action, resourceRef, url, runtime, ctx, held)
        break
      default:
        break
    }
  } catch (error) {
    ctx.message.destroy()
    // X5: whatever threw, the interaction failed and the notification below IS its outcome.
    held.span?.failed(error instanceof Error ? error.name : 'unhandled error')
    // A refused secret-bearing override is a definition problem, stated as such — nothing was sent.
    ctx.notification.error(error instanceof SecretExpressionError
      ? { description: error.message, message: 'Not submitted — a secret field would have left the browser', placement: 'bottomLeft' }
      : {
        description: `Unhandled error: ${error instanceof Error ? error.message : String(error)}`,
        message: 'Error while executing the action',
        placement: 'bottomLeft',
      })
  } finally {
    ctx.setLoading(false)
  }
}

/** The token getter and SSE client of a transport without a session: there are none, and asking is a bug. */
const noSession = (): never => {
  throw new Error('No signed-in session: this page reads with the anonymous transport.')
}

export const useHandleAction = () => {
  const navigate = useNavigate()
  // The transport owns the credential (transport/widgetTransport.ts). Signed in, its session's
  // token getter is the same `getAccessToken` this hook used to import; anonymous, there is no
  // session, writes are refused in dispatchAction, and the getter only throws.
  const { session, writes } = useWidgetTransport()
  const getAccessToken = session?.getAccessToken ?? noSession
  const subscribeSse = session?.subscribeSse ?? noSession
  const queryClient = useQueryClient()
  const { message, modal, notification } = useApp()
  const { config } = useConfigContext()
  // `routes` is the router's live table — the source of the TEMPLATED route an interaction span
  // carries (X5). `reloadRoutes` is the existing consumer.
  const { reloadRoutes, routes } = useRoutesContext()
  const [isActionLoading, setIsActionLoading] = useState<boolean>(false)
  const resolveJq = useResolveJqExpression()

  // Teardowns for in-flight actions (e.g. open SSE streams) — run on unmount so a
  // pending action doesn't leak its connection past the component's lifetime.
  const cleanupsRef = useRef<Set<() => void>>(new Set())

  // Guards the single HITL confirm gate against re-entrancy: at most ONE confirm modal
  // may be open at a time (see ctx.confirm below).
  const confirmOpenRef = useRef<boolean>(false)
  useEffect(() => () => {
    cleanupsRef.current.forEach((cleanup) => { cleanup() })
    cleanupsRef.current.clear()
  }, [])

  const buildCtx = (): ActionContext => ({
    apiBaseUrl: config?.api.SNOWPLOW_API_BASE_URL ?? '',
    closeDrawer,
    // Non-blocking confirmation (antd Modal) instead of the blocking window.confirm. When a
    // blast radius is supplied (every mutating write — W0-2), render the structured
    // BlastRadiusConfirm — the scalar verb+gvr+cluster/ns+object-count+diff shape, or the
    // aggregated ordered-op list for a W0-4 set — as the modal body and title the intent;
    // otherwise keep the plain "Are you sure?" prompt (read-only opt-in). The props (incl.
    // the raised zIndex that keeps this gate ABOVE the Agentiko preview Drawer) are built by
    // the pure buildConfirmModalProps so the fix is unit-testable. The Confirm button goes
    // danger for anything irreversible (a DELETE, or a set containing one).
    confirm: (radius?: BlastRadius | BlastRadiusSet) => new Promise<boolean>((resolve) => {
      // Re-entrancy guard for the ONE HITL gate. A single user gesture could dispatch the
      // action twice, stacking a second identical confirm that then lingered on screen after
      // the first write had already run (and could double-submit if confirmed). While a
      // confirm is open, suppress any further one — resolve it false so the duplicate dispatch
      // is a no-op — and clear the flag when the gate settles either way.
      if (confirmOpenRef.current) {
        resolve(false)

        return
      }
      confirmOpenRef.current = true
      // DENY ON SILENCE. The promise settles only on a click, so an unanswered dialog hung
      // forever — and because confirmOpenRef stays true while one is open, every LATER action
      // resolved false at the guard above. Walking away from the screen therefore turned every
      // subsequent action into a silent no-op. confirmWithTimeout denies after the window,
      // destroys the dialog, and clears the flag through the same settle path as a click.
      void confirmWithTimeout(
        (onOk, onCancel) => modal.confirm(buildConfirmModalProps(radius, onOk, onCancel)),
        CONFIRM_TIMEOUT_MS,
        () => { confirmOpenRef.current = false },
      ).then(resolve)
    }),
    eventsBaseUrl: config?.api.EVENTS_PUSH_API_BASE_URL ?? '',
    getAccessToken,
    // Scope post-action invalidation to widget queries (key ['widgets', ...]) instead of
    // ALL queries — a blank invalidate also refetched the SSE-maintained `events` cache
    // and everything else. Any widget may show the mutated resource, so refresh them all.
    invalidateQueries: () => queryClient.invalidateQueries({ queryKey: ['widgets'] }),
    message,
    navigate: (path: string) => navigateOrExternal(navigate, path, resolveNavigationTarget),
    notification,
    openDrawer,
    openModal,
    // W0-3 provenance: default ON — every gated portal write fire-and-forgets ONE best-effort
    // AuditRecord CR (the audit/remediation-outcome loop depends on it). Emission is strictly
    // best-effort: a missing CRD (404)/RBAC (403)/network error is swallowed and never blocks the
    // primary write (see hooks/provenance.ts), so on-by-default is safe even on a CRD-less cluster.
    // Arrives from config.json as a STRING (installer componentValues carry "true"/"false"/""); the
    // ONLY way to disable is an EXPLICIT false / "false" — absent/empty ("") resolves ON.
    provenanceEnabled: config?.api.PROVENANCE_ENABLED !== false && config?.api.PROVENANCE_ENABLED !== 'false',
    registerCleanup: (cleanup: () => void) => { cleanupsRef.current.add(cleanup) },
    reloadRoutes,
    resolveJq,
    setLoading: setIsActionLoading,
    subscribeSse,
    supportsCallProvenance: () => snowplowReadsCallProvenance(config?.api.SNOWPLOW_API_BASE_URL ?? '', getAccessToken),
    writes: writes && !!session,
  })

  const handleAction = async (
    action: WidgetAction,
    resourcesRefs: ResourcesRefs,
    customPayload?: Record<string, unknown>,
    widget?: Widget,
    // W0-3 origin tag — omitted by every widget call site (default {actor:'human'});
    // only the Agentiko bridge passes an agent origin.
    origin?: WriteOrigin,
    // X2 — the caller's `deniedRefIds` prop. Optional so a call site that has none behaves exactly
    // as before: an absent ref is still reported as a broken definition, which is correct when
    // nothing was filtered.
    deniedRefIds?: string[],
    // The submitting Form's secret fields (utils/secretFields.ts); only the Form passes them.
    secretPaths?: readonly SecretPath[],
    // X5 — the SLO interaction this dispatch is. Only the Form passes it ('form.submit'); the
    // ROUTE is resolved here rather than by the caller, because the templated route comes from the
    // router's table and a widget has no business matching URLs.
    interaction?: 'form.submit'
  ) => {
    // `formSubmitInteraction` resolves the TEMPLATED route and returns undefined when there is
    // none — no templated route, no span (otel/route.ts): a concrete path would poison the metric's
    // series cap, and a missing key would split the span name into two series.
    const asInteraction = formSubmitInteraction(routes, interaction === 'form.submit')
    await dispatchAction(action, { customPayload, deniedRefIds, interaction: asInteraction, origin, resourcesRefs, secretPaths, widget }, buildCtx())
  }

  /**
   * The P1 applySet fabric entry point: run an ORDERED write-set behind ONE aggregated
   * W0-4 blast-radius confirm (decline = nothing dispatched), sequential dispatch with
   * stop-on-first-error, per-item results. Same ctx (same gate modal, same auth, same
   * invalidation) as a scalar handleAction — see runRestSet. `origin` is the W0-3 tag
   * (agent-origin sets pass it; absent = human). `options` is the previewPage-v2
   * sandbox relaxation (confirm-skip verified per-op against the named namespace,
   * silent toasts) — see SetDispatchOptions; every other caller omits it.
   */
  const handleActionSet = async (ops: readonly WriteOp[], origin?: WriteOrigin, options?: SetDispatchOptions): Promise<WriteOpResult[] | null> => {
    // A write-set is writes; on a transport that makes none it is refused unsent, like a scalar `rest`.
    if (!writes || !session) {
      notification.info({ description: SIGN_IN_TO_ACT, message: 'Sign in to do this', placement: 'bottomLeft' })
      return null
    }
    return runRestSet(ops, buildCtx(), origin, options)
  }

  return { handleAction, handleActionSet, isActionLoading }
}
