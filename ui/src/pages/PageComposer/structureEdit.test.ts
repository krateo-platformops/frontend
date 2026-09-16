/**
 * The invariant under test throughout: a child is TWO entries — the ordered reference in
 * widgetData.items and the resourcesRefs entry that resolves it — and every operation keeps them
 * consistent. Writing one without the other is how you get a page that renders an empty slot or a
 * dangling ref, and it is the failure these functions exist to make unrepresentable.
 */
import { load } from 'js-yaml'
import { describe, expect, it } from 'vitest'

import { containerPath, moveChild, newContainerYaml, placeChild, removeChild } from './structureEdit'

const parent = (children: string[] = []) => [
  'kind: Flex',
  'apiVersion: widgets.templates.krateo.io/v1beta1',
  'metadata:',
  '  name: page-x',
  'spec:',
  '  widgetData:',
  children.length
    ? `    items:\n${children.map((name) => `      - resourceRefId: ${name}`).join('\n')}`
    : '    items: []',
  '  resourcesRefs:',
  children.length
    ? `    items:\n${children.map((name) => `      - id: ${name}\n        name: ${name}\n        resource: tables`).join('\n')}`
    : '    items: []',
].join('\n')

const read = (yaml: string) => {
  const doc = load(yaml) as {
    spec: { widgetData: { items: { resourceRefId: string }[] }; resourcesRefs: { items: { id: string }[] } }
  }
  return {
    ids: doc.spec.widgetData.items.map((item) => item.resourceRefId),
    refs: doc.spec.resourcesRefs.items.map((ref) => ref.id),
  }
}

const ok = (result: ReturnType<typeof placeChild>) => {
  if (!result.ok) {
    throw new Error(`expected success, got: ${result.error}`)
  }
  return result.content
}

describe('placeChild', () => {
  it('writes BOTH the reference and the entry that resolves it', () => {
    const out = read(ok(placeChild(parent(), { name: 'fleet-table', resource: 'tables' })))

    expect(out.ids).toEqual(['fleet-table'])
    expect(out.refs).toEqual(['fleet-table'])
  })

  it('appends, so the author’s order is preserved', () => {
    const out = read(ok(placeChild(parent(['first']), { name: 'second', resource: 'cards' })))

    expect(out.ids).toEqual(['first', 'second'])
  })

  it('allows the same widget twice but never duplicates its ref entry', () => {
    // A divider between two sections is a real case. A repeated resourcesRefs id is malformed
    // regardless, so the reference may repeat and the entry may not.
    const once = ok(placeChild(parent(), { name: 'divider', resource: 'dividers' }))
    const out = read(ok(placeChild(once, { name: 'divider', resource: 'dividers' })))

    expect(out.ids).toEqual(['divider', 'divider'])
    expect(out.refs).toEqual(['divider'])
  })

  it('creates the slots when the container has none', () => {
    const bare = 'kind: Flex\napiVersion: widgets.templates.krateo.io/v1beta1\nmetadata:\n  name: page-x\n'
    const out = read(ok(placeChild(bare, { name: 'x', resource: 'tables' })))

    expect(out.ids).toEqual(['x'])
    expect(out.refs).toEqual(['x'])
  })

  it('defaults the widgets apiVersion rather than leaving it unset', () => {
    const content = ok(placeChild(parent(), { name: 'x', resource: 'tables' }))

    expect(content).toContain('widgets.templates.krateo.io/v1beta1')
  })

  it('refuses a parent that does not parse instead of writing something worse', () => {
    const result = placeChild('kind: Flex\n  bad: [', { name: 'x', resource: 'tables' })

    expect(result.ok).toBe(false)
  })
})

describe('removeChild', () => {
  it('removes the reference and its entry together', () => {
    const out = read(ok(removeChild(parent(['a', 'b']), 'a')))

    expect(out.ids).toEqual(['b'])
    expect(out.refs).toEqual(['b'])
  })

  it('keeps the ref entry while ANY placement survives', () => {
    // The bug this prevents: remove one of two placements, the entry goes, and the surviving
    // placement renders an empty slot because nothing resolves its id any more.
    const twice = ok(placeChild(parent(['divider']), { name: 'divider', resource: 'dividers' }))
    const out = read(ok(removeChild(twice, 'divider')))

    expect(out.ids).toEqual([])
    expect(out.refs).toEqual([])
  })

  it('refuses to remove something that is not placed', () => {
    const result = removeChild(parent(['a']), 'nope')

    expect(result.ok).toBe(false)
  })
})

describe('moveChild', () => {
  it('moves up, because items order IS the rendered order', () => {
    const out = read(ok(moveChild(parent(['a', 'b', 'c']), 'b', 'up')))

    expect(out.ids).toEqual(['b', 'a', 'c'])
  })

  it('moves down', () => {
    const out = read(ok(moveChild(parent(['a', 'b', 'c']), 'b', 'down')))

    expect(out.ids).toEqual(['a', 'c', 'b'])
  })

  it('refuses at the ends rather than silently doing nothing', () => {
    // Refusing lets the caller disable the control instead of offering a no-op that looks broken.
    expect(moveChild(parent(['a', 'b']), 'a', 'up').ok).toBe(false)
    expect(moveChild(parent(['a', 'b']), 'b', 'down').ok).toBe(false)
  })

  it('leaves the ref entries alone — only order changes', () => {
    const out = read(ok(moveChild(parent(['a', 'b']), 'b', 'up')))

    expect(out.refs.sort()).toEqual(['a', 'b'])
  })

  it('refuses a child that is not placed', () => {
    expect(moveChild(parent(['a']), 'ghost', 'up').ok).toBe(false)
  })
})

describe('newContainerYaml / containerPath', () => {
  it('produces a container that parses and is empty', () => {
    const doc = load(newContainerYaml('Row', 'fleet-top')) as {
      kind: string
      spec: { widgetData: { items: unknown[] }; resourcesRefs: { items: unknown[] } }
    }

    expect(doc.kind).toBe('Row')
    expect(doc.spec.widgetData.items).toEqual([])
    expect(doc.spec.resourcesRefs.items).toEqual([])
  })

  it('omits allowedResources rather than writing an empty one', () => {
    // An empty allowedResources is a REAL value meaning "nothing may be placed here" — it would
    // make the container refuse every child it is about to be given. Absent means unconstrained.
    expect(newContainerYaml('Flex', 'x')).not.toContain('allowedResources')
  })

  it('does not guess layout properties the author has not chosen', () => {
    const yaml = newContainerYaml('Row', 'x')

    // gap/justify/vertical written now would look chosen when they were defaulted.
    for (const guessed of ['gap:', 'justify:', 'vertical:']) {
      expect(yaml).not.toContain(guessed)
    }
  })

  it('names the file the way the chart does', () => {
    expect(containerPath('Row', 'fleet-top', 'helm/portal/templates'))
      .toBe('helm/portal/templates/row.fleet-top.yaml')
  })

  it('tolerates a directory given with a trailing slash', () => {
    expect(containerPath('Card', 'x', 'helm/portal/templates/'))
      .toBe('helm/portal/templates/card.x.yaml')
  })

  it('round-trips: a new container accepts a placed child', () => {
    const container = newContainerYaml('Row', 'top')
    const placed = placeChild(container, { name: 'stat', resource: 'statistics' })

    expect(placed.ok).toBe(true)
  })
})
