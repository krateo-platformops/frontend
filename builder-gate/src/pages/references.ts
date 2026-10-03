/**
 * Step 2, references (#442 D3): every reference a widget in the draft makes resolves —
 *   - every widget's spec.resourcesRefs.items[] (not only the root's: a nested child that points
 *     nowhere breaks the page just the same);
 *   - every LITERAL spec.resourcesRefsTemplate[].template (one whose resource and name carry no
 *     `${ }` — a templated one is filled from data at render time and cannot be judged here);
 *   - every widget's spec.apiRef.
 * Each resolves to an object in the draft, or to one that already exists, read RAW (stored, not
 * resolved) through snowplow AS THE CALLER — the gate has no RBAC of its own for it, and a
 * resolving read would run a RESTAction just to learn it exists. Until snowplow offers the raw read
 * (docs/snowplow-contract.md), an out-of-draft reference is "live verdict missing", and red. A RESTAction that already
 * exists is held to the secrets rule too: a page may not bind one that reads Secrets.
 *
 * "In the draft" is matched the way the portal's preview re-points refs (previewSandbox.ts
 * rewriteDraftsForSandbox): a ref by `<resource>/<name>`, an apiRef by RESTAction name.
 */
import { WIDGETS_GROUP } from '@frontend/components/Autopilot/pageLint'

import { step, type StepResult } from '../envelope'
import type { GateContext } from '../plan'
import { CAPABILITY_RAW_READ } from '../snowplow'
import { isRestAction, labelOf, maybeQuery, nameOf, pluralOfDraft, rec, type Rec, str } from './drafts'
import { secretsProblems } from './secrets'

type Lookup = { found: true; object: unknown } | { found: false; problem: string }

const LOOKUP_MS = 10_000

const lookup = async (ctx: GateContext, apiVersion: string, resource: string, namespace: string, name: string): Promise<Lookup> => {
  const what = `${namespace}/${resource}/${name}`
  if (!ctx.live) {
    return { found: false, problem: 'notChecked: not in the draft, and an offline run cannot look in the cluster' }
  }
  if (!ctx.snowplow) {
    return { found: false, problem: `notChecked: not in the draft, and ${ctx.snowplowMissing ?? 'snowplow is not reachable'} — the gate looks in the cluster only as the caller` }
  }
  const capabilities = await ctx.snowplow.capabilities(LOOKUP_MS)
  if (!capabilities.ok) {
    return { found: false, problem: `notChecked: ${capabilities.reason}` }
  }
  if (!capabilities.offered.has(CAPABILITY_RAW_READ)) {
    return { found: false, problem: `live verdict missing: not in the draft, and this snowplow cannot yet read an object without resolving it (${CAPABILITY_RAW_READ}, docs/snowplow-contract.md)` }
  }
  try {
    const reply = await ctx.snowplow.read(apiVersion, resource, namespace, name, Math.max(1_000, Math.min(LOOKUP_MS, ctx.deadline - Date.now())))
    if (reply.status === 200) {
      return { found: true, object: reply.json }
    }
    if (reply.status === 404) {
      return { found: false, problem: `${resource}/${name} is in neither the draft nor namespace ${namespace}` }
    }
    if (reply.status === 403) {
      return { found: false, problem: `you cannot read ${what} — the page would not render it for you either` }
    }
    return { found: false, problem: `notChecked: reading ${what} through snowplow answered ${reply.status}` }
  } catch (error) {
    return { found: false, problem: `notChecked: reading ${what} through snowplow failed (${(error as Error).message})` }
  }
}

interface Ref {
  where: string
  item: Rec
}

