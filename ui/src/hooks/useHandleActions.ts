import { useQueryClient } from '@tanstack/react-query'
import useApp from 'antd/es/app/useApp'
import { merge, set } from 'lodash'
import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router'

import { buildBlastRadius, isMutatingVerb } from '../components/BlastRadius/buildBlastRadius'
import { useConfigContext } from '../context/ConfigContext'
import { useRoutesContext } from '../context/RoutesContext'
import type { ResourceRef, ResourcesRefs, Widget, WidgetAction } from '../types/Widget'
import { getAccessToken } from '../utils/getAccessToken'
import { useResolveJqExpression } from '../utils/jq-expression'
import { navigateOrExternal } from '../utils/navigation'
import { pruneEmptyObjects } from '../utils/pruneEmptyObjects'
import type { Payload, RestApiResponse } from '../utils/types'
import { getHeadersObject, getResourceRef } from '../utils/utils'
import { closeDrawer, openDrawer } from '../widgets/Drawer/Drawer'
import { openModal } from '../widgets/Modal/Modal'

import type { BlastRadius, BlastRadiusSet } from './blastRadius.types'
import { buildConfirmModalProps } from './confirmModalProps'
import { recordProvenance, type WriteOrigin } from './provenance'
import { runRestFanOut } from './runRestFanOut'
import { runRestOps } from './runRestOps'
import { runRestSet, type SetDispatchOptions, type WriteOp, type WriteOpResult } from './runRestSet'

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
 * Interpolates a route template using values from a nested payload object.
 * Placeholders in the route must follow the format `${path.to.value}`.
 * If any placeholder cannot be resolved or is not a primitive, the function returns null.
 *
 * Example:
 *   interpolateRedirectUrl({ user: { id: 123 } }, "/profile/${user.id}")
 *   → "/profile/123"
 *
 * @param payload - The object used to resolve placeholders (supports nested values)
 * @param route - The route string containing `${...}` placeholders to be replaced
 * @returns The interpolated route string or null if a placeholder could not be resolved
 */
export const interpolateRedirectUrl = (payload: Record<string, unknown>, route: string): string | null => {
  let allReplacementsSuccessful = true

  const interpolatedRoute = route.replace(/\$\{([^}]+)\}/g, (_, key: string) => {
    const parts = key.split('.')

    let value: unknown = payload
    for (const part of parts) {
      if (typeof value === 'object' && value !== null && Object.prototype.hasOwnProperty.call(value, part)) {
        value = (value as Record<string, unknown>)[part]
      } else {
        value = undefined
        break
      }
    }

    if (
      typeof value === 'string'
      || typeof value === 'number'
      || typeof value === 'boolean'
      || typeof value === 'bigint'
      || typeof value === 'symbol'
    ) {
      return String(value)
    }

    allReplacementsSuccessful = false
    return ''
  })

  return allReplacementsSuccessful ? interpolatedRoute : null
}

/**
 * Adds or replaces `name` and `namespace` query parameters in a given URL.
 * Existing `name` and `namespace` parameters (if any) are removed before appending the new values.
 *
 * Example:
 *   updateNameNamespace("/api?foo=bar&name=old", "my-app", "prod")
 *   → "/api?foo=bar&name=my-app&namespace=prod"
 *
 * @param path - The original URL (may already include query parameters)
 * @param name - The new `name` parameter to set
 * @param namespace - The new `namespace` parameter to set
 * @returns The updated URL with the new query parameters
 */
export const updateNameNamespace = (path: string, name?: string, namespace?: string) => {
  const [base, queryString = ''] = path.split('?')
  const qsParameters = queryString
    .split('&')
    .filter((el) => !el.startsWith('name=') && !el.startsWith('namespace='))
    .join('&')

  return `${base}?${qsParameters ? `${qsParameters}&` : ''}name=${name}&namespace=${namespace}`
}

/**
 * Resolve a navigate target, MERGING query parameters when it shares the current
 * pathname. Independent filter controls (the compositions status / time-range chips)
 * each navigate with only their own param — e.g. `/compositions?status=failed` and
 * `/compositions?range=7d`. Without merging, every click would clobber the others'
 * params; with it, `status` and `range` accumulate on the same URL and compose. Targets
 * to a DIFFERENT pathname replace the query as before (a filter must not leak across
 * pages). `window.location` is read at call time so the merge always sees the latest URL.
 */
