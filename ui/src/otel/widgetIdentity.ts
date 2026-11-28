/**
 * WHICH WIDGET a `krateo.widget.fetch` span measures — carried from the call site to the span, so
 * snowplow's side of the trace can be read as "the server half of THIS widget's read".
 *
 * `traceparent` already joins the two halves (same-origin requests always get it from the fetch
 * instrumentation, and snowplow-bound ones are the only ones exported), but a joined trace whose
 * client span says only `GET` cannot be attributed to a widget. These attributes name it.
 *
 * THE PATH IS THE ACTIVE CONTEXT, exactly as for `krateo.a2a.method` (spanContract.ts
 * `withA2aMethod`): the span is created INSIDE the instrumentation's patched `fetch`, so the only
 * thing the caller can hand it is the context that is active when `fetch` is called. The processor
 * reads it in `onStart`. Without a registered tracer the context API is a no-op passthrough.
 *
 * WHAT THEY NAME, AND WHAT THEY DO NOT. The widget CR's coordinates: its plural resource, its
 * namespace, its name. Never the caller's: no username, group, email, token, no extras, no query
 * string. They are lifted from the widget's own `/call?resource=…&namespace=…&name=…` endpoint, and
 * each value must look like a Kubernetes name, so a value that is anything else is omitted rather
 * than shipped.
 *
 * NOT CARRIED: the widget's `spec.apiRef` (the RESTAction behind it). The frontend does not know it
 * when the request is made — it is resolved server-side and only appears, if at all, in the
 * response, after the span has been created. snowplow has it from the widget CR; the join key is
 * the widget namespace/name.
 *
 * `resource` is the plural resource name (`tables`), not the Kind (`Table`): that is what the
 * endpoint carries, and deriving a Kind from a plural would be a guess.
 *
 * Imports only the OTel API, so the widget read path can use it without pulling in the SDK.
 */
import { context, createContextKey, type Context } from '@opentelemetry/api'

export const ATTR_WIDGET_RESOURCE = 'krateo.widget.resource'
export const ATTR_WIDGET_NAMESPACE = 'krateo.widget.namespace'
export const ATTR_WIDGET_NAME = 'krateo.widget.name'

/** The ONLY attributes this module ever sets. Pinned by a test; widening it is a contract change. */
export const WIDGET_IDENTITY_ATTRS = [ATTR_WIDGET_RESOURCE, ATTR_WIDGET_NAMESPACE, ATTR_WIDGET_NAME] as const

export interface WidgetIdentity {
  readonly resource: string
  readonly namespace: string
  readonly name: string
}

const WIDGET_IDENTITY_KEY = createContextKey('krateo.widget.identity')

/** A Kubernetes object/resource name: DNS-1123 subdomain. Nothing else is shipped as an identifier. */
const K8S_NAME = /^[a-z0-9]([a-z0-9.-]{0,251}[a-z0-9])?$/

/**
 * The identity of the widget a `/call` URL reads, or null when the URL is not a widget read or does
 * not name a complete, well-formed widget.
 */
export const widgetIdentityOfUrl = (url: URL): WidgetIdentity | null => {
  if (!url.pathname.endsWith('/call')) {
    return null
  }
  const resource = url.searchParams.get('resource') ?? ''
  const namespace = url.searchParams.get('namespace') ?? ''
  const name = url.searchParams.get('name') ?? ''
  return [resource, namespace, name].every((value) => K8S_NAME.test(value)) ? { name, namespace, resource } : null
}

/** Run `fn` — the widget's `fetch` call — with `identity` on the active context. */
export const withWidgetIdentity = <T>(identity: WidgetIdentity | null, fn: () => T): T => {
  if (identity === null) {
    return fn()
  }
  return context.with(context.active().setValue(WIDGET_IDENTITY_KEY, identity), fn)
}

/** The span attributes for the identity on `ctx`; empty when there is none. Re-validated on read. */
export const widgetIdentityAttributesOf = (ctx: Context): Record<string, string> => {
  const value = ctx.getValue(WIDGET_IDENTITY_KEY) as Partial<WidgetIdentity> | undefined
  if (value === undefined || ![value.resource, value.namespace, value.name].every((part) => typeof part === 'string' && K8S_NAME.test(part))) {
    return {}
  }
  return {
    [ATTR_WIDGET_NAME]: value.name!,
    [ATTR_WIDGET_NAMESPACE]: value.namespace!,
    [ATTR_WIDGET_RESOURCE]: value.resource!,
  }
}
