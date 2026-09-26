/**
 * One CRD, read as the person — for placing (its `spec` fields) and, in S4b, for the readiness
 * picker (its `status` fields).
 *
 * THE READ is `describeResource`'s: `GET /call?resource=customresourcedefinitions&apiVersion=
 * apiextensions.k8s.io/v1&name=<plural>.<group>` under the session's bearer. A cluster-scoped `/call`
 * GET needs the name, which the palette already has (its RESTAction projects the plurals), so there
 * is no `/api-info/names` lookup: that endpoint runs without the caller's credential.
 *
 * FAILURE IS CONTENT. A 403, a 404 and snowplow being down each come back as a short reason the
 * inspector can put in a sentence — "Its CRD could not be read (snowplow answered 403)" — and the
 * node is still placed, with an empty spec.
 *
 * BOUNDED IN TIME. A read snowplow does not answer within CRD_READ_MS (a wedged or warming-up
 * snowplow) is abandoned and becomes that same sentence, rather than a row that says "Placing…"
 * until the page is reloaded — while a read is pending, no other custom kind or blueprint places.
 *
 * CACHED PER MOUNT, answers and refusals alike, keyed by CRD name: two Repositories placed in a row
 * read the CRD once, and a person placing again after a denial is told the same thing without
 * asking the cluster again. A timeout is the exception — it says nothing about the CRD, so it is not
 * kept, and placing again reads again. A remount (a reload, the page opened again) reads afresh.
 */
import { useCallback, useRef } from 'react'

import { getAccessToken } from '../../utils/getAccessToken'

/** How long a CRD read may take before it is abandoned. */
export const CRD_READ_MS = 15_000

/** The CRD, or why not — `transient` when the read timed out, so it is not cached. */
export type CrdRead = { crd: Record<string, unknown> } | { error: string; transient?: true }

const TIMED_OUT: CrdRead = { error: `snowplow did not answer within ${CRD_READ_MS / 1000}s`, transient: true }

const authHeader = (): Record<string, string> => {
  try {
    return { Authorization: `Bearer ${getAccessToken()}` }
  } catch {
    return {}
  }
}

/** Read one CRD by name through snowplow. Never throws. */
export const readCrd = async (base: string | undefined, name: string): Promise<CrdRead> => {
  if (!base) {
    return { error: 'this portal has no snowplow URL configured' }
  }
  const abort = new AbortController()
  const timer = setTimeout(() => abort.abort(), CRD_READ_MS)
  try {
    const url = new URL(`${base.replace(/\/+$/, '')}/call`)
    url.searchParams.set('resource', 'customresourcedefinitions')
    url.searchParams.set('apiVersion', 'apiextensions.k8s.io/v1')
    url.searchParams.set('name', name)
    const response = await fetch(url.toString(), { headers: { ...authHeader() }, signal: abort.signal })
    if (!response.ok) {
      return { error: `snowplow answered ${response.status}` }
    }
    const body: unknown = await response.json().catch(() => null)
    if (abort.signal.aborted) {
      return TIMED_OUT
    }
    return typeof body === 'object' && body !== null && !Array.isArray(body)
      ? { crd: body as Record<string, unknown> }
      : { error: 'no object came back' }
  } catch (error) {
    if (abort.signal.aborted) {
      return TIMED_OUT
    }
    return { error: `could not reach snowplow — ${error instanceof Error ? error.message : String(error)}` }
  } finally {
    clearTimeout(timer)
  }
}

/** The per-mount cache over `readCrd`. `read` is stable for the life of the mount and of `base`. */
export const useCrdSchema = (base: string | undefined): { read: (name: string) => Promise<CrdRead> } => {
  const cache = useRef(new Map<string, Promise<CrdRead>>())
  const read = useCallback((name: string): Promise<CrdRead> => {
    const key = `${base ?? ''}|${name}`
    const cached = cache.current.get(key)
    if (cached) { return cached }
    const pending = readCrd(base, name).then((answer) => {
      if ('transient' in answer) { cache.current.delete(key) }
      return answer
    })
    cache.current.set(key, pending)
    return pending
  }, [base])
  return { read }
}