export const resolveNavigationTarget = (path: string): string => {
  const [targetPath, targetQuery = ''] = path.split('?')
  if (typeof window === 'undefined' || targetPath !== window.location.pathname || !targetQuery) {
    return path
  }

  const merged = new URLSearchParams(window.location.search)
  new URLSearchParams(targetQuery).forEach((value, key) => { merged.set(key, value) })
  const queryString = merged.toString()

  return queryString ? `${targetPath}?${queryString}` : targetPath
}

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

export const buildPayload = async (
  action: WidgetAction & {type: 'rest'},
  resourcePayload: object,
  customPayload: Record<string, unknown> | undefined,
  resolveJq: (expression: string, values: Record<string, unknown>) => Promise<string>
): Promise<Payload> => {
  const { payload, payloadToOverride } = action
  // 1. the action payload is the starting object
  let finalPayload = payload ?? {}

  // 2. the action payload and the referenced resource payload are merged
  finalPayload = merge({}, payload, resourcePayload)

  if (payloadToOverride && payloadToOverride.length > 0 && customPayload) {
    // 3. the values defined in payloadToOverride are interpolated
    const overridePromises = payloadToOverride.map(async ({ name, value }) => {
      let resolvedValue: unknown = value

      if (typeof value === 'string' && value.startsWith('${')) {
        resolvedValue = await resolveJq(value, { json: customPayload })
      }

      return { name, resolvedValue }
    })

    const resolvedOverrides = await Promise.all(overridePromises)

    // 4. the interpolated values replace the original values
    for (const { name, resolvedValue } of resolvedOverrides) {
      set(finalPayload, name, resolvedValue)
    }
  }

  // 5. Drop empty-plain-object (`{}`) leaves. The schema-driven Form seeds `{}` for every
  //    unfilled nested-object branch — for a k8s UNION field (probe handlers exec|httpGet|
  //    tcpSocket|grpc are oneOf) that emits the unpopulated branches as `{}` next to the
  //    populated one, which k8s rejects ("may not specify more than 1 handler type"). Pruning
  //    keeps only the populated branch. Runs LAST so a payloadToOverride that set an object
  //    value is still respected. See pruneEmptyObjects for the safety rationale.
  return pruneEmptyObjects(finalPayload)
}