/** Every ref a widget makes: its items, and its literal per-item templates. */
const refsOf = (cr: Rec, label: string): { refs: Ref[]; templated: number } => {
  const spec = rec(cr.spec)
  const refs: Ref[] = []
  let templated = 0
  const items = rec(spec?.resourcesRefs)?.items
  for (const [j, raw] of (Array.isArray(items) ? items : []).entries()) {
    refs.push({ where: `${label}: spec.resourcesRefs.items[${j}]`, item: rec(raw) ?? {} })
  }
  const templates = spec?.resourcesRefsTemplate
  for (const [j, raw] of (Array.isArray(templates) ? templates : []).entries()) {
    const template = rec(rec(raw)?.template) ?? {}
    if ([template.resource, template.name, template.namespace, template.apiVersion].some((v) => typeof v === 'string' && (maybeQuery(v).ok || v.includes('${')))) {
      templated += 1
      continue
    }
    refs.push({ where: `${label}: spec.resourcesRefsTemplate[${j}].template`, item: template })
  }
  return { refs, templated }
}

export const referencesStep = async (drafts: readonly Rec[], ctx: GateContext): Promise<StepResult> => {
  const problems: string[] = []
  const draftKeys = new Set<string>()
  const restActionNames = new Set<string>()
  for (const cr of drafts) {
    const plural = pluralOfDraft(cr)
    const name = nameOf(cr)
    if (plural && name) {
      draftKeys.add(`${plural}/${name}`)
      if (isRestAction(cr)) {
        restActionNames.add(name)
      }
    }
  }
  let existing = 0
  let checked = 0
  let templatedSkipped = 0

  for (const [index, cr] of drafts.entries()) {
    if (isRestAction(cr)) {
      continue
    }
    const label = labelOf(cr, index)
    const { refs, templated } = refsOf(cr, label)
    templatedSkipped += templated
    for (const { where, item } of refs) {
      checked += 1
      const resource = str(item.resource)
      const name = str(item.name)
      if (!resource || !name) {
        problems.push(`${where}: names no resource and name`)
        continue
      }
      if (draftKeys.has(`${resource}/${name}`)) {
        continue
      }
      const apiVersion = str(item.apiVersion) ?? `${WIDGETS_GROUP}/v1beta1`
      if (!apiVersion.startsWith(`${WIDGETS_GROUP}/`)) {
        problems.push(`${where}: ${resource}/${name} is not in the draft, and a widget's children are widgets (${WIDGETS_GROUP}), not ${apiVersion}`)
        continue
      }
      const namespace = str(item.namespace)
      if (!namespace) {
        problems.push(`${where}: ${resource}/${name} is not in the draft, so it must name the namespace it exists in`)
        continue
      }
      // eslint-disable-next-line no-await-in-loop -- a handful of reads, in order, attributed one by one
      const found = await lookup(ctx, apiVersion, resource, namespace, name)
      if (found.found) {
        existing += 1
      } else {
        problems.push(`${where}: ${found.problem}`)
      }
    }

    const apiRef = rec(rec(cr.spec)?.apiRef)
    if (!apiRef) {
      continue
    }
    checked += 1
    const name = str(apiRef.name)
    if (!name) {
      problems.push(`${label}: spec.apiRef names no RESTAction`)
      continue
    }
    if (restActionNames.has(name)) {
      continue
    }
    const namespace = str(apiRef.namespace)
    if (!namespace) {
      problems.push(`${label}: spec.apiRef ${name} is not a RESTAction in the draft, so it must name the namespace it exists in`)
      continue
    }
    // eslint-disable-next-line no-await-in-loop -- as above
    const found = await lookup(ctx, 'templates.krateo.io/v1', 'restactions', namespace, name)
    if (!found.found) {
      problems.push(`${label}: spec.apiRef: ${found.problem}`)
      continue
    }
    existing += 1
    // The RESTAction the page would bind: the secrets rule holds for it as for a draft one.
    problems.push(...secretsProblems(rec(found.object) ?? {}, `${label}: spec.apiRef ${namespace}/${name}`))
  }

  const notes = [`${checked} reference(s) checked across every widget; ${existing} resolve to objects that already exist (read raw through snowplow as the caller), the rest are in the draft`]
  if (templatedSkipped > 0) {
    notes.push(`${templatedSkipped} templated resourcesRefsTemplate entr${templatedSkipped === 1 ? 'y is' : 'ies are'} filled from data at render time and not judged here`)
  }
  return step('references', problems, notes)
}
