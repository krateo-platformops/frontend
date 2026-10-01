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
 * identity: a person who may not list Builders gets a 403, said as such.
 *
 * NO FALLBACK. A failed read (snowplow down, 403, the CRD or its CRs missing) leaves the registry empty
 * and its status `failed` with one sentence, which the builder routes show. Serving the bundled
 * fixtures instead would mask a broken cluster source, so there are none in the bundle.
 *
 * ONE READ PER SIGN-IN. The answer is cached for the session, keyed by the snowplow URL, the namespace
 * and the access token: a remount of the shell does not read again, a new sign-in does. A failure is
 * cached the same way — retrying on every remount would hammer a snowplow that just said no.
 */
import type { Config } from '../context/ConfigContext'
import { getAccessToken } from '../utils/getAccessToken'

import { failBuilders, installBuilders, markBuildersLoading, parseBuilderItems, type Loaded } from './builderRegistry'
import { builderRefusals } from './pluginRegistry'

/** The category the Builder CRD declares — and the only CRD declaring it. */
export const BUILDER_CATEGORY = 'builders'
const BUILDER_GROUP = 'builders.templates.krateo.io'
const BUILDER_KIND = 'Builder'

/** The frontend config key naming the namespace the Builder CRs live in. */
export const BUILDERS_NAMESPACE_KEY = 'BUILDERS_NAMESPACE'

/** What one cluster read answered: the Builders, or the sentence for why there are none. */
export type BuildersRead = { ok: true; loaded: Loaded } | { ok: false; reason: string }

/**
 * The namespace Builders are read from: `config.api.BUILDERS_NAMESPACE`, trimmed. Empty or absent is
 * null — no fallback namespace, for the same reason builderTargets has no fallback repo: a guessed
 * namespace would read an empty list and say "no Builders" about the wrong place.
 */
export const resolveBuildersNamespace = (api: Pick<Config['api'], 'BUILDERS_NAMESPACE'> | undefined): string | null => {
  const value = api?.BUILDERS_NAMESPACE
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

const authHeader = (): Record<string, string> => {
  try {
    return { Authorization: `Bearer ${getAccessToken()}` }
  } catch {
    return {}
  }
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
    response = await fetchImpl(url.toString(), { headers: { ...authHeader() } })
  } catch (error) {
    return { ok: false, reason: `snowplow could not be reached (${error instanceof Error ? error.message : String(error)}).` }
  }
  if (response.status === 401) {
    return { ok: false, reason: 'your session was not accepted (401) — sign in again.' }
  }
  if (response.status === 403) {
    return { ok: false, reason: `you may not list Builders in ${namespace} (403) — the portal's role for signed-in users needs get and list on builders.builders.templates.krateo.io there.` }
  }
  if (!response.ok) {
    return { ok: false, reason: `snowplow answered ${response.status} when listing Builders in ${namespace}.` }
  }
  // /list encodes a bare ARRAY of objects — not an envelope, and not a Kubernetes List.
  const items = await response.json().catch(() => null) as unknown
  if (!Array.isArray(items)) {
    return { ok: false, reason: `the Builder list from ${namespace} came back in a shape this frontend does not understand.` }
  }
  const builderItems = items.filter(isBuilderObject)
  if (!builderItems.length) {
    // `/list` answers an empty array both when the CRD is not installed (nothing declares the
    // category) and when no Builder CR is there — either way there is nothing to run.
    return { ok: false, reason: `no Builder is installed in ${namespace} — the Builder CRD (frontend-crds chart) or the Builder CRs (portal chart) are missing.` }
  }
  const loaded = loadedFromItems(builderItems)
  if (!loaded.builders.length) {
    return { ok: false, reason: `none of the ${builderItems.length} Builders in ${namespace} could be used: ${loaded.problems.join(' ')}` }
  }
  return { loaded, ok: true }
}

/** The key the session's read is cached under — and the request whose answer is current. */
let readKey: string | null = null
let inFlight: Promise<void> = Promise.resolve()

/**
 * Read the Builders unless this sign-in already did (or is doing) so. Called by the shell on mount;
 * returns the read in flight or done, so a test can await it.
 */
export const ensureBuildersLoaded = (config: Config | undefined, fetchImpl: typeof fetch = fetch): Promise<void> => {
  const base = config?.api.SNOWPLOW_API_BASE_URL
  const namespace = resolveBuildersNamespace(config?.api)
  let token = ''
  try {
    token = getAccessToken()
  } catch {
    /* not signed in — the key still differs from a signed-in one */
  }
  const key = `${base ?? ''}|${namespace ?? ''}|${token}`
  if (key === readKey) {
    return inFlight
  }
  readKey = key
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
  markBuildersLoading()
  inFlight = readClusterBuilders(base, namespace, fetchImpl).then((read) => {
    // A newer sign-in started another read: this answer is no longer the person's.
    if (readKey !== key) { return }
    if (read.ok) {
      installBuilders(read.loaded)
    } else {
      failBuilders(read.reason)
    }
  })
  return inFlight
}

/** Forget the session's read — for tests. */
export const resetBuildersReadForTest = (): void => {
  readKey = null
  inFlight = Promise.resolve()
}
