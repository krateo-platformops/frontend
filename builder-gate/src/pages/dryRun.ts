/**
 * Step 4, live-dry-run: each object is created in the preview sandbox with dryRun=All and
 * fieldValidation=Strict THROUGH SNOWPLOW, AS THE CALLER (snowplow.ts dryRunCreate,
 * docs/snowplow-contract.md). The API server is the only judge of the RESTAction CRD's CEL rules
 * (the userAccessFilter constraints) and of the CRDs actually deployed, which can differ from the
 * schemas the lint reads (crd-drift.yaml). The gate has no RBAC of its own for this.
 *
 * Every object must be JUDGED (#442 D9). Until snowplow advertises the dry-run forward, the step
 * says "live verdict missing" and is RED — there is no green without the API server's judgement.
 * `notChecked` — Forbidden, unreachable, a timeout, a missing sandbox — is red as well.
 *
 * Bounds, from core-provider-agent's live_dry_run.py: 20 s per object, 45 s for the step, at most
 * 50 objects; anything cut is named notChecked rather than dropped.
 */
import { expectedApiVersionOf } from '@frontend/components/Autopilot/pageLint'

import { type ObjectVerdict, step, type StepResult } from '../envelope'
import { HttpError } from '../http'
import { PER_REQUEST_TIMEOUT_MS } from '../kube'
import type { GateContext } from '../plan'
import { CAPABILITY_DRY_RUN, DRY_RUN_CONFIRMATION } from '../snowplow'
import { kindOf, labelOf, nameOf, pluralOfDraft, rec, type Rec } from './drafts'

export const STEP_BUDGET_MS = 45_000
export const MAX_OBJECTS = 50
const PARALLEL = 4

/**
 * The API server's answer (snowplow forwards its status and body), classified. Order matters as in CPA: a rejection is recognised before
 * anything that could make it look like an environment problem.
 */
export const classifyDryRun = (reply: { status: number; json: unknown; body: string; headers?: Record<string, string | string[] | undefined> }, sandboxNamespace: string): { verdict: ObjectVerdict['verdict']; detail?: string } => {
  const status = rec(reply.json) ?? {}
  const message = typeof status.message === 'string' ? status.message : reply.body.slice(0, 500)
  const reason = typeof status.reason === 'string' ? status.reason : ''
  const details = rec(status.details) ?? {}

  if (reply.status === 200 || reply.status === 201) {
    return { verdict: 'validated' }
  }
  // Admission (schema, CEL, webhooks) runs before storage, so a name collision means it passed.
  // ...but only when snowplow confirms the request it forwarded WAS a dry run: a 409 from a
  // snowplow that dropped dryRun says nothing about admission, and a retry would have created it.
  if (reply.status === 409 && reason === 'AlreadyExists') {
    if (String(reply.headers?.[DRY_RUN_CONFIRMATION] ?? '') !== 'All') {
      return { verdict: 'notChecked', detail: `snowplow answered 409 AlreadyExists without ${DRY_RUN_CONFIRMATION}: All — whether the API server judged a dry run cannot be told` }
    }
    return { verdict: 'validated', detail: 'an object of that name already exists in the sandbox; the API server validated this one before refusing the name clash' }
  }
  // 422 Invalid: the schema or a CEL rule. 400 BadRequest: under Strict, an unknown or duplicate
  // field ("strict decoding error: unknown field …"), or a body the server cannot decode at all.
  if (reply.status === 422 || reply.status === 400) {
    return { verdict: 'rejected', detail: message }
  }
  if (reply.status === 403) {
    return { verdict: 'notChecked', detail: `Forbidden — you may not create this kind in ${sandboxNamespace}, so preview would refuse it for you too: ${message}` }
  }
  if (reply.status === 401) {
    return { verdict: 'notChecked', detail: `Unauthorized — the caller's token was not accepted: ${message}` }
  }
  if (reply.status === 404) {
    if (details.kind === 'namespaces' || new RegExp(`namespaces? "${sandboxNamespace}" not found`).test(message)) {
      return { verdict: 'notChecked', detail: `the preview sandbox namespace ${sandboxNamespace} does not exist (previewSandbox.enabled is off?)` }
    }
    return { verdict: 'rejected', detail: `the API server does not serve this resource: ${message}` }
  }
  return { verdict: 'notChecked', detail: `the API server answered ${reply.status}${reason ? ` ${reason}` : ''}: ${message}` }
}

