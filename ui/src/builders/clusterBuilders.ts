/**
 * Read the Builder CRs from the cluster, AS THE SIGNED-IN PERSON, into the registry (ADR 0001).
 *
 * THE READ. snowplow `GET /list?category=builders&ns=<BUILDERS_NAMESPACE>` with the person's bearer,
 * the same read placeableWidgets.ts makes for widgets. `/call` cannot list a collection — its GET
 * requires a `name` (snowplow internal/handlers/call.go) — and `/list` is snowplow's collection read:
 * it discovers the GVRs that declare the category and lists each with the CALLER'S own client
 * (`<user>-clientconfig`). The Builder CRD declares `categories: [krateo, builders]` and is the only
 * CRD in `builders`; the answer is still filtered to `Builder` objects of builders.templates.krateo.io,
 * so a future CRD joining the category cannot be mistaken for one. No `endpointRef`, no service
 * identity: a person who may not list Builders gets a 403, said as such. The read gives up after
 * READ_TIMEOUT_MS, so nothing waits on a snowplow that never answers.
 *
 * NO FALLBACK. A failed first read (snowplow down, 403, the CRD or its CRs missing) leaves the registry
 * empty and its status `failed` with one sentence, which the builder routes show. Serving the bundled
 * fixtures instead would mask a broken cluster source, so there are none in the bundle.
 *
 * ONE READ PER IDENTITY. The answer is cached for the person — the snowplow URL, the namespace and the
 * signed-in USERNAME, not the access token: a session resume refreshes the token without changing who
 * is reading, and must not read (or lose) the Builders again. A different person signing in reads again.
 *
 * A TRANSIENT FAILURE RECOVERS. Every failure but a 403 (and a missing config, which no retry fixes) is
 * retried with a bounded backoff, and once more on the next shell mount, up to MAX_RETRIES in all. A
 * re-read for the same person that fails while Builders are loaded keeps them running and only records
 * the error (noteBuildersRereadFailed).
 */
import type { Config } from '../context/ConfigContext'
import { getAccessToken } from '../utils/getAccessToken'
import { getUserInfo } from '../utils/getUserInfo'

import {
  failBuilders,
  installBuilders,
  markBuildersLoading,
  noteBuildersRereadFailed,
  parseBuilderItems,
  type Loaded,
} from './builderRegistry'
import { builderRefusals } from './pluginRegistry'

/** The category the Builder CRD declares — and the only CRD declaring it. */
export const BUILDER_CATEGORY = 'builders'
const BUILDER_GROUP = 'builders.templates.krateo.io'
const BUILDER_KIND = 'Builder'

/** The frontend config key naming the namespace the Builder CRs live in. */
export const BUILDERS_NAMESPACE_KEY = 'BUILDERS_NAMESPACE'

/** How long one read may take before it is a failure. */
export const READ_TIMEOUT_MS = 15_000
/** The waits before each automatic retry of a transient failure; their count is the retry cap. */
export const RETRY_DELAYS_MS: readonly number[] = [2_000, 6_000, 18_000]
const MAX_RETRIES = RETRY_DELAYS_MS.length

const RELOAD = ' Reload the page to retry.'

/**
 * What one cluster read answered: the Builders, or the sentence for why there are none. `transient`
 * is false only where retrying cannot help (a 403).
 */
export type BuildersRead = { ok: true; loaded: Loaded } | { ok: false; reason: string; transient: boolean }

/**
 * The namespace Builders are read from: `config.api.BUILDERS_NAMESPACE`, trimmed. Empty or absent is
 * null — no fallback namespace, for the same reason builderTargets has no fallback repo: a guessed
 * namespace would read an empty list and say "no Builders" about the wrong place.
 */
