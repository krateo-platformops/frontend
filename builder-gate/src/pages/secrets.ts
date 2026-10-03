/**
 * No RESTAction a page binds may read Secrets — the rule of krateo-platformops/portal
 * scripts/lint-ra-secrets.py (main f669cdec), ported line for line so a draft is refused for exactly
 * what the portal's own charts are refused for.
 *
 * WHY (from that lint): snowplow serves an api step's GET or LIST of core/v1 secrets from a
 * dynamic informer it registers CLUSTER-WIDE on first touch, holding every Secret's data, and the
 * response can land in an identity-free cache. A step that names Secrets pulls every Secret into
 * snowplow, and its output would reach the agent's context.
 *
 * WHAT IT REFUSES, per api step:
 *   - "secret" in the path, dependsOn.iterator, userAccessFilter.resource or .resourcesFrom —
 *     after percent-decoding (three rounds), lower-casing and dropping every non-letter, so
 *     "%73ecrets", "SECRETS" and "sec" + "rets" all read as one word;
 *   - a DATA-DRIVEN path: a `${ }` path to the API server (no endpointRef) whose resource is not
 *     fixed by a literal — unless its iterator restricts what it may read with the portal's
 *     fetchablePath allowlist (helm/portal/templates/_fetchable.tpl, portal.fetchableDefs). A `${}`
 *     path is unknown, and unknown is refused.
 *
 * STRICTER THAN THE PORTAL LINT at f669cdec, where it can be bypassed (review of #446; the portal
 * lint is being fixed separately, and the corpus marks each such case `portalGap`):
 *   - the iterator's defs must be EXACTLY portal.fetchableDefs (fetchableDefs.json, pinned to the
 *     portal commit and diffed against it in CI), not merely text that mentions fetchablePath — a
 *     self-defined `def fetchablePath: .;` allows everything — and nothing may redefine them;
 *   - a path containing ".." (also as %2e, in any case, after percent-decoding) is refused: after
 *     a literal "/apis/" prefix it climbs back into the core group;
 *   - a non-string field value (an object or array) is checked as its JSON text.
 * An endpointRef step calls another service, not the API server, so only the word check applies.
 */
import yaml from 'js-yaml'

import { isRestAction, labelOf, rec, type Rec, str } from './drafts'
import canonical from './fetchableDefs.json'

/** Whitespace-insensitive text, for comparing jq defs. */
const normalized = (text: string): string => text.replace(/\s+/g, ' ').trim()
const CANONICAL_DEFS = normalized(canonical.defs)

/** urllib.parse.unquote, three rounds: decode %XX runs as UTF-8, leave anything else as it is. */
const percentDecoded = (value: string): string => {
  let text = value
  for (let round = 0; round < 3; round += 1) {
    text = text.replace(/(?:%[0-9a-fA-F]{2})+/g, (run) => Buffer.from(run.replace(/%/g, ''), 'hex').toString('utf8'))
  }
  return text
}

/**
 * Whether `value` spells "secret", however it is encoded, cased or cut into pieces (names_secrets).
 * A non-string value is read as its JSON text, so `resourcesFrom: {r: "secrets"}` is seen too.
 */
export const namesSecrets = (value: unknown): boolean => {
  const text = typeof value === 'string' ? value : value == null ? '' : JSON.stringify(value)
  return percentDecoded(text).toLowerCase().replace(/[^a-z]/g, '').includes('secret')
}

/** Whether a path climbs with "..", however it is encoded ("%2e", "%2E", double-encoded). */
export const climbs = (value: unknown): boolean =>
  percentDecoded(typeof value === 'string' ? value : value == null ? '' : JSON.stringify(value)).includes('..')

