/**
 * callProvenance — the `X-Krateo-Provenance` request header (snowplow#1333, contract v1:
 * snowplow `docs/howto-frontend-call-provenance.md`).
 *
 * Where snowplow advertises `call.provenance`, every gated portal write carries ONE header that
 * asserts what only the browser knows: that a person confirmed THIS set at the gate, which set it
 * was (by hash), which op of it this `/call` is, when they confirmed, and — for an agent-proposed
 * write — the Agentiko session it came from. Snowplow records the write itself (user, actor class,
 * verb, target, namespace, outcome, time) and files these beside it as `krateo.audit.client.*`.
 *
 * THE SCHEMA IS CLOSED. Any key outside `CallProvenance` gets the WHOLE header rejected, which is
 * why the type is the allow-list and the builder writes only its keys: no actor, no agent id, no
 * verb or target, no outcome, no resolvedAt, and never the prompt or any other free text.
 *
 * A rejected header never blocks the write (snowplow sends it to the apiserver unchanged), but it
 * loses the provenance silently — snowplow does not signal the rejection. So every value is checked
 * here against the same rule the decoder applies, and an optional value that would fail is left
 * out rather than sent.
 */

import { sha256HexOfUtf8 } from '../utils/sha256'
import { randomId } from '../utils/utils'

import type { BlastRadius, BlastRadiusSet } from './blastRadius.types'

export const PROVENANCE_HEADER = 'X-Krateo-Provenance'

/** The contract's bound on the header VALUE, `v1.` included (`MaxProvenanceBytes`). */
export const MAX_PROVENANCE_BYTES = 2048

/** The decoder's `opaqueID` (agentSessionId). */
const OPAQUE_ID = /^[A-Za-z0-9_-]{1,128}$/
/** The decoder's `lowerUUID` (confirmationId). */
const LOWER_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
/** The decoder's `lowerSHA256` (confirmedSet.sha256). */
const LOWER_SHA256 = /^[0-9a-f]{64}$/
/** The decoder's `rfc3339Millis` (requestedAt), with the date/time/offset fields captured. */
const RFC3339_MILLIS = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})\.(\d{3})(?:Z|([+-])(\d{2}):(\d{2}))$/

/** `confirmedSet` — the confirmed set, by size, irreversibility and hash. */
export interface ConfirmedSetAssertion {
  count: number
  irreversible: boolean
  sha256: string
}

/**
 * The whole v1 schema — the allow-list. `confirmationId`, `confirmedSet` and `op` come all three
 * or none (snowplow#1357 refuses a partial confirmation as `schema`).
 */
export interface CallProvenance {
  source: 'portal'
  agentSessionId?: string
  confirmationId?: string
  confirmedSet?: ConfirmedSetAssertion
  op?: number
  requestedAt?: string
}

/** One op of the canonical confirmed set: exactly these seven keys, in this (sorted) order. */
export interface CanonicalOp {
  group: string
  irreversible: boolean
  name: string
  namespace: string
  resource: string
  verb: string
  version: string
}

/** The canonical key order — sorted, as the contract requires. The serializer writes only these. */
export const CANONICAL_OP_KEYS = ['group', 'irreversible', 'name', 'namespace', 'resource', 'verb', 'version'] as const satisfies readonly (keyof CanonicalOp)[]

/**
 * The confirmed radius as the canonical op list, in confirmation (= dispatch) order. A scalar
 * write is a set of one. Core group `""`, absent name `""`, verb upper-case. Diffs and payload
 * previews are not part of it.
 */
export const canonicalOpsOf = (radius: BlastRadius | BlastRadiusSet): CanonicalOp[] => {
  if ('ops' in radius) {
    return radius.ops.map((op) => ({
      group: op.gvr.group,
      irreversible: op.irreversible,
      name: op.name ?? '',
      namespace: op.namespace,
      resource: op.gvr.resource,
      verb: op.verb.toUpperCase(),
      version: op.gvr.version,
    }))
  }
  return [{
    group: radius.gvr.group,
    irreversible: radius.verb === 'DELETE',
    name: radius.name ?? '',
    namespace: radius.namespace,
    resource: radius.gvr.resource,
    verb: radius.verb.toUpperCase(),
    version: radius.gvr.version,
  }]
}

