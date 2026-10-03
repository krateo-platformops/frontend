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
 *     fetchablePath allowlist (helm/portal/templates/_fetchable.tpl, portal.fetchableDefs), whose
 *     fetchableCore names no secret. A `${}` path is unknown, and unknown is refused.
 * An endpointRef step calls another service, not the API server, so only the word check applies.
 */
import yaml from 'js-yaml'

import { isRestAction, labelOf, rec, type Rec, str } from './drafts'

/** Whether `text` spells "secret", however it is encoded, cased or cut into pieces (names_secrets). */
export const namesSecrets = (value: unknown): boolean => {
  let text = typeof value === 'string' ? value : value == null ? '' : String(value)
  for (let round = 0; round < 3; round += 1) {
    // urllib.parse.unquote: decode %XX runs as UTF-8, leave anything else as it is.
    text = text.replace(/(?:%[0-9a-fA-F]{2})+/g, (run) => Buffer.from(run.replace(/%/g, ''), 'hex').toString('utf8'))
  }
  return text.toLowerCase().replace(/[^a-z]/g, '').includes('secret')
}

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

/** The iterator applies portal.fetchableDefs, and its allowlist names no secret (guarded). */
export const guarded = (api: Rec): { ok: boolean; why: string } => {
  const iterator = str(rec(api.dependsOn)?.iterator) ?? ''
  const core = /def fetchableCore:\s*(\[[^\]]*\])/.exec(iterator)
  if (!core || !iterator.includes('def fetchablePath') || iterator.split('fetchablePath').length - 1 < 2) {
    return { ok: false, why: 'no fetchablePath allowlist in its iterator' }
  }
  let list: unknown
  try {
    list = yaml.load(core[1]) // yaml.safe_load, as the portal lint reads it
  } catch {
    return { ok: false, why: 'fetchableCore is not an array literal' }
  }
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
