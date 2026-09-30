/**
 * runRestFanOut — the W3-1 fan-out consumer of the applySet fabric: a rest action whose
 * `fanOutPath` names an ARRAY field in the submitted values expands into ONE ordered
 * write per element. For each write, the array field is replaced by the single element
 * BEFORE payload/payloadToOverride interpolation, so the chart's existing
 * `${ .json.<field> }` expressions see a scalar and can derive the per-op name/target
 * (e.g. `spec.deploy.targetRef.name` per selected cluster — one blueprint → N spokes).
 *
 * The whole set rides runRestSet: ONE aggregated W0-2 confirm, sequential
 * stop-on-first-error dispatch, per-item results, ONE W0-3 set AuditRecord. The per-op
 * /call path gets the op's own metadata name/namespace (same updateNameNamespace rule
 * as the single-write path).
 *
 * Sibling of runRestSet (useHandleActions.ts hosts the scalar run* handlers; the set
 * fabric modules live apart only for the max-lines budget — call-time-only references,
 * so the import cycle is inert under ESM).
 */

import { isMutatingVerb } from '../components/BlastRadius/buildBlastRadius'
import type { ResourceRef, WidgetAction } from '../types/Widget'
import { ANY_ITEM, omitSecretPaths, secretValuesOf } from '../utils/secretFields'

import { runRestSet, type WriteOp } from './runRestSet'
import type { ActionContext, ActionRuntime } from './useHandleActions'
import { buildPayloadDetailed, interpolateRedirectUrl, updateNameNamespace } from './useHandleActions'

export const runRestFanOut = async (
  action: WidgetAction & { type: 'rest' },
  resourceRef: ResourceRef,
  runtime: ActionRuntime,
  ctx: ActionContext
): Promise<void> => {
  const { fanOutPath = '', onEventNavigateTo, onSuccessNavigateTo } = action
  const { customPayload } = runtime
  // Only when the form has secret fields: their values, scrubbed from each op's outcome message.
  const secrets = runtime.secretPaths?.length ? secretValuesOf(customPayload, runtime.secretPaths) : undefined
  const { verb } = resourceRef

  const fail = (description: string): void => {
    ctx.message.destroy()
    ctx.notification.error({ description, message: 'Error while executing the action', placement: 'bottomLeft' })
    ctx.setLoading(false)
  }

  // The awaited-event redirect is single-resource by design (one uid) — meaningless for a set.
  if (onEventNavigateTo) {
    fail('A fan-out action (`fanOutPath`) does not support "onEventNavigateTo".')

    return
  }
  if (!isMutatingVerb(verb)) {
    fail(`A fan-out action requires a mutating resource ref (got ${verb}).`)

    return
  }
  const elements: readonly unknown[] | undefined = Array.isArray(customPayload?.[fanOutPath])
    ? (customPayload[fanOutPath] as readonly unknown[])
    : undefined
  if (!elements || elements.length === 0) {
    fail(`The fan-out field "${fanOutPath}" must be a non-empty array in the submitted values.`)

    return
  }

  // The element replaces the array field, so a row secret `[fanOutPath, '*', …]` is, for each op,
  // `[fanOutPath, …]` — rewritten here so `.json.<fanOutPath>.<field>` is matched exactly.
  const opSecretPaths = (runtime.secretPaths ?? []).map((path) =>
    (path[0] === fanOutPath && path[1] === ANY_ITEM ? [path[0], ...path.slice(2)] : path))

  // One op per element: the element replaces the array field for THIS op's interpolation.
  const ops: WriteOp[] = []
  for (const element of elements) {
    const perOpValues = { ...customPayload, [fanOutPath]: element }
    // eslint-disable-next-line no-await-in-loop -- payloads build sequentially to keep op order deterministic
    const { payload, secretTargets } = await buildPayloadDetailed(action, resourceRef.payload, perOpValues, ctx.resolveJq, opSecretPaths)
    const name = payload?.metadata?.name
    const namespace = payload?.metadata?.namespace
    const path = (name ?? namespace) ? updateNameNamespace(resourceRef.path, name, namespace) : resourceRef.path
    ops.push({ maskTargets: secretTargets, path, payload, verb, ...(secrets ? { secretValues: secrets } : {}) })
  }

  // runRestSet owns the gate, dispatch, set toast, provenance and cache re-invalidation.
  const results = await runRestSet(ops, ctx, runtime.origin)
  if (!results || !results.every((result) => result.ok)) {
    return
  }

  ctx.closeDrawer()
  if (onSuccessNavigateTo) {
    const target = interpolateRedirectUrl(omitSecretPaths(customPayload ?? {}, runtime.secretPaths ?? []), onSuccessNavigateTo) ?? onSuccessNavigateTo
    void ctx.navigate(target)
  }
}
