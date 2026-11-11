/**
 * snowplowCapabilities — what THIS snowplow advertises on `GET /capabilities`, read once per
 * session per base URL.
 *
 * The contract (snowplow `docs/howto-frontend-call-dryrun-raw.md`, section 1): a static, sorted
 * token list; gate each feature on the PRESENCE of its token, never on a version; a `404` is an
 * older snowplow and means NO tokens.
 *
 * FAIL CLOSED: anything that is not a definitive answer (another status, a network error, a
 * timeout, a body that is not the documented shape) is read as "no tokens" for the caller that
 * asked, so it keeps today's behaviour. A definitive answer (`200` with a list, or `404`) is
 * cached for the session; an indefinite one is NOT, so a later write asks again instead of
 * pinning a whole session to the fallback because of one blip.
 *
 * Same request conventions as every other snowplow call the portal makes: the configured
 * SNOWPLOW_API_BASE_URL and `Authorization: Bearer` (the endpoint itself needs none; sending it is
 * what the builder gate's reader does too, and the portal is single-origin, so no preflight).
 */

import { fetchWithTimeout } from './useHandleActions'

/** The token for `X-Krateo-Provenance` on `/call` writes (snowplow#1333). */
export const CAPABILITY_CALL_PROVENANCE = 'call.provenance'

/** Bounds how long the FIRST write of a session can wait on discovery (later ones hit the cache). */
export const CAPABILITIES_TIMEOUT_MS = 5000

const cache = new Map<string, Promise<ReadonlySet<string>>>()

const EMPTY: ReadonlySet<string> = new Set()

/** Thrown inside the read for an answer that must not be cached; never escapes the module. */
class IndefiniteAnswer extends Error {}

const probe = async (apiBaseUrl: string, getAccessToken: () => string): Promise<ReadonlySet<string>> => {
  const res = await fetchWithTimeout(`${apiBaseUrl}/capabilities`, {
    headers: { Accept: 'application/json', Authorization: `Bearer ${getAccessToken()}` },
    method: 'GET',
  }, CAPABILITIES_TIMEOUT_MS)
  if (res.status === 404) { return EMPTY }
  if (res.status !== 200) { throw new IndefiniteAnswer(`HTTP ${res.status}`) }
  const body = await res.json() as { capabilities?: unknown } | null
  const list = body?.capabilities
  if (!Array.isArray(list)) { throw new IndefiniteAnswer('no capabilities list in the body') }
  return new Set(list.filter((item): item is string => typeof item === 'string'))
}

/** The advertised tokens. Never rejects: an indefinite answer resolves to the empty set. */
export const readSnowplowCapabilities = (apiBaseUrl: string, getAccessToken: () => string): Promise<ReadonlySet<string>> => {
  const cached = cache.get(apiBaseUrl)
  if (cached) { return cached }
  const pending = probe(apiBaseUrl, getAccessToken).catch((error: unknown) => {
    cache.delete(apiBaseUrl)
    // eslint-disable-next-line no-console -- a missing capability read only selects the older write path
    console.debug('snowplow /capabilities unreadable; using the pre-capability write path', error)
    return EMPTY
  })
  cache.set(apiBaseUrl, pending)
  return pending
}

/** Whether this snowplow reads `X-Krateo-Provenance` on `/call` writes. Never rejects. */
export const snowplowReadsCallProvenance = async (apiBaseUrl: string, getAccessToken: () => string): Promise<boolean> =>
  (await readSnowplowCapabilities(apiBaseUrl, getAccessToken)).has(CAPABILITY_CALL_PROVENANCE)

/** Tests only: forget every cached answer. */
export const resetSnowplowCapabilitiesCache = (): void => { cache.clear() }
