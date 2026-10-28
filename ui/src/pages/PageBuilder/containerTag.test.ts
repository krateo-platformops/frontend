/**
 * The canvas's "… only" tag is shown only where it is true. The demo that caught it: a page started
 * in the composer, a Card dropped in, and the page Flex tagged "cards only" beside its PageHeader.
 */
import { dump } from 'js-yaml'
import { describe, expect, it } from 'vitest'

import { containerTag } from './containerTag'
import { canAccept } from './dropTargets'
import { buildObjectTree } from './objectTree'
import type { TreeNode } from './objectTree'
import { planAdd } from './planAdd'
import { startDraft } from './startDraft'

const DUMP = { lineWidth: -1, noRefs: true } as const

/** A started page, as the files the composer holds. */
const startedPage = (slug: string): Record<string, string> => {
  const result = startDraft({ namespace: 'krateo-system', slug })
  if (!result.ok) { throw new Error(result.error) }
  const [root, header] = result.widgets as { metadata: { name: string } }[]
  return {
    [`templates/flex.${root.metadata.name}.yaml`]: dump(root, DUMP),
    [`templates/pageheader.${header.metadata.name}.yaml`]: dump(header, DUMP),
  }
}

const find = (files: Record<string, string>, name: string): TreeNode => {
  const walk = (nodes: readonly TreeNode[]): TreeNode | undefined => {
    for (const node of nodes) {
      if (node.name === name) { return node }
      const hit = walk(node.children)
      if (hit) { return hit }
    }
    return undefined
  }
  const found = walk(buildObjectTree(files))
  if (!found) { throw new Error(`no node ${name}`) }
  return found
}

describe('containerTag', () => {
  it('a started page with a Card dropped in is NOT tagged "cards only" — it holds a PageHeader too', () => {
    const before = startedPage('demo-pb-21')
    const plan = planAdd(before, find(before, 'page-demo-pb-21'), { kind: 'container', layout: 'Card', resource: 'cards' }, 'krateo-system')
    if (!plan.ok) { throw new Error(plan.reason) }
    const after = { ...before, ...(plan.created ? { [plan.created.path]: plan.created.content } : {}), ...plan.files }

    const page = find(after, 'page-demo-pb-21')
    // The state the demo showed: the list the composer grew says `cards`, the page holds more.
    expect(page.allowedResources).toEqual(['cards'])
    expect(page.children.map((child) => child.kind)).toEqual(['PageHeader', 'Card'])
    // And it is not a rule: the page still takes anything.
    expect(canAccept(page, 'rows')).toBe(true)

    expect(containerTag(page)).toBeNull()
  })

  it('a container the composer created stays untagged after its first child lands', () => {
    expect(containerTag({ allowedDerived: true, allowedResources: ['tables'] })).toBeNull()
  })

  it('says nothing when the author has not said anything', () => {
    expect(containerTag({ allowedDerived: false, allowedResources: [] })).toBeNull()
    expect(containerTag({ allowedDerived: false, allowedResources: null })).toBeNull()
  })

  it('names an author\'s declaration as the drop rule it is, not as what the container holds', () => {
    expect(containerTag({ allowedDerived: false, allowedResources: ['rows'] })).toBe('accepts rows only')
    expect(containerTag({ allowedDerived: false, allowedResources: ['rows', 'cards'] })).toBe('accepts rows, cards only')
  })
})
