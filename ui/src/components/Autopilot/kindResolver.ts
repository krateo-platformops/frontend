/**
 * kind → resource plural, ASKED OF THE CLUSTER instead of hardcoded.
 *
 * WHAT THIS REPLACES. `previewSandbox.ts` carried `WIDGET_KIND_PLURALS`, a hand-copied table of all
 * 44 widget kinds. It was a duplicate of something the API server already publishes, and it drifted:
 * `PageHeader` and `Theme` shipped as CRDs and never reached the table, so every page a person
 * started — `StartDraftModal` emits a PageHeader, and design rule P25 requires one on every
 * nav-declared page — was refused with "unknown kind" and never rendered live.
 *
 * WHY A TABLE WAS THE WRONG SHAPE, not merely out of date. The mapping is not ours to state. A
 * CRD's `metadata.name` must equal `<plural>.<group>`, so the API server knows it exactly and can
 * never disagree with itself; any copy can only be right by coincidence and stale by default.
 *
 * WHAT THE OFFICIAL CLIENTS DO. `@kubernetes/client-node`'s `KubernetesObjectApi.resource()` GETs
 * `/apis/<group>/<version>`, caches the `V1APIResourceList` per apiVersion, and finds the entry
 * whose `kind` matches — `resource.name` is the plural. client-go's `DiscoveryClient` behind a
 * `RESTMapper` does the same. Neither ships a plural table. We cannot use that library here (it is
 * Node-only: `KubeConfig` imports `node:fs`/`node:tls`, and a browser has neither a kubeconfig nor
 * a route to the apiserver), so this is the same mechanism over the transport we do have.
 *
 * THE TRANSPORT. snowplow already runs the discovery client: `GET /api-info/names?apiVersion=&kind=`
 * is served by its plurals resolver, which calls client-go's `ServerResourcesForGroupVersion`. So
 * the authority is the API server either way; this module is the browser's client for it.
 *
 * CACHED FOREVER, deliberately and for the reason snowplow's own resolver gives: the mapping is
 * K8s-immutable for the lifetime of a CRD object, because the name constraint above makes renaming
 * impossible. There is nothing to expire.
 *
 * PRIME THEN READ. Resolution is async but the callers that build API paths are not, so the shape
 * is the library's: resolve once at the top (`primeKinds`), then look up synchronously
 * (`pluralOf`). A kind that was never primed reads as unknown, which is the same deny-by-default
 * the table gave — an unprimed lookup can only under-permit, never over-permit.
 */
import { getAccessToken } from '../../utils/getAccessToken'

/** Same best-effort Bearer the other snowplow reads use: no token, no header, never a throw. */
const authHeader = (): Record<string, string> => {
  try {
    return { Authorization: `Bearer ${getAccessToken()}` }
  } catch {
    return {}
  }
}

const cache = new Map<string, string | null>()

const key = (apiVersion: string, kind: string): string => `${apiVersion}/${kind}`

/** Resolve ONE kind through snowplow's discovery-backed resolver. null = not a served kind. */
const fetchPlural = async (base: string, apiVersion: string, kind: string): Promise<string | null> => {
  const url = new URL(`${base.replace(/\/+$/, '')}/api-info/names`)
  url.searchParams.set('apiVersion', apiVersion)
  url.searchParams.set('kind', kind)
  const response = await fetch(url.toString(), { headers: { ...authHeader() } })
  if (!response.ok) {
    // 404 is the API server's own answer — this group/version serves no such kind. Anything else
    // (401, 503, a network failure) is NOT an answer, and must not be cached as "unknown": doing so
    // would turn one blip into a permanent refusal for the rest of the session.
    if (response.status === 404) {
      return null
    }
    throw new Error(`kind lookup failed for ${kind}: ${response.status}`)
  }
  const body = await response.json() as { plural?: unknown }
  return typeof body.plural === 'string' && body.plural ? body.plural : null
}

/**
 * Resolve every kind in `kinds` for `apiVersion`, filling the cache. Already-known kinds cost
 * nothing. Resolution failures are NOT cached (see fetchPlural) and surface as an unknown kind at
 * lookup, so a preview is refused rather than applied against a guessed path.
 */
export const primeKinds = async (
  base: string | undefined,
  apiVersion: string,
  kinds: readonly string[],
): Promise<void> => {
  if (!base) {
    return
  }
  const wanted = [...new Set(kinds)].filter((kind) => kind && !cache.has(key(apiVersion, kind)))
  await Promise.all(wanted.map(async (kind) => {
    try {
      cache.set(key(apiVersion, kind), await fetchPlural(base, apiVersion, kind))
    } catch {
      // left unset: the next attempt retries rather than inheriting a transport failure
    }
  }))
}

/** The plural for a primed kind, or null. Synchronous — see PRIME THEN READ above. */
export const pluralOf = (apiVersion: string, kind: string): string | null =>
  cache.get(key(apiVersion, kind)) ?? null

/** TEST SEAM — the cache is process-wide and permanent by design. */
export const resetKindCacheForTests = (): void => cache.clear()