/**
 * The canonical bytes (as a string; hashed as UTF-8): compact JSON of the array, each op
 * re-built key by key in CANONICAL_OP_KEYS order, so the output does not depend on how the op
 * object happened to be constructed. JSON.stringify escapes exactly the contract's minimum
 * (quote, backslash, controls below U+0020) and writes everything else raw.
 */
export const canonicalSetJson = (ops: readonly CanonicalOp[]): string =>
  JSON.stringify(ops.map((op) => Object.fromEntries(CANONICAL_OP_KEYS.map((key) => [key, op[key]]))))

/** `confirmedSet` for a confirmed radius: count and irreversibility from the same op list the hash covers. */
export const confirmedSetOf = (radius: BlastRadius | BlastRadiusSet): ConfirmedSetAssertion => {
  const ops = canonicalOpsOf(radius)
  return {
    count: ops.length,
    irreversible: ops.some((op) => op.irreversible),
    sha256: sha256HexOfUtf8(canonicalSetJson(ops)),
  }
}

const isLeapYear = (year: number): boolean => (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0
const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]

/**
 * The decoder's `requestedAt` rule: RFC 3339 with exactly three fractional digits; `Z` or
 * `±hh:mm` with hour 00-23 and minute 00-59; a real date and time (seconds 00-59, as Go's
 * time.Parse reads them); and an instant whose UTC form is in the years 0000-9999.
 */
export const isContractRequestedAt = (value: string): boolean => {
  const match = RFC3339_MILLIS.exec(value)
  if (!match) { return false }
  const [year, month, day, hour, minute, second, millis] = match.slice(1, 8).map(Number)
  const [sign, offsetHourText, offsetMinuteText] = match.slice(8)
  if (month < 1 || month > 12) { return false }
  const monthDays = month === 2 && isLeapYear(year) ? 29 : DAYS_IN_MONTH[month - 1]
  if (day < 1 || day > monthDays || hour > 23 || minute > 59 || second > 59) { return false }
  let offsetMs = 0
  if (sign !== undefined) {
    const offsetHour = Number(offsetHourText)
    const offsetMinute = Number(offsetMinuteText)
    if (offsetHour > 23 || offsetMinute > 59) { return false }
    offsetMs = (sign === '-' ? -1 : 1) * (offsetHour * 60 + offsetMinute) * 60_000
  }
  const local = new Date(0)
  // setUTCFullYear, not Date.UTC: Date.UTC maps years 0-99 to 1900-1999.
  local.setUTCFullYear(year, month - 1, day)
  local.setUTCHours(hour, minute, second, millis)
  const utcYear = new Date(local.getTime() - offsetMs).getUTCFullYear()
  return utcYear >= 0 && utcYear <= 9999
}