/** Per-invocation data for an action (the widget instance it fires from). */
export interface ActionRuntime {
  resourcesRefs: ResourcesRefs
  customPayload?: Record<string, unknown>
  widget?: Widget
  /** W0-3 origin tag: who initiated the write. Absent = a hand-clicked control ({actor:'human'});
   * the Autopilot bridge sets actor:'agent' + the session/prompt context it holds. */
  origin?: WriteOrigin
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
  resolveJq: (expression: string, values: Record<string, unknown>) => Promise<string>
  setLoading: (loading: boolean) => void
  invalidateQueries: () => Promise<unknown>
  reloadRoutes: () => void | Promise<void>
  getAccessToken: () => string
  openDrawer: typeof openDrawer
  openModal: typeof openModal
  closeDrawer: typeof closeDrawer
  message: ReturnType<typeof useApp>['message']
  notification: ReturnType<typeof useApp>['notification']
  /** Register a teardown to run if the widget unmounts mid-action (e.g. close an SSE stream). */
  registerCleanup: (cleanup: () => void) => void
  /** W0-3 provenance flag (config.json api.PROVENANCE_ENABLED, default OFF). When true, every
   * resolved gated write fire-and-forgets ONE best-effort AuditRecord CR — see hooks/provenance.ts. */
  provenanceEnabled: boolean
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
    updatedUrl = await ctx.resolveJq(action.path, { widget: runtime.widget })
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
  ctx: ActionContext
): Promise<void> => {
  const { errorMessage, headers = [], onEventNavigateTo, onSuccessNavigateTo, successMessage } = action
  const { customPayload } = runtime
  const { verb } = resourceRef

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
  const payload = await buildPayload(action, resourceRef.payload, customPayload, ctx.resolveJq)

  // W0-2 HITL gate. Every MUTATING verb (POST/PUT/PATCH/DELETE) is ALWAYS gated — the human
  // must confirm the structured BlastRadius (verb+gvr+cluster/ns+object-count+diff) — regardless
  // of the CR's `requireConfirmation` opt-in (which is thus superseded for writes; it still gates
  // a read-only ref that opts in). This single chokepoint covers Form submit, row actions, AND
  // the Autopilot runAction (which already routes through this dispatcher).
  // The gated radius is kept for W0-3 provenance: the SAME shape the human confirmed is
  // logged verbatim on the audit record (reused, never rebuilt). undefined = read-only ref.
  let radius: BlastRadius | undefined
  if (isMutatingVerb(verb)) {
    radius = buildBlastRadius({ path: resourceRef.path, payload, verb })
    if (!(await ctx.confirm(radius))) {
      ctx.setLoading(false)

      return
    }
  } else if (action.requireConfirmation && !(await ctx.confirm())) {
    ctx.setLoading(false)

    return
  }

  let resourceUid: string | null = null
  let eventReceived = false
  // (3) The awaited event can arrive before the POST response sets resourceUid; buffer
  // events received while resourceUid is unknown and replay them once it is set, instead
  // of dropping them (which let the timeout fire a false error on a successful action).
  const pendingEvents: EventData[] = []
  let processEvent: (eventData: EventData) => void = () => undefined

  if (onEventNavigateTo) {
    const eventsEndpoint = `${ctx.eventsBaseUrl}/notifications`
    const eventTimeoutSeconds = onEventNavigateTo.timeout ?? 30

    const eventSource = new EventSource(eventsEndpoint, { withCredentials: false })

    let description = `Timeout waiting for event ${onEventNavigateTo.eventReason}`
    if (errorMessage) {
      description = errorMessage.startsWith('${')
        ? await ctx.resolveJq(errorMessage, { json: payload, response: jsonResponse })
        : errorMessage
    }

    const timeoutId = setTimeout(() => {
      if (!eventReceived) {
        ctx.setLoading(false)
        eventSource.close()
        ctx.notification.error({ description, message: 'Error while executing the action', placement: 'bottomLeft' })
      }
      ctx.message.destroy()
    }, eventTimeoutSeconds * 1000)

    // (7) Close the stream + cancel the timeout if the widget unmounts before the event
    // arrives, instead of leaking the connection (and firing toasts) until the timeout.
    ctx.registerCleanup(() => {
      eventSource.close()
      clearTimeout(timeoutId)
    })

    const loadingMessage = onEventNavigateTo.loadingMessage
      ? await ctx.resolveJq(onEventNavigateTo.loadingMessage, { json: payload, response: jsonResponse })
      : 'Waiting for resource and redirecting...'

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

      eventSource.close()
      clearTimeout(timeoutId)

      void (async () => {
        const redirectUrl = await (async () => {
          // if it starts with ${ resolve via the JQ endpoint, otherwise use the legacy method
          if (onEventNavigateTo.url.startsWith('${')) {
            return ctx.resolveJq(onEventNavigateTo.url, {
              event: eventData as unknown as Record<string, unknown>,
              json: payload,
              response: jsonResponse,
            })
          }

          if (customPayload) {
            return interpolateRedirectUrl(customPayload, onEventNavigateTo.url)
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

          return
        }

        let successDescription = 'The action has been executed successfully'
        if (successMessage) {
          successDescription = successMessage.startsWith('${')
            ? await ctx.resolveJq(successMessage, {
              event: eventData as unknown as Record<string, unknown>,
              json: payload,
              response: jsonResponse,
            })
            : successMessage
        }

        ctx.message.destroy()
        ctx.notification.success({ description: successDescription, message: 'Successfully executed action', placement: 'bottomLeft' })

        ctx.setLoading(false)
        ctx.closeDrawer()
        void ctx.navigate(redirectUrl)
      })()
    }

    eventSource.addEventListener('krateo', (event) => {
      const eventData = JSON.parse(event.data as string) as EventData
      if (!resourceUid) {
        pendingEvents.push(eventData)

        return
      }

      processEvent(eventData)
    })
  }

  const updatedUrl = customPayload
    ? updateNameNamespace(url, payload?.metadata?.name, payload?.metadata?.namespace)
    : url

  const headersObject = getHeadersObject(headers)
  if (!headersObject) {
    ctx.message.destroy()
    ctx.notification.error({ description: 'Headers are not in the key: value format', message: 'Error while executing the action', placement: 'bottomLeft' })

    return
  }

  const requestHeaders = {
    ...headersObject,
    Accept: 'application/json',
    Authorization: `Bearer ${ctx.getAccessToken()}`,
  }

  const shouldSendPayload = ['POST', 'PUT', 'PATCH'].includes(verb)

  // W0-3 provenance: requestedAt is captured pre-dispatch; the record itself is emitted only
  // AFTER the write resolves (success, HTTP failure, or network throw), and only for a gated
  // write (radius set). A declined confirm returned above — it records NOTHING.
  const requestedAt = new Date().toISOString()

  const res = await fetchWithTimeout(updatedUrl, {
    body: shouldSendPayload ? JSON.stringify(payload) : undefined,
    headers: requestHeaders,
    method: verb,
  }).catch((error: unknown) => {
    // The request itself failed (network error / timeout abort) — still an attempted write:
    // record it (fire-and-forget, best-effort), then rethrow to the dispatcher's catch.
    if (radius) {
      recordProvenance(ctx, runtime.origin, radius, { message: error instanceof Error ? error.message : String(error), ok: false, status: 0 }, requestedAt)
    }
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
  if (radius) {
    recordProvenance(ctx, runtime.origin, radius, { message: jsonResponse.message ?? '', ok: res.ok, status: res.status }, requestedAt)
  }

  if (!res.ok) {
    let description = jsonResponse.message
    if (errorMessage) {
      description = errorMessage.startsWith('${')
        ? await ctx.resolveJq(errorMessage, { json: payload, response: jsonResponse })
        : errorMessage
    }

    ctx.message.destroy()
    ctx.notification.error({ description, message: `${jsonResponse.status} - ${jsonResponse.reason}`, placement: 'bottomLeft' })

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
        ? await ctx.resolveJq(successMessage, { json: payload, response: jsonResponse })
        : successMessage
    }

    // The notification title (antd `message`) MUST be present — a successful k8s write returns the
    // OBJECT (no `.message` field), so `jsonResponse.message` is usually undefined, and antd renders
    // a title-less (effectively invisible) toast. Fall back to a verb-aware headline so every widget
    // action reliably shows a titled success toast.
    const successTitle = jsonResponse.message || `Successfully ${actionName}`
    ctx.notification.success({ description, message: successTitle, placement: 'bottomLeft' })
  }

  await ctx.invalidateQueries()

  if (onSuccessNavigateTo) {
    ctx.closeDrawer()

    const onSuccessUrl = onSuccessNavigateTo.startsWith('${')
      ? await ctx.resolveJq(onSuccessNavigateTo, { json: payload, response: jsonResponse })
      : onSuccessNavigateTo

    if (onSuccessUrl) {
      // SPA navigation — NOT window.location.replace. A hard reload remounted the whole app,
      // which (a) closed the Autopilot rail + wiped its conversation and (b) 404'd because the
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
    ctx.notification.error({
      description: `The widget definition does not include a resource reference for resource (ID: ${action.resourceRefId})`,
      message: 'Error while executing the action',
      placement: 'bottomLeft',
    })

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
        await runRest(action, resourceRef, url, runtime, ctx)
        break
      default:
        break
    }
  } catch (error) {
    ctx.message.destroy()
    ctx.notification.error({
      description: `Unhandled error: ${error instanceof Error ? error.message : String(error)}`,
      message: 'Error while executing the action',
      placement: 'bottomLeft',
    })
  } finally {
    ctx.setLoading(false)
  }
}

export const useHandleAction = () => {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { message, modal, notification } = useApp()
  const { config } = useConfigContext()
  const { reloadRoutes } = useRoutesContext()
  const [isActionLoading, setIsActionLoading] = useState<boolean>(false)
  const resolveJq = useResolveJqExpression()

  // Teardowns for in-flight actions (e.g. open SSE streams) — run on unmount so a
  // pending action doesn't leak its connection past the component's lifetime.
  const cleanupsRef = useRef<Set<() => void>>(new Set())
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
    // the raised zIndex that keeps this gate ABOVE the Autopilot preview Drawer) are built by
    // the pure buildConfirmModalProps so the fix is unit-testable. The Confirm button goes
    // danger for anything irreversible (a DELETE, or a set containing one).
    confirm: (radius?: BlastRadius | BlastRadiusSet) => new Promise<boolean>((resolve) => {
      modal.confirm(buildConfirmModalProps(radius, () => resolve(true), () => resolve(false)))
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
  })

  const handleAction = async (
    action: WidgetAction,
    resourcesRefs: ResourcesRefs,
    customPayload?: Record<string, unknown>,
    widget?: Widget,
    // W0-3 origin tag — omitted by every widget call site (default {actor:'human'});
    // only the Autopilot bridge passes an agent origin.
    origin?: WriteOrigin
  ) => {
    await dispatchAction(action, { customPayload, origin, resourcesRefs, widget }, buildCtx())
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
  const handleActionSet = async (ops: readonly WriteOp[], origin?: WriteOrigin, options?: SetDispatchOptions): Promise<WriteOpResult[] | null> =>
    runRestSet(ops, buildCtx(), origin, options)

  return { handleAction, handleActionSet, isActionLoading }
}
