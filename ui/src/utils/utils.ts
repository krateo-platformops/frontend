import type { ResourcesRefs } from '../types/Widget'

export const getResourceRef = (resourceRefId: string, resourcesRefs: ResourcesRefs) => {
  if (!resourcesRefs || resourcesRefs.items.length === 0) {
    console.error(`Cannot find resources refs for resource ref with ID ${resourceRefId}`)
    return
  }

  const backendEndpoint = resourcesRefs.items.find(({ id }) => {
    return id === resourceRefId
  })

  if (!backendEndpoint) {
    console.error(`Cannot find resource ref with ID ${resourceRefId}`)
  }

  return backendEndpoint
}

export const getEndpointUrl = (resourceRefId: string, resourcesRefs: ResourcesRefs) => {
  const backendEndpoint = getResourceRef(resourceRefId, resourcesRefs)

  return backendEndpoint?.path
}

/** snowplow's read route: a widget's endpoint is a `GET /call` read (getResourceEndpoint, or a
 * resourcesRefs `path` snowplow emitted), relative to `SNOWPLOW_API_BASE_URL`. */
export const SNOWPLOW_CALL_PATH = '/call'

/** snowplow's export route (`POST /export`, snowplow#970), mounted on the same mux as `/call`, so a
 * sibling of it under `SNOWPLOW_API_BASE_URL`. A POST to `/call` itself is the WRITE passthrough. */
export const SNOWPLOW_EXPORT_PATH = '/export'

export const getResourceEndpoint = ({
  apiVersion,
  name,
  namespace,
  resource,
}: {
  resource: string
  apiVersion: string
  name: string
  /** Omit for a cluster-scoped resource: snowplow reads an absent `namespace` as
   * cluster-scoped (#156). An empty or undefined one must not be sent as a value. */
  namespace?: string
}): string => {
  const ns = namespace ? `&namespace=${namespace}` : ''

  return `${SNOWPLOW_CALL_PATH}?resource=${resource}&apiVersion=${apiVersion}&name=${name}${ns}`
}

/**
 * The query of a `/call` read endpoint (`resource`, `apiVersion`, `name`, `namespace`, and whatever
 * else it carries), verbatim — or null when `endpoint` is not a `/call` read.
 */
export const getCallReadQuery = (endpoint: string): string | null => {
  const queryStart = endpoint.indexOf('?')
  const path = queryStart === -1 ? endpoint : endpoint.slice(0, queryStart)

  return path === SNOWPLOW_CALL_PATH ? endpoint.slice(path.length + 1) : null
}

/** The read's window. An export must not carry it: see getExportEndpoint. */
const READ_WINDOW_PARAMS: ReadonlySet<string> = new Set(['page', 'perPage'])

/**
 * The endpoint that exports a `/call` read: the read's own query (`getCallReadQuery`) without its
 * window, on snowplow's export route, followed by `exportQuery` (widgets/Table/tableExport.ts).
 *
 * snowplow's export strips its own parameters and re-dispatches the request through the `/call`
 * read lane with every other one, so the read's identifying parameters must arrive exactly as the
 * read sends them: every parameter but the window is kept byte-for-byte.
 *
 * `page` and `perPage` are dropped. A widget endpoint carries them when its ref declares a bounded
 * window (`resourcesRefs.items[].slice`), and snowplow exports exactly the window it is given. With
 * neither, it walks the full list (`page=N&perPage=500`) and concatenates, so the export covers
 * every row rather than the slice on screen.
 */
export const getExportEndpoint = (readQuery: string, exportQuery: string): string => {
  const readParams = readQuery.split('&').filter((param) => {
    const separator = param.indexOf('=')
    return param.length > 0 && !READ_WINDOW_PARAMS.has(separator === -1 ? param : param.slice(0, separator))
  })
  const query = [...readParams, exportQuery].filter((part) => part.length > 0).join('&')

  return `${SNOWPLOW_EXPORT_PATH}${query ? `?${query}` : ''}`
}