/** RFC 4648 section 5, no padding, of the UTF-8 bytes. */
const base64UrlOfUtf8 = (text: string): string =>
  btoa(String.fromCharCode(...new TextEncoder().encode(text)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')

/** Inputs for one `/call` of a confirmed set (or of an unconfirmed one: see writeProvenanceOf). */
export interface ProvenanceInput {
  agentSessionId?: string
  confirmationId?: string
  confirmedSet?: ConfirmedSetAssertion
  op?: number
  requestedAt?: string
}

/**
 * The header's JSON object: `source` plus each input that passes its decoder rule. An optional
 * value that would fail is DROPPED (so the rest is still recorded) and said so once on debug.
 * The confirmation (`confirmationId` + `confirmedSet` + `op`) is kept only as a whole valid
 * triple; any part missing or invalid drops all three, recorded as `confirmation`.
 */
export const buildCallProvenance = (input: ProvenanceInput): CallProvenance => {
  const provenance: CallProvenance = { source: 'portal' }
  const dropped: string[] = []
  if (input.agentSessionId !== undefined) {
    if (OPAQUE_ID.test(input.agentSessionId)) {
      provenance.agentSessionId = input.agentSessionId
    } else {
      dropped.push('agentSessionId')
    }
  }
  // THE CONFIRMATION IS ONE UNIT (snowplow#1357): confirmationId, confirmedSet and op appear all
  // three or not at all, and a partial set is refused as `schema`. So the three are judged
  // together: one missing or invalid drops all three, never just the bad one.
  const { confirmationId, confirmedSet, op } = input
  if (confirmationId !== undefined || confirmedSet !== undefined || op !== undefined) {
    const valid = confirmationId !== undefined && confirmedSet !== undefined && op !== undefined
      && LOWER_UUID.test(confirmationId)
      && Number.isSafeInteger(confirmedSet.count) && confirmedSet.count >= 1
      && typeof confirmedSet.irreversible === 'boolean'
      && LOWER_SHA256.test(confirmedSet.sha256)
      && Number.isSafeInteger(op) && op >= 0 && op < confirmedSet.count
    if (valid) {
      provenance.confirmationId = confirmationId
      provenance.confirmedSet = { count: confirmedSet.count, irreversible: confirmedSet.irreversible, sha256: confirmedSet.sha256 }
      provenance.op = op
    } else {
      dropped.push('confirmation')
    }
  }
  if (input.requestedAt !== undefined) {
    if (isContractRequestedAt(input.requestedAt)) {
      provenance.requestedAt = input.requestedAt
    } else {
      dropped.push('requestedAt')
    }
  }
  if (dropped.length > 0) {
    // eslint-disable-next-line no-console -- a value outside the contract would get the whole header rejected
    console.debug(`provenance header: left out ${dropped.join(', ')} (outside the v1 contract)`)
  }
  return provenance
}

/**
 * The header VALUE: `v1.` + unpadded base64url of the JSON. Undefined when it would exceed the
 * contract's bound — unreachable for a value buildCallProvenance produced (every field is
 * bounded: the hash, not the set, carries the set's size), and asserted rather than assumed.
 */
export const encodeCallProvenance = (provenance: CallProvenance): string | undefined => {
  const value = `v1.${base64UrlOfUtf8(JSON.stringify(provenance))}`
  if (value.length > MAX_PROVENANCE_BYTES) {
    // eslint-disable-next-line no-console -- the bound is the contract's; an oversize header is rejected whole
    console.debug(`provenance header: ${value.length} bytes exceeds ${MAX_PROVENANCE_BYTES}; not sent`)
    return undefined
  }
  return value
}

/**
 * The header for one `/call`, as a headers-object fragment (empty when nothing can be sent), and
 * the ONLY place it is spelled: callers spread it AFTER removing any other spelling of the header
 * (withoutProvenanceHeader), so a request carries exactly one field line.
 */
export const provenanceHeaderOf = (input: ProvenanceInput): Record<string, string> => {
  const value = encodeCallProvenance(buildCallProvenance(input))
  return value === undefined ? {} : { [PROVENANCE_HEADER]: value }
}

/**
 * Drop every case-variant of the provenance header from a headers object. A widget's declared
 * `headers` must not assert provenance: beside the portal's own, a second spelling would make
 * two field lines, which the contract joins and rejects (`encoding`).
 */
export const withoutProvenanceHeader = (headers: Record<string, string>): Record<string, string> =>
  Object.fromEntries(Object.entries(headers).filter(([key]) => key.toLowerCase() !== PROVENANCE_HEADER.toLowerCase()))

/**
 * Everything a confirmed write knows at the moment the gate was passed, from which each `/call`
 * of it takes its header (`headerFor(op)`). Created ONCE per press of the confirm gate, so every
 * call of the set shares the confirmationId, the hash and requestedAt, and differs only in `op`.
 *
 * `confirmed: false` is a set dispatched WITHOUT a confirm (the sandbox-confined preview carve-out,
 * runRestSet's SetDispatchOptions.skipConfirmForSandbox): nobody pressed the gate, so it asserts
 * no confirmationId and no confirmedSet/op — only the source, the agent session and the time.
 */
export interface ConfirmedWrite {
  headerFor: (op: number) => Record<string, string>
}

export const confirmedWriteOf = (
  radius: BlastRadius | BlastRadiusSet,
  options: { agentSessionId?: string; confirmed: boolean; requestedAt: string },
): ConfirmedWrite => {
  const confirmationId = options.confirmed ? randomId() : undefined
  const confirmedSet = options.confirmed ? confirmedSetOf(radius) : undefined
  const shared = {
    ...(options.agentSessionId === undefined ? {} : { agentSessionId: options.agentSessionId }),
    ...(confirmationId === undefined ? {} : { confirmationId }),
    requestedAt: options.requestedAt,
  }
  return {
    headerFor: (op) => provenanceHeaderOf(confirmedSet ? { ...shared, confirmedSet, op } : shared),
  }
}