/** The object as the sandbox would receive it: in the sandbox namespace, at its kind's apiVersion. */
const submittable = (cr: Rec, sandboxNamespace: string): Rec => {
  const object = structuredClone(cr)
  object.apiVersion ??= expectedApiVersionOf(kindOf(cr))
  object.metadata = { ...(rec(cr.metadata) ?? {}), namespace: sandboxNamespace }
  return object
}

export const dryRunStep = async (drafts: readonly Rec[], ctx: GateContext): Promise<{ step: StepResult; verdicts: ObjectVerdict[] }> => {
  if (!ctx.live) {
    return {
      step: step('live-dry-run', [], ['DISABLED: offline run (--offline) — the API server judged nothing']),
      verdicts: [],
    }
  }
  const verdicts: ObjectVerdict[] = drafts.map((cr, index) => ({
    object: labelOf(cr, index),
    resource: `${pluralOfDraft(cr) ?? '?'}/${nameOf(cr) ?? '?'}`,
    verdict: 'notChecked',
    detail: 'not submitted',
  }))
  const unjudged = (why: string): { step: StepResult; verdicts: ObjectVerdict[] } => {
    verdicts.forEach((v) => { v.detail = why })
    return { step: step('live-dry-run', [`${why} — no object was judged by the API server`]), verdicts }
  }
  const snowplow = ctx.snowplow
  if (!snowplow) {
    return unjudged(`notChecked: ${ctx.snowplowMissing ?? 'no snowplow'}`)
  }
  const capabilities = await snowplow.capabilities(PER_REQUEST_TIMEOUT_MS)
  if (!capabilities.ok) {
    return unjudged(`notChecked: ${capabilities.reason}`)
  }
  if (!capabilities.offered.has(CAPABILITY_DRY_RUN)) {
    return unjudged(`live verdict missing: this snowplow does not yet forward dryRun on /call (${CAPABILITY_DRY_RUN}, docs/snowplow-contract.md)`)
  }

  const notes = [`judged by the API server through snowplow as the caller, in namespace ${snowplow.sandboxNamespace}, dryRun=All, fieldValidation=Strict`]
  const stepDeadline = Math.min(ctx.deadline, Date.now() + STEP_BUDGET_MS)
  let next = 0
  const worker = async (): Promise<void> => {
    while (next < drafts.length) {
      const index = next
      next += 1
      const verdict = verdicts[index]
      if (index >= MAX_OBJECTS) {
        verdict.detail = `not submitted: the gate judges at most ${MAX_OBJECTS} objects per call`
        continue
      }
      const remaining = stepDeadline - Date.now()
      if (remaining < 1_000) {
        verdict.detail = 'not submitted: the step\'s time budget ran out'
        continue
      }
      const cr = drafts[index]
      const plural = pluralOfDraft(cr)
      if (!plural) {
        verdict.detail = 'not submitted: unknown kind'
        continue
      }
      try {
        const object = submittable(cr, snowplow.sandboxNamespace)
        // eslint-disable-next-line no-await-in-loop -- bounded worker pool
        const reply = await snowplow.dryRunCreate(String(object.apiVersion), plural, object, Math.min(PER_REQUEST_TIMEOUT_MS, remaining))
        const classified = classifyDryRun(reply, snowplow.sandboxNamespace)
        verdict.verdict = classified.verdict
        verdict.detail = classified.detail
      } catch (error) {
        verdict.verdict = 'notChecked'
        verdict.detail = error instanceof HttpError && error.code === 'timeout'
          ? `snowplow did not answer in time (${error.message})`
          : error instanceof HttpError
            ? `snowplow could not be reached (${error.message})`
            : (error as Error).message
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(PARALLEL, drafts.length) }, worker))

  const problems = verdicts
    .filter((v) => v.verdict !== 'validated')
    .map((v) => `${v.object}: ${v.verdict}: ${v.detail ?? ''}`)
  return { step: step('live-dry-run', problems, notes), verdicts }
}