/** The string literals inside a jq expression ("…" with escapes), as LITERAL.findall. */
const literalsOf = (text: string): string[] => [...text.matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((m) => m[1])

const CORE_RESOURCE_LITERAL = /^\/[a-z][a-z0-9]*(\/|$)/
const CORE_FIXED_IN_FIRST = /^\/api\/[^/]+\/(namespaces\/[^/]+\/[a-z]+|(?!namespaces)[a-z]+)/

/** A `${ }` path to the API server whose resource is not fixed by a literal (data_driven). */
export const dataDriven = (api: Rec): boolean => {
  const path = (str(api.path) ?? '').trim()
  if (api.endpointRef || !path.startsWith('${')) {
    return false
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
    return !(CORE_FIXED_IN_FIRST.test(literals[0]) || literals.slice(1).some((l) => CORE_RESOURCE_LITERAL.test(l)))
  }
  return true
}

/**
 * The iterator applies portal.fetchableDefs — EXACTLY the portal's defs, not a look-alike — and
 * nothing in it redefines them (guarded, made strict).
 */
export const guarded = (api: Rec): { ok: boolean; why: string } => {
  const iterator = normalized(str(rec(api.dependsOn)?.iterator) ?? '')
  const at = iterator.indexOf(CANONICAL_DEFS)
  if (at === -1) {
    return {
      ok: false,
      why: /def fetchablePath/.test(iterator)
        ? 'its iterator defines its own fetchablePath — only portal.fetchableDefs, verbatim, restricts what it may read'
        : 'no fetchablePath allowlist in its iterator',
    }
  }
  const rest = iterator.slice(0, at) + iterator.slice(at + CANONICAL_DEFS.length)
  if (/def\s+fetchable(Core|Path)\b/.test(rest)) {
    return { ok: false, why: 'its iterator redefines fetchableCore or fetchablePath after portal.fetchableDefs' }
  }
  if (!/\bfetchablePath\b/.test(rest)) {
    return { ok: false, why: 'its iterator carries portal.fetchableDefs but never applies fetchablePath' }
  }
  // The canonical list names no secret; kept so a future pin that did would still be caught.
  const core = /def fetchableCore:\s*(\[[^\]]*\])/.exec(CANONICAL_DEFS)
  const list = core ? yaml.load(core[1]) : []
  const bad = (Array.isArray(list) ? list : []).filter((c) => namesSecrets(c))
  return bad.length > 0 ? { ok: false, why: `fetchableCore names ${JSON.stringify(bad)}` } : { ok: true, why: '' }
}

const stepFields = (api: Rec): Record<string, unknown> => {
  const uaf = rec(api.userAccessFilter) ?? {}
  return {
    path: api.path,
    'dependsOn.iterator': rec(api.dependsOn)?.iterator,
    'userAccessFilter.resource': uaf.resource,
    'userAccessFilter.resourcesFrom': uaf.resourcesFrom,
  }
}

/** Every reason this RESTAction may read Secrets, one line per api step, prefixed with `where`. */
export const secretsProblems = (ra: Rec, where: string): string[] => {
  const problems: string[] = []
  const apis = rec(ra.spec)?.api
  for (const [k, raw] of (Array.isArray(apis) ? apis : []).entries()) {
    const api = rec(raw) ?? {}
    let hits = Object.entries(stepFields(api)).filter(([, v]) => namesSecrets(v)).map(([f]) => `"secret" in ${f}`)
    if (climbs(api.path)) {
      hits.push('".." in path (it can climb out of the group its literal prefix names)')
    }
    if (hits.length === 0 && dataDriven(api)) {
      const guard = guarded(api)
      if (!guard.ok) {
        hits = [`data-driven path ${String(api.path)} — ${guard.why} (portal.fetchableDefs, helm/portal/templates/_fetchable.tpl)`]
      }
    }
    if (hits.length > 0) {
      problems.push(`${where}: spec.api[${k}] (${str(api.name) ?? '?'}) may read Secrets: ${hits.join(', ')}`)
    }
  }
  return problems
}

/** The secrets rule over a draft set's RESTActions. */
export const draftSecretsProblems = (drafts: readonly Rec[]): string[] =>
  drafts.flatMap((cr, index) => (isRestAction(cr) ? secretsProblems(cr, labelOf(cr, index)) : []))
