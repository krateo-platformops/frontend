/**
 * runRestOps — the W3-2 multi-op consumer of the applySet fabric: a rest action whose
 * `ops` lists N DISTINCT writes applies them as ONE ordered gated set — e.g. one Form
 * submit creating a Role AND its RoleBinding (different resource plurals, different
 * payload shapes; later a ConfigMap + RestDefinition for the KOG builder). Each entry
 * resolves its OWN resource ref (verb + path + payload base) and builds its OWN
 * payload/payloadToOverride, all interpolating `${ .json.* }` against the SAME
 * submitted values. This composes with runRestFanOut, which fans ONE payload template
 * over an array element-by-element; `ops` composes N distinct templates instead —
 * the two are mutually exclusive on an action.
 *
 * The whole set rides runRestSet: ONE aggregated W0-2 confirm, sequential
 * stop-on-first-error dispatch, per-item results, ONE W0-3 set AuditRecord. Each op's
 * /call path gets its own payload's metadata name/namespace (same updateNameNamespace
 * rule as the single-write path). The action's top-level resourceRefId/payload are
 * IGNORED here — the entries carry everything (the dispatcher still requires the
 * top-level id to resolve; charts point it at the first op's ref).
 *
 * Sibling of runRestFanOut (useHandleActions.ts hosts the scalar run* handlers; the
 * set fabric modules live apart only for the max-lines budget — call-time-only
 * references, so the import cycle is inert under ESM).
 */

import { isMutatingVerb } from '../components/BlastRadius/buildBlastRadius'
import type { WidgetAction } from '../types/Widget'
import { omitSecretPaths, secretValuesOf } from '../utils/secretFields'
import { getResourceRef } from '../utils/utils'

import { runRestSet, type WriteOp } from './runRestSet'
import type { ActionContext, ActionRuntime } from './useHandleActions'
import { buildPayloadDetailed, interpolateRedirectUrl, updateNameNamespace } from './useHandleActions'

export const runRestOps = async (
  action: WidgetAction & { type: 'rest' },
  runtime: ActionRuntime,
  ctx: ActionContext
): Promise<void> => {
  const { fanOutPath, onEventNavigateTo, onSuccessNavigateTo, ops = [] } = action
  const { customPayload } = runtime
  // Only when the form has secret fields: their values, scrubbed from each op's outcome message.
  const secrets = runtime.secretPaths?.length ? secretValuesOf(customPayload, runtime.secretPaths) : undefined

  const fail = (description: string): void => {
    ctx.message.destroy()
    ctx.notification.error({ description, message: 'Error while executing the action', placement: 'bottomLeft' })
    ctx.setLoading(false)
  }

  // `ops` composes N distinct payload templates; `fanOutPath` expands ONE template over
  // an array — combining them has no defined per-op values shape. Config error.
  if (fanOutPath) {
    fail('A multi-op action (`ops`) cannot also set `fanOutPath` — they are mutually exclusive.')

    return
  }
  // The awaited-event redirect is single-resource by design (one uid) — meaningless for a set.
  if (onEventNavigateTo) {
    fail('A multi-op action (`ops`) does not support "onEventNavigateTo".')

    return
  }
  if (ops.length === 0) {
    fail('A multi-op action requires a non-empty `ops` array.')

    return
  }

  // Resolve + validate EVERY entry's ref BEFORE building anything: a config error anywhere
  // in the list dispatches NOTHING (and spends no jq round-trips on a doomed set).
  const targets: { path: string; payloadBase: object; verb: WriteOp['verb'] }[] = []
  for (const op of ops) {
    const ref = getResourceRef(op.resourceRefId, runtime.resourcesRefs)
    if (!ref) {
      fail(`The widget definition does not include a resource reference for op (ID: ${op.resourceRefId}).`)

      return
    }
    if (!isMutatingVerb(ref.verb)) {
      fail(`A multi-op action requires mutating resource refs (op "${op.resourceRefId}" got ${ref.verb}).`)

      return
    }
    targets.push({ path: ref.path, payloadBase: ref.payload, verb: ref.verb })
  }

  // One WriteOp per entry: the entry's OWN payload/payloadToOverride (not the action's)
  // build via the existing buildPayload against the SAME submitted values (customPayload).
  const writeOps: WriteOp[] = []
  for (const [index, op] of ops.entries()) {
    const { path: refPath, payloadBase, verb } = targets[index]
    const opAction = { ...action, payload: op.payload, payloadToOverride: op.payloadToOverride }
    // eslint-disable-next-line no-await-in-loop -- payloads build sequentially to keep op order deterministic
    const { payload, secretTargets } = await buildPayloadDetailed(opAction, payloadBase, customPayload, ctx.resolveJq, runtime.secretPaths)
    const name = payload?.metadata?.name
    const namespace = payload?.metadata?.namespace
    const path = (name ?? namespace) ? updateNameNamespace(refPath, name, namespace) : refPath
    writeOps.push({ maskTargets: secretTargets, path, payload, verb, ...(secrets ? { secretValues: secrets } : {}) })
  }

  // runRestSet owns the gate, dispatch, set toast, provenance and cache re-invalidation.
  const results = await runRestSet(writeOps, ctx, runtime.origin)
  if (!results || !results.every((result) => result.ok)) {
    return
  }

  ctx.closeDrawer()
  if (onSuccessNavigateTo) {
    const target = interpolateRedirectUrl(omitSecretPaths(customPayload ?? {}, runtime.secretPaths ?? []), onSuccessNavigateTo) ?? onSuccessNavigateTo
    void ctx.navigate(target)
  }
}