export const resolveBuildersNamespace = (api: Pick<Config['api'], 'BUILDERS_NAMESPACE'> | undefined): string | null => {
  const value = api?.BUILDERS_NAMESPACE
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

const accessToken = (): string => {
  try {
    return getAccessToken()
  } catch {
    return ''
  }
}

const authHeader = (): Record<string, string> => {
  const token = accessToken()
  return token ? { Authorization: `Bearer ${token}` } : {}
}

const asRecord = (value: unknown): Record<string, unknown> | null =>
  ((typeof value === 'object' && value !== null && !Array.isArray(value)) ? value as Record<string, unknown> : null)

const isBuilderObject = (item: unknown): boolean => {
  const record = asRecord(item)
  return record?.kind === BUILDER_KIND
    && typeof record.apiVersion === 'string'
    && record.apiVersion.startsWith(`${BUILDER_GROUP}/`)
}

/**
 * Parse a listed set, then add each loaded Builder's plugin refusals as problems: a Builder naming a
 * plugin, lint or gate this frontend does not ship is reported (deny-by-default), and still loads — its
 * route then shows what is wrong with it (ComposerHost) instead of vanishing. The others load untouched.
 */
export const loadedFromItems = (items: readonly unknown[]): Loaded => {
  const parsed = parseBuilderItems(items.filter(isBuilderObject))
  const refusals = parsed.builders.flatMap((builder) =>
    builderRefusals(builder.spec).map((refusal) => `Builder ${builder.metadata.name}: ${refusal}`))
  return { builders: parsed.builders, problems: [...parsed.problems, ...refusals] }
}

const isTimeout = (error: unknown): boolean =>
  error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')

/**
 * One read of the Builders in `namespace`. Never throws: every failure is a sentence. `fetchImpl` is
 * injectable so a test never reaches the network.
 */
export const readClusterBuilders = async (
  snowplowBaseUrl: string,
  namespace: string,
  fetchImpl: typeof fetch = fetch,
): Promise<BuildersRead> => {
  let response: Response
  try {
    const url = new URL(`${snowplowBaseUrl.replace(/\/+$/, '')}/list`)
    url.searchParams.set('category', BUILDER_CATEGORY)
    url.searchParams.set('ns', namespace)
    response = await fetchImpl(url.toString(), { headers: { ...authHeader() }, signal: AbortSignal.timeout(READ_TIMEOUT_MS) })
  } catch (error) {
    if (isTimeout(error)) {
      return { ok: false, reason: `snowplow did not answer within ${READ_TIMEOUT_MS / 1000} s.${RELOAD}`, transient: true }
    }
    return { ok: false, reason: `snowplow could not be reached (${error instanceof Error ? error.message : String(error)}).${RELOAD}`, transient: true }
  }
  if (response.status === 401) {
    return { ok: false, reason: `your session was not accepted (401) — sign in again.${RELOAD}`, transient: true }
  }
  if (response.status === 403) {
    return { ok: false, reason: `you may not list Builders in ${namespace} (403) — the portal's role for signed-in users needs get and list on builders.builders.templates.krateo.io there.`, transient: false }
  }
  if (!response.ok) {
    return { ok: false, reason: `snowplow answered ${response.status} when listing Builders in ${namespace}.${RELOAD}`, transient: true }
  }
  // /list encodes a bare ARRAY of objects — not an envelope, and not a Kubernetes List.
  let items: unknown
  try {
    items = await response.json()
  } catch (error) {
    if (isTimeout(error)) {
      return { ok: false, reason: `snowplow did not answer within ${READ_TIMEOUT_MS / 1000} s.${RELOAD}`, transient: true }
    }
    items = null
  }
  if (!Array.isArray(items)) {
    return { ok: false, reason: `the Builder list from ${namespace} came back in a shape this frontend does not understand.`, transient: true }
  }
  const builderItems = items.filter(isBuilderObject)
  if (!builderItems.length) {
    // `/list` answers an empty array both when the CRD is not installed (nothing declares the
    // category) and when no Builder CR is there — either way there is nothing to run.
    return { ok: false, reason: `no Builder is installed in ${namespace} — the Builder CRD (frontend-crds chart) or the Builder CRs (portal chart) are missing.`, transient: true }
  }
  const loaded = loadedFromItems(builderItems)
  if (!loaded.builders.length) {
    return { ok: false, reason: `none of the ${builderItems.length} Builders in ${namespace} could be used: ${loaded.problems.join(' ')}`, transient: true }
  }
  return { loaded, ok: true }
}

/** The person (and source) the current read is for, and how its reads have gone. */
interface Session {
  key: string
  /** Reads made for this key, the first included. */
  attempts: number
  /** The last read failed, and a retry could help. */
  retryable: boolean
  /** A read is in flight. */
  reading: boolean
  /** This key's Builders are in the registry. */
  loaded: boolean
}

let session: Session | null = null
let inFlight: Promise<void> = Promise.resolve()
let retryTimer: ReturnType<typeof setTimeout> | null = null

const clearRetry = () => {
  if (retryTimer !== null) {
    clearTimeout(retryTimer)
    retryTimer = null
  }
}

/** Who is reading: the signed-in username, or — for a login payload without one — the token. */
const identity = (): string => getUserInfo().username || accessToken()

const startRead = (current: Session, base: string, namespace: string, fetchImpl: typeof fetch): Promise<void> => {
  current.attempts += 1
  current.reading = true
  inFlight = readClusterBuilders(base, namespace, fetchImpl).then((read) => {
    // A different person signed in meanwhile: this answer is no longer the one to show.
    if (session !== current) { return }
    current.reading = false
    if (read.ok) {
      current.loaded = true
      current.retryable = false
      installBuilders(read.loaded)
      return
    }
    if (current.loaded) {
      // A re-read for the same person: what is loaded keeps running.
      noteBuildersRereadFailed(read.reason)
    } else {
      failBuilders(read.reason)
    }
    current.retryable = read.transient
    const retry = current.attempts - 1
    if (read.transient && retry < MAX_RETRIES) {
      retryTimer = setTimeout(() => {
        retryTimer = null
        if (session === current) { void startRead(current, base, namespace, fetchImpl) }
      }, RETRY_DELAYS_MS[retry])
    }
  })
  return inFlight
}

/**
 * Read the Builders unless this person already did (or is doing) so. Called by the shell on mount;
 * returns the read in flight or done, so a test can await it. A mount that finds the last read failed
 * transiently, with no retry pending and the cap not reached, reads again.
 */
export const ensureBuildersLoaded = (config: Config | undefined, fetchImpl: typeof fetch = fetch): Promise<void> => {
  const base = config?.api.SNOWPLOW_API_BASE_URL
  const namespace = resolveBuildersNamespace(config?.api)
  const key = `${base ?? ''}|${namespace ?? ''}|${identity()}`
  if (session?.key === key) {
    const current = session
    if (!current.reading && current.retryable && retryTimer === null && current.attempts - 1 < MAX_RETRIES && base && namespace) {
      return startRead(current, base, namespace, fetchImpl)
    }
    return inFlight
  }
  clearRetry()
  const current: Session = { attempts: 0, key, loaded: false, reading: false, retryable: false }
  session = current
  if (!base) {
    failBuilders('this portal has no snowplow URL configured (SNOWPLOW_API_BASE_URL).')
    inFlight = Promise.resolve()
    return inFlight
  }
  if (!namespace) {
    failBuilders(`this portal has no ${BUILDERS_NAMESPACE_KEY} configured, so it does not know where the Builder CRs are.`)
    inFlight = Promise.resolve()
    return inFlight
  }
  // The first read for this person. Route consumers do not react to `loading` (RoutesContext
  // subscribes to the registry object), so whatever is mounted stays mounted until it answers.
  markBuildersLoading()
  return startRead(current, base, namespace, fetchImpl)
}

/** Forget the session's read — for tests. */
export const resetBuildersReadForTest = (): void => {
  clearRetry()
  session = null
  inFlight = Promise.resolve()
}