export const formatISODate = (value: string, showTime: boolean = false) => {
  return showTime
    ? new Date(value).toLocaleDateString('en', {
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      month: 'long',
      year: 'numeric',
    })
    : new Date(value).toLocaleDateString('en', { day: 'numeric', month: 'long', year: 'numeric' })
}

/** Compact relative time ("now", "12s", "5m", "3h", "2d", "2w") — flight-deck
 * telemetry style, no " ago" suffix, with a weeks tier; falls back to the absolute
 * date beyond ~8 weeks. Used by feed/list rows + table cells. */
export const formatRelativeTime = (value: string): string => {
  const then = new Date(value).getTime()
  if (Number.isNaN(then)) { return value }
  const seconds = Math.round((Date.now() - then) / 1000)
  if (seconds < 10) { return 'now' }
  if (seconds < 60) { return `${seconds}s` }
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) { return `${minutes}m` }
  const hours = Math.round(minutes / 60)
  if (hours < 24) { return `${hours}h` }
  const days = Math.round(hours / 24)
  if (days < 7) { return `${days}d` }
  const weeks = Math.round(days / 7)
  if (days < 60) { return `${weeks}w` }
  return formatISODate(value)
}

export const getHeadersObject = (headers: string[]): Record<string, string> | undefined => {
  const result: Record<string, string> = {}

  for (const header of headers) {
    const parts = header.split(':')
    if (parts.length !== 2) {
      return undefined
    }

    const key = parts[0].trim()
    const value = parts[1].trim()

    if (!key || !value) {
      return undefined
    }

    result[key] = value
  }

  return result
}

/** RFC-4122 v4 UUID that works in INSECURE contexts. `crypto.randomUUID()` is
 * secure-context-only (HTTPS / localhost) and is `undefined` over plain
 * `http://<bare-IP>` — the default way the portal is reached via a LoadBalancer IP —
 * so calling it there throws "crypto.randomUUID is not a function" and crashes the app.
 * `crypto.getRandomValues()` IS available in insecure contexts, so derive the UUID from
 * it (with a Math.random fallback for ancient runtimes). These IDs are non-security-
 * sensitive (Agentiko session/message keys); cryptographic strength is not required.
 *
 * ALWAYS LOWER-CASE, on every branch: it is also the provenance header's `confirmationId`, which
 * snowplow accepts only as a canonical lower-case UUID — and refuses together with the rest of
 * the confirmation when it is not (hooks/callProvenance.ts). */
export const randomId = (): string => {
  const webCrypto = globalThis.crypto
  if (webCrypto && typeof webCrypto.randomUUID === 'function') {
    return webCrypto.randomUUID().toLowerCase()
  }
  const bytes = new Uint8Array(16)
  if (webCrypto && typeof webCrypto.getRandomValues === 'function') {
    webCrypto.getRandomValues(bytes)
  } else {
    for (let i = 0; i < bytes.length; i++) { bytes[i] = Math.floor(Math.random() * 256) }
  }
  // RFC-4122 v4: pin the version (4) and variant (10xx) bits
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

export const parseNumberOrNull = (value: unknown): number | null => {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null
  }

  if (typeof value !== 'string') {
    return null
  }

  const trimmed = value.trim()
  if (trimmed === '') {
    return null
  }

  const parsed = Number(trimmed)
  return Number.isFinite(parsed) ? parsed : null
}

/**
 * "1 write" / "2 writes" — a count with its noun agreed. Copy that interpolates a count into a
 * fixed plural ("Confirm 1 writes") reads as a bug on the very gate that asks a human to commit;
 * every count-plus-noun in user-facing copy goes through here. `plural` defaults to `singular + 's'`
 * — pass it for the irregular ones ("branch" → "branches").
 */
export const countNoun = (count: number, singular: string, plural: string = `${singular}s`): string =>
  `${count} ${count === 1 ? singular : plural}`
