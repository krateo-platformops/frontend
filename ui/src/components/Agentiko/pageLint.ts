/**
 * The page-draft lint, PURE: the same verdicts the portal's live preview gives a page draft set,
 * with nothing the browser owns.
 *
 * WHY IT IS ITS OWN MODULE (builder gate, #442 D2). The builder gate is a Node service that must
 * judge an agent's page draft exactly the way the portal will, and it can only promise that by
 * importing this lint rather than copying it. So the two things that are browser-bound in the
 * preview are INJECTED instead of reached for:
 *   - `schemaFor(kind)`: the co-located widget schema (the portal reads it through Vite's
 *     `import.meta.glob`; a Node caller reads `src/widgets/<Kind>/<Kind>.schema.json` from disk);
 *   - `pluralOf(kind)`: the widget kind's resource plural (the portal asks snowplow's discovery
 *     resolver with the person's token; a Node caller asks the API server).
 * Everything else, ajv included, runs anywhere: no `import.meta`, no `fetch`, no `window`, no token.
 *
 * previewSandbox.ts keeps the glob and the kind resolver and calls this, so the portal's problem
 * lines are the same strings, in the same order, as before the move.
 */

import Ajv, { type ValidateFunction } from 'ajv'

/** The widget-CR coordinates every draft is normalized to (the live CRD group/version). */
export const WIDGETS_GROUP = 'widgets.templates.krateo.io'
export const WIDGETS_VERSION = 'v1beta1'
export const WIDGETS_API_VERSION = `${WIDGETS_GROUP}/${WIDGETS_VERSION}`

/** RESTAction drafts (a page's data source) ride in the same preview set. */
export const RESTACTION_KIND = 'RESTAction'
export const RESTACTION_GROUP = 'templates.krateo.io'
export const RESTACTION_VERSION = 'v1'
export const RESTACTION_API_VERSION = `${RESTACTION_GROUP}/${RESTACTION_VERSION}`
export const RESTACTIONS_PLURAL = 'restactions'

/** DNS-1123 name (same class applyResourceSet's path-segment guard enforces). */
const DNS1123 = /^[a-z0-9]([-a-z0-9.]*[a-z0-9])?$/

const asRecord = (value: unknown): Record<string, unknown> | null =>
  (value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null)

const isNonEmptyString = (value: unknown): value is string => typeof value === 'string' && value.length > 0

/** What the lint needs from its host: a widget kind's schema and its resource plural. */
export interface PageLintDeps {
  /** The co-located schema for a widget kind, or null/undefined when there is none. May be async. */
  schemaFor: (kind: string) => Record<string, unknown> | null | undefined | Promise<Record<string, unknown> | null | undefined>
  /** The resource plural of a widget kind, or null when the kind is not served. Never asked about RESTAction. */
  pluralOf: (kind: string) => string | null | undefined
  /** An ajv to compile with. Omitted: one shared instance, created on first use. */
  ajv?: Ajv
}

/** The apiVersion a draft of this kind MUST carry (normalized in the rewrite). */
export const expectedApiVersionOf = (kind: string): string =>
  (kind === RESTACTION_KIND ? RESTACTION_API_VERSION : WIDGETS_API_VERSION)

const draftName = (cr: Record<string, unknown>): string | null => {
  const name = asRecord(cr.metadata)?.name

  return isNonEmptyString(name) ? name : null
}

/** "widgets[2] (Flex/page-root)" — the identity prefix of every validation line. */
const draftLabel = (cr: Record<string, unknown>, index: number): string => {
  const kind = isNonEmptyString(cr.kind) ? cr.kind : '?'

  return `widgets[${index}] (${kind}/${draftName(cr) ?? '?'})`
}

/** The resource a draft's kind maps to: RESTAction's fixed plural, a widget kind's plural, or null (unknown). */
const resourceOf = (kind: string, deps: PageLintDeps): string | null => {
  if (kind === RESTACTION_KIND) {
    return RESTACTIONS_PLURAL
  }

  return kind ? deps.pluralOf(kind) || null : null
}

// One ajv for all kinds unless the caller brings its own. strict:false — the authored schemas carry
// doc-oriented keywords/defaults ajv's strict mode flags; validation semantics are unaffected.
let sharedAjv: Ajv | null = null
// Compiled once per schema OBJECT, so a host that hands back the same schema each time (the portal's
// glob does) compiles it once, and a host that reads fresh copies never sees another host's verdicts.
const validators = new WeakMap<Ajv, WeakMap<object, ValidateFunction>>()

