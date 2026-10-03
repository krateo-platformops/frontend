/**
 * Step 2, references (#442 D3): every child the page ROOT lists in spec.resourcesRefs.items[], and
 * every widget's spec.apiRef, resolves — to an object in this draft, or to one that already
 * exists in the cluster (read-only get, as the gate's ServiceAccount).
 *
 * "In this draft" is matched the way the portal's preview re-points refs (previewSandbox.ts
 * rewriteDraftsForSandbox): a ref item by `<resource>/<name>`, an apiRef by RESTAction name. A ref
 * that matches nothing in the set is left pointing where it points, so it must exist there.
 */
import { isPageRoot, WIDGETS_GROUP } from '@frontend/components/Autopilot/pageLint'

import { step, type StepResult } from '../envelope'
import { apiBase, safeSegment } from '../kube'
import type { GateContext } from '../plan'
import { isRestAction, kindOf, labelOf, nameOf, pluralOfDraft, rec, type Rec, str } from './drafts'

type Lookup = { found: true } | { found: false; problem: string }

const lookup = async (ctx: GateContext, apiVersion: string, resource: string, namespace: string, name: string): Promise<Lookup> => {
  if (!ctx.live) {
    return { found: false, problem: 'notChecked: not in the draft, and an offline run cannot look in the cluster' }
  }
  if (!ctx.kube) {
    return { found: false, problem: 'notChecked: not in the draft, and the gate has no API server identity to look in the cluster with' }
  }
  let path: string
  try {
    path = `${apiBase(apiVersion)}/namespaces/${safeSegment(namespace)}/${safeSegment(resource)}/${safeSegment(name)}`
  } catch (error) {
    return { found: false, problem: (error as Error).message }
  }
  try {
    const reply = await ctx.kube.get(path, Math.max(1_000, Math.min(10_000, ctx.deadline - Date.now())))
    if (reply.status === 200) {
      return { found: true }
    }
    if (reply.status === 404) {
      return { found: false, problem: `${resource}/${name} is in neither the draft nor namespace ${namespace}` }
    }
    return { found: false, problem: `notChecked: looking up ${namespace}/${resource}/${name} answered ${reply.status}` }
  } catch (error) {
    return { found: false, problem: `notChecked: looking up ${namespace}/${resource}/${name} failed (${(error as Error).message})` }
  }
}

export const referencesStep = async (drafts: readonly Rec[], ctx: GateContext): Promise<StepResult> => {
  const problems: string[] = []
  const notes: string[] = []
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

  for (const [index, cr] of drafts.entries()) {
    const label = labelOf(cr, index)
    const spec = rec(cr.spec)

    if (isPageRoot(kindOf(cr), nameOf(cr) ?? '')) {
      const items = rec(spec?.resourcesRefs)?.items
      for (const [j, raw] of (Array.isArray(items) ? items : []).entries()) {
        const where = `${label}: spec.resourcesRefs.items[${j}]`
        const item = rec(raw) ?? {}
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
          problems.push(`${where}: ${resource}/${name} is not in the draft, and a page root's children are widgets (${WIDGETS_GROUP}), not ${apiVersion}`)
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
    }

    const apiRef = rec(spec?.apiRef)
    if (apiRef && !isRestAction(cr)) {
      const name = str(apiRef.name)
      if (!name) {
        problems.push(`${label}: spec.apiRef names no RESTAction`)
      } else if (!restActionNames.has(name)) {
        const namespace = str(apiRef.namespace)
        if (!namespace) {
          problems.push(`${label}: spec.apiRef ${name} is not a RESTAction in the draft, so it must name the namespace it exists in`)
        } else {
          // eslint-disable-next-line no-await-in-loop -- as above
          const found = await lookup(ctx, 'templates.krateo.io/v1', 'restactions', namespace, name)
          if (found.found) {
            existing += 1
          } else {
            problems.push(`${label}: spec.apiRef: ${found.problem}`)
          }
        }
      }
    }
  }

  notes.push(existing > 0
    ? `${existing} reference(s) resolve to objects that already exist in the cluster; the rest are in the draft`
    : 'every reference resolves inside the draft')

  return step('references', problems, notes)
}
