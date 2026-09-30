/**
 * The request body of a rest action, and the jq input of its success / error / navigate
 * templates — both kept free of a form's SECRET fields on everything sent to snowplow's `/jq`.
 * Lives apart from useHandleActions.ts (which re-exports it) only for the max-lines budget.
 */
import { cloneDeep, merge, set, toPath, unset } from 'lodash'

import type { WidgetAction } from '../types/Widget'
import { pruneEmptyObjects } from '../utils/pruneEmptyObjects'
import { redactSecretValues, stripSecretMaterial, templateSafeResponse, type SecretPath } from '../utils/secretFields'
import { planOverride, referencedSecretFields, runOverridePlan, secretFieldLabel, SecretExpressionError } from '../utils/secretJq'
import type { Payload, RestApiResponse } from '../utils/types'

type ResolveJq = (expression: string, values: Record<string, unknown>) => Promise<string>

/**
 * buildPayload plus the override names whose value was resolved from a SECRET form field —
 * so the caller can keep those out of anything it later hands to `/jq` (success/error templates).
 */
export const buildPayloadDetailed = async (
  action: WidgetAction & {type: 'rest'},
  resourcePayload: object,
  customPayload: Record<string, unknown> | undefined,
  resolveJq: ResolveJq,
  secretPaths: readonly SecretPath[] = []
): Promise<{ payload: Payload; secretTargets: string[] }> => {
  const { payload, payloadToOverride } = action
  const secretTargets: string[] = []
  // 1. the action payload is the starting object
  let finalPayload = payload ?? {}

  // 2. the action payload and the referenced resource payload are merged
  finalPayload = merge({}, payload, resourcePayload)

  if (payloadToOverride && payloadToOverride.length > 0 && customPayload) {
    // 3. the values defined in payloadToOverride are interpolated. PLANNED FIRST, all of them,
    //    synchronously: an override that would need a secret field on the server throws here,
    //    before any override has been sent to /jq. A form with no secret fields plans every
    //    `${…}` as the same /jq call with the same data as always (see utils/secretJq.ts).
    const plans = payloadToOverride.map(({ name, value }) => {
      if (typeof value !== 'string' || !value.startsWith('${')) {
        return null
      }
      const plan = planOverride(name, value, customPayload, secretPaths)
      // A secret never becomes identity: metadata is the object's name (the /call URL, the toast,
      // the audit record, every list that shows it), its labels and annotations.
      if (plan.mode === 'local' && plan.touchesSecret && toPath(name)[0] === 'metadata') {
        throw new SecretExpressionError(name, referencedSecretFields(value, secretPaths).map(secretFieldLabel), 'would put into the object\'s metadata')
      }
      return { expression: value, plan }
    })

    const overridePromises = payloadToOverride.map(async ({ name, value }, index) => {
      const planned = plans[index]
      if (!planned) {
        return { name, resolvedValue: value }
      }
      if (planned.plan.mode === 'local' && planned.plan.touchesSecret) {
        secretTargets.push(name)
      }
      return { name, resolvedValue: await runOverridePlan(planned.expression, planned.plan, resolveJq) }
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
  return { payload: pruneEmptyObjects(finalPayload), secretTargets }
}

/**
 * The request body for a rest action: action payload < resource-ref payload < payloadToOverride.
 * `secretPaths` are the submitting form's secret fields (see utils/secretFields.ts); they never
 * reach `/jq`. Absent/empty = the previous behaviour exactly.
 */
export const buildPayload = async (
  action: WidgetAction & {type: 'rest'},
  resourcePayload: object,
  customPayload: Record<string, unknown> | undefined,
  resolveJq: ResolveJq,
  secretPaths: readonly SecretPath[] = []
): Promise<Payload> =>
  (await buildPayloadDetailed(action, resourcePayload, customPayload, resolveJq, secretPaths)).payload

/**
 * The jq input for a success / error / navigate template, with no secret in it: the request body
 * without the values resolved from secret fields, and neither body carrying a Secret's
 * `data`/`stringData`. Those templates name what was written; they never need its credentials.
 *
 * `secrets` — the form's secret VALUES (secretValuesOf) — is present only when the submitting form
 * has secret fields. Then the RESPONSE is cut down to what names the object and says how it went
 * (templateSafeResponse: never `spec`, never a Status `message`/`details`, which echo values), and
 * any secret value still anywhere in either body is masked.
 */
export const templateJqInput = (
  payload: Payload,
  secretTargets: readonly string[],
  response: RestApiResponse | null,
  extra: Record<string, unknown> = {},
  secrets?: readonly string[],
): Record<string, unknown> => {
  const json = cloneDeep(payload)
  for (const target of secretTargets) {
    unset(json, target)
  }
  if (secrets === undefined) {
    return { ...extra, json: stripSecretMaterial(json), response: stripSecretMaterial(response) }
  }
  return {
    ...redactSecretValues(extra, secrets),
    json: redactSecretValues(stripSecretMaterial(json), secrets),
    response: templateSafeResponse(response, secretTargets, secrets),
  }
}