const validatorFor = (schema: Record<string, unknown>, deps: PageLintDeps): ValidateFunction => {
  const ajv = deps.ajv ?? (sharedAjv = sharedAjv ?? new Ajv({ allErrors: true, strict: false }))
  let bySchema = validators.get(ajv)
  if (!bySchema) {
    bySchema = new WeakMap()
    validators.set(ajv, bySchema)
  }
  const cached = bySchema.get(schema)
  if (cached) {
    return cached
  }
  const validate = ajv.compile(schema)
  bySchema.set(schema, validate)

  return validate
}

/**
 * Lint ONE draft CR. The co-located schema validates the `{version, kind, spec}` envelope (the
 * shape the CRDs are generated from — metadata/apiVersion are the apiserver's, not the schema's),
 * so the draft is projected onto it. RESTActions have no frontend schema (spec §7.8, honest gap) →
 * structural checks only; the strict CRD at admission and snowplow's own execution are their real
 * gates.
 */
const lintDraft = async (cr: Record<string, unknown>, index: number, deps: PageLintDeps): Promise<string[]> => {
  const at = draftLabel(cr, index)
  const errors: string[] = []
  const kind = isNonEmptyString(cr.kind) ? cr.kind : ''
  if (!resourceOf(kind, deps)) {
    return [`${at}: unknown kind — not a registered widget kind or ${RESTACTION_KIND}`]
  }
  const name = draftName(cr)
  if (!name || !DNS1123.test(name)) {
    errors.push(`${at}: metadata.name is required and must be a DNS-1123 name`)
  }
  const expected = expectedApiVersionOf(kind)
  if (cr.apiVersion !== undefined && cr.apiVersion !== expected) {
    errors.push(`${at}: apiVersion must be ${expected}`)
  }
  const spec = asRecord(cr.spec)
  if (!spec) {
    errors.push(`${at}: spec is required`)

    return errors
  }
  if (kind === RESTACTION_KIND) {
    return errors
  }
  const schema = await deps.schemaFor(kind)
  if (!schema) {
    // A served kind with no co-located schema would be a build-time drift bug (validate-schemas
    // guards it); fail CLOSED — never apply unvalidated.
    errors.push(`${at}: no co-located schema found for kind ${kind} — draft not validated, refusing to apply`)

    return errors
  }
  const validate = validatorFor(schema, deps)
  if (!validate({ kind, spec, version: WIDGETS_VERSION })) {
    for (const error of validate.errors ?? []) {
      errors.push(`${at}: ${error.instancePath || '(root)'} ${error.message ?? 'invalid'}`)
    }
  }

  return errors
}

/**
 * Lint the WHOLE draft set (A.2.1: any failure → the v1 source drawer with verdicts; garbage is
 * never applied). Returns problem lines — EMPTY means every draft is applyable. Also rejects
 * duplicate (kind, name) pairs (the second POST would 409 mid-set) — all-or-nothing, like the set
 * kernel.
 *
 * Every widget kind in `drafts` must already be answerable by `deps.pluralOf`: this is synchronous
 * on purpose, so the host resolves its kinds first (the portal primes its resolver).
 */
export const lintPageDrafts = async (
  drafts: readonly Record<string, unknown>[],
  deps: PageLintDeps,
): Promise<string[]> => {
  const problems: string[] = []
  const seen = new Set<string>()
  for (const [index, cr] of drafts.entries()) {
    // eslint-disable-next-line no-await-in-loop -- drafts lint in order; a host's schema loads are cached after the first hit
    problems.push(...await lintDraft(cr, index, deps))
    const resource = resourceOf(isNonEmptyString(cr.kind) ? cr.kind : '', deps)
    const name = draftName(cr)
    if (resource && name) {
      const key = `${resource}/${name}`
      if (seen.has(key)) {
        problems.push(`${draftLabel(cr, index)}: duplicate draft — ${key} appears twice in the set`)
      }
      seen.add(key)
    }
  }

  return problems
}

/**
 * THE page root: a Flex whose name starts `page-`. It is the page's entry (its INIT), the identity
 * the publish gate requires, and the draft the preview mounts. Draft ORDER is never the rule.
 */
export const isPageRoot = (kind: string, name: string): boolean => kind === 'Flex' && name.startsWith('page-')

/**
 * The root rule over a draft set: null when some draft is a `page-<slug>` root Flex, otherwise the
 * problem line saying why the set has no page.
 */
export const pageRootProblem = (drafts: readonly Record<string, unknown>[]): string | null =>
  (drafts.some((cr) => isPageRoot(isNonEmptyString(cr.kind) ? cr.kind : '', draftName(cr) ?? ''))
    ? null
    : 'no page-<slug> root Flex (the page entry) in the draft set — author the root Flex named page-<slug> listing the children')
