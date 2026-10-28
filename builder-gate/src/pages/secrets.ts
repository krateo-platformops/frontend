/**
 * No RESTAction a page binds may read Secrets — the rule of krateo-platformops/portal
 * scripts/lint-ra-secrets.py at 72b9279 (portal#290), ported function for function so a draft is
 * refused for exactly what the portal's own charts are refused for. CI replays the shared corpus
 * (test/secrets/cases.json, the portal's own 22 planted bypasses and 6 clean shapes among it)
 * through both, and they must agree on every case.
 *
 * WHY (from that lint): snowplow serves an api step's GET or LIST of core/v1 secrets from a
 * dynamic informer it registers CLUSTER-WIDE on first touch, holding every Secret's data, and the
 * response can land in an identity-free cache. A step that names Secrets pulls every Secret into
 * snowplow, and its output would reach the agent's context.
 *
 * WHAT IT REFUSES, per api step (check_step):
 *   - "secret" in the path, dependsOn.iterator, userAccessFilter.resource or .resourcesFrom —
 *     after percent- and jq-\u-decoding (three layers), lower-casing and dropping every
 *     non-letter; a list or an object is read as its JSON, keys and values alike;
 *   - a path that CLIMBS: a literal with "..", or "%2e" in any case, or literals that joined
 *     contain ".." ("." + ".");
 *   - a DATA-DRIVEN path (a `${ }` path to the API server whose resource no literal fixes, or that
 *     builds characters: implode, ascii, @base64d, @base32d, fromjson, a \u escape, "x" * n)
 *     unless it is GUARDED: the path is one field of the item, `${ .<field> }`; the iterator BEGINS
 *     with portal.fetchableDefs exactly (fetchableDefs.json, whitespace-normalized); nothing after
 *     them redefines fetchable* or builds characters; and it applies `(.<field> | fetchablePath)`.
 * An endpointRef step calls another service, not the API server: only the word check applies.
 */
import { isRestAction, labelOf, rec, type Rec, str } from './drafts'
import canonical from './fetchableDefs.json'

const LITERAL = /"((?:[^"\\]|\\.)*)"/g
const CORE_RESOURCE_LITERAL = /^\/[a-z][a-z0-9]*(\/|$)/
const CORE_FIXED_IN_FIRST = /^\/api\/[^/]+\/(namespaces\/[^/]+\/[a-z]+|(?!namespaces)[a-z]+)/
const JQ_UNICODE = /\\u([0-9a-fA-F]{4})/g
/** jq that builds characters: what such a path spells is not in its text. */
const CONSTRUCTED = /\bimplode\b|\bascii\b|@base64d|@base32d|\bfromjson\b|\\u[0-9a-fA-F]{4}|"\s*\*/
const FIELD_PATH = /^\$\{\s*\.([A-Za-z_][A-Za-z0-9_]*)\s*\}$/

const literalsOf = (text: string): string[] => [...text.matchAll(LITERAL)].map((m) => m[1])

/** Python's json.dumps(value, ensure_ascii=False, sort_keys=True): the same text, key order included. */
const pyDumps = (value: unknown): string => {
  if (value === null || value === undefined) {
    return 'null'
  }
  if (Array.isArray(value)) {
    return `[${value.map(pyDumps).join(', ')}]`
  }
  if (typeof value === 'object') {
    const entries = Object.keys(value as Rec).sort().map((k) => `${JSON.stringify(k)}: ${pyDumps((value as Rec)[k])}`)
    return `{${entries.join(', ')}}`
  }
  if (typeof value === 'boolean') {
    return value ? 'true' : 'false'
  }
  return JSON.stringify(value)
}

/** A field as one string: a list or an object as its JSON, so its keys and values all count (as_text). */
const asText = (value: unknown): string => (value == null ? '' : typeof value === 'string' ? value : pyDumps(value))

/** urllib.parse.unquote: %XX runs decoded as UTF-8, anything else left as it is. */
const unquote = (text: string): string =>
  text.replace(/(?:%[0-9a-fA-F]{2})+/g, (run) => Buffer.from(run.replace(/%/g, ''), 'hex').toString('utf8'))

/** `text` with percent-encoding and jq \u escapes undone, each up to three layers deep (decoded). */
const decoded = (value: string): string => {
  let text = value
  for (let round = 0; round < 3; round += 1) {
    text = unquote(text).replace(JQ_UNICODE, (_m, hex: string) => String.fromCharCode(parseInt(hex, 16)))
  }
  return text
}

/** Whether `value` spells "secret", however it is encoded, cased or cut into pieces (names_secrets). */
export const namesSecrets = (value: unknown): boolean => decoded(asText(value)).toLowerCase().replace(/[^a-z]/g, '').includes('secret')

const normalized = (text: string): string => text.replace(/\s+/g, ' ').trim()

