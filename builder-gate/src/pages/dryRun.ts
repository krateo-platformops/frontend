/**
 * Step 4, live-dry-run: each object is created in the preview sandbox with dryRun=All and
 * fieldValidation=Strict (kube.ts dryRunCreate, the gate's only mutating request) as the gate's
 * ServiceAccount. The API server is the only judge of the RESTAction CRD's CEL rules (the
 * userAccessFilter constraints) and of the CRDs actually deployed, which can differ from the
 * schemas the lint reads (crd-drift.yaml).
 *
 * Every object must be JUDGED (#442 D9): `notChecked` — Forbidden, unreachable, a timeout, a
 * missing sandbox — fails the step exactly like `rejected` does, and says why.
 *
 * Bounds, from core-provider-agent's live_dry_run.py: 20 s per object, 45 s for the step, at most
 * 50 objects; anything cut is named notChecked rather than dropped.
 */
import { expectedApiVersionOf } from '@frontend/components/Autopilot/pageLint'

import { type ObjectVerdict, step, type StepResult } from '../envelope'
import { HttpError } from '../http'
import { type KubeReply, PER_REQUEST_TIMEOUT_MS } from '../kube'
import type { GateContext } from '../plan'
import { kindOf, labelOf, nameOf, pluralOfDraft, rec, type Rec } from './drafts'

export const STEP_BUDGET_MS = 45_000
export const MAX_OBJECTS = 50
const PARALLEL = 4

/**
 * The API server's answer, classified. Order matters as in CPA: a rejection is recognised before
 * anything that could make it look like an environment problem.
 */
export const classifyDryRun = (reply: KubeReply, sandboxNamespace: string): { verdict: ObjectVerdict['verdict']; detail?: string } => {
  const status = rec(reply.json) ?? {}
  const message = typeof status.message === 'string' ? status.message : reply.body.slice(0, 500)
  const reason = typeof status.reason === 'string' ? status.reason : ''
  const details = rec(status.details) ?? {}

  if (reply.status === 200 || reply.status === 201) {
    return { verdict: 'validated' }
  }
  // Admission (schema, CEL, webhooks) runs before storage, so a name collision means it passed.
  if (reply.status === 409 && reason === 'AlreadyExists') {
    return { verdict: 'validated', detail: 'an object of that name already exists in the sandbox; the API server validated this one before refusing the name clash' }
  }
  // 422 Invalid: the schema or a CEL rule. 400 BadRequest: under Strict, an unknown or duplicate
  // field ("strict decoding error: unknown field …"), or a body the server cannot decode at all.
  if (reply.status === 422 || reply.status === 400) {
    return { verdict: 'rejected', detail: message }
  }
  if (reply.status === 403) {
    return { verdict: 'notChecked', detail: `Forbidden — the gate's identity may not create this kind in ${sandboxNamespace}: ${message}` }
  }
  if (reply.status === 401) {
    return { verdict: 'notChecked', detail: `Unauthorized — the API server did not accept the gate's identity: ${message}` }
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
  const notes: string[] = []
  const kube = ctx.kube
  if (!kube) {
    verdicts.forEach((v) => { v.detail = 'the gate has no API server identity (no in-cluster ServiceAccount, no kubeconfig)' })
  } else {
    notes.push(`judged by the API server as ${kube.identity.source}, in namespace ${kube.sandboxNamespace}, dryRun=All, fieldValidation=Strict`)
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
          const object = submittable(cr, kube.sandboxNamespace)
          // eslint-disable-next-line no-await-in-loop -- bounded worker pool
          const reply = await kube.dryRunCreate(String(object.apiVersion), plural, object, Math.min(PER_REQUEST_TIMEOUT_MS, remaining))
          const classified = classifyDryRun(reply, kube.sandboxNamespace)
          verdict.verdict = classified.verdict
          verdict.detail = classified.detail
          for (const warning of reply.warnings) {
            notes.push(`${verdict.object}: API server warning: ${warning}`)
          }
        } catch (error) {
          verdict.verdict = 'notChecked'
          verdict.detail = error instanceof HttpError && error.code === 'timeout'
            ? `the API server did not answer in time (${error.message})`
            : `the API server could not be reached (${(error as Error).message})`
        }
      }
    }
    await Promise.all(Array.from({ length: Math.min(PARALLEL, drafts.length) }, worker))
  }

  const problems = verdicts
    .filter((v) => v.verdict !== 'validated')
    .map((v) => `${v.object}: ${v.verdict}: ${v.detail ?? ''}`)
  return { step: step('live-dry-run', problems, notes), verdicts }
}