/** portal.fetchableDefs as _fetchable.tpl defines it, whitespace-normalized (canonical_defs). */
const CANONICAL = normalized(canonical.defs)
{
  const core = /def fetchableCore: (\[[^\]]*\])/.exec(CANONICAL)
  if (!core || (JSON.parse(core[1]) as unknown[]).some((c) => namesSecrets(c))) {
    throw new Error('fetchableDefs.json: fetchableCore is not an array literal, or it names secrets')
  }
}

/** A path literal that could walk out of the resource it names: "..", %2e, or "." + "." (climbs). */
export const climbs = (api: Rec): string => {
  const path = (typeof api.path === 'string' ? api.path : String(api.path ?? '')).trim()
  if (api.endpointRef || !path) {
    return ''
  }
  const literals = path.startsWith('${') ? literalsOf(path) : [path]
  for (const lit of literals) {
    if (lit.toLowerCase().includes('%2e') || decoded(lit).includes('..')) {
      return `path literal "${lit}" climbs (.. or %2e)`
    }
  }
  return decoded(literals.join('')).includes('..') ? 'path literals joined climb (..)' : ''
}

/** A `${ }` path to the API server whose resource is not fixed by a literal (data_driven). */
export const dataDriven = (api: Rec): boolean => {
  const path = (str(api.path) ?? '').trim()
  if (api.endpointRef || !path.startsWith('${')) {
    return false
  }
  if (CONSTRUCTED.test(path)) {
    return true
  }
  const literals = literalsOf(path)
  const first = path.slice(2).trimStart()
  if (!first.startsWith('"') || literals.length === 0) {
    return true
  }
  if (literals[0].startsWith('/apis/')) {
    return false
  }
  if (literals[0].startsWith('/api/')) {
    // The core group: fixed only when a later literal is the resource segment.
    return !(CORE_FIXED_IN_FIRST.test(literals[0]) || literals.slice(1).some((l) => CORE_RESOURCE_LITERAL.test(l)))
  }
  return true
}

const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** The path is one field of the item, and the iterator applies portal.fetchableDefs, verbatim, to it (guarded). */
export const guarded = (api: Rec): { ok: boolean; why: string } => {
  const field = FIELD_PATH.exec((str(api.path) ?? '').trim())
  if (!field) {
    return { ok: false, why: 'not a single field of the iterator item, so fetchablePath cannot guard it' }
  }
  const iterator = normalized(String(rec(api.dependsOn)?.iterator ?? ''))
  if (!iterator.startsWith(CANONICAL)) {
    return { ok: false, why: 'its iterator does not begin with portal.fetchableDefs exactly as _fetchable.tpl renders it' }
  }
  const rest = iterator.slice(CANONICAL.length)
  if (/\bdef\s+fetchable/.test(rest)) {
    return { ok: false, why: 'its iterator redefines the fetchable guard after portal.fetchableDefs' }
  }
  if (CONSTRUCTED.test(rest)) {
    return { ok: false, why: 'its iterator builds characters after portal.fetchableDefs' }
  }
  if (!new RegExp(`\\(\\s*\\.${escapeRegExp(field[1])}\\s*\\|\\s*fetchablePath\\s*\\)`).test(rest)) {
    return { ok: false, why: `its iterator never applies fetchablePath to .${field[1]}` }
  }
  return { ok: true, why: '' }
}

const stepFields = (api: Rec): Record<string, unknown> => {
  const uaf = rec(api.userAccessFilter) ?? {}
  return {
    path: api.path,
    iterator: rec(api.dependsOn)?.iterator,
    'userAccessFilter.resource': uaf.resource,
    'userAccessFilter.resourcesFrom': uaf.resourcesFrom,
  }
}

/** Why `api` may read Secrets; empty when it may not (check_step). */
export const checkStep = (api: Rec): string[] => {
  let hits = Object.entries(stepFields(api)).filter(([, v]) => namesSecrets(v)).map(([k]) => `"secret" in ${k}`)
  const why = climbs(api)
  if (why) {
    hits.push(why)
  }
  if (hits.length === 0 && dataDriven(api)) {
    const guard = guarded(api)
    if (!guard.ok) {
      hits = [`data-driven path ${String(api.path)} — ${guard.why}`]
    }
  }
  return hits
}

/** Every reason this RESTAction may read Secrets, one line per api step, prefixed with `where`. */
export const secretsProblems = (ra: Rec, where: string): string[] => {
  const apis = rec(ra.spec)?.api
  return (Array.isArray(apis) ? apis : []).flatMap((raw, k) => {
    const api = rec(raw) ?? {}
    const hits = checkStep(api)
    return hits.length > 0 ? [`${where}: spec.api[${k}] (${str(api.name) ?? '?'}) may read Secrets: ${hits.join(', ')}`] : []
  })
}

/** The secrets rule over a draft set's RESTActions. */
export const draftSecretsProblems = (drafts: readonly Rec[]): string[] =>
  drafts.flatMap((cr, index) => (isRestAction(cr) ? secretsProblems(cr, labelOf(cr, index)) : []))
