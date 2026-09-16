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
    const out = read(ok(placeChild(parent(), { name: 'fleet-table', namespace: 'krateo-system', resource: 'tables' })))

    expect(out.ids).toEqual(['fleet-table'])
    expect(out.refs).toEqual(['fleet-table'])
  })

  it('appends, so the author’s order is preserved', () => {
    const out = read(ok(placeChild(parent(['first']), { name: 'second', namespace: 'krateo-system', resource: 'cards' })))

    expect(out.ids).toEqual(['first', 'second'])
  })

  it('allows the same widget twice but never duplicates its ref entry', () => {
    // A divider between two sections is a real case. A repeated resourcesRefs id is malformed
    // regardless, so the reference may repeat and the entry may not.
    const once = ok(placeChild(parent(), { name: 'divider', namespace: 'krateo-system', resource: 'dividers' }))
    const out = read(ok(placeChild(once, { name: 'divider', namespace: 'krateo-system', resource: 'dividers' })))

    expect(out.ids).toEqual(['divider', 'divider'])
    expect(out.refs).toEqual(['divider'])
  })

  it('creates the slots when the container has none', () => {
    const bare = 'kind: Flex\napiVersion: widgets.templates.krateo.io/v1beta1\nmetadata:\n  name: page-x\n'
    const out = read(ok(placeChild(bare, { name: 'x', namespace: 'krateo-system', resource: 'tables' })))

    expect(out.ids).toEqual(['x'])
    expect(out.refs).toEqual(['x'])
  })

  it('defaults the widgets apiVersion rather than leaving it unset', () => {
    const content = ok(placeChild(parent(), { name: 'x', namespace: 'krateo-system', resource: 'tables' }))

    expect(content).toContain('widgets.templates.krateo.io/v1beta1')
  })

  it('refuses a parent that does not parse instead of writing something worse', () => {
    const result = placeChild('kind: Flex\n  bad: [', { name: 'x', namespace: 'krateo-system', resource: 'tables' })

    expect(result.ok).toBe(false)
  })
})

describe('placeChild — the THIRD place, allowedResources', () => {
  it("declares the child's plural, without which the container will not render it", () => {
    // The subtle failure this prevents: items and resourcesRefs are both correct, the CR applies
    // cleanly, and the child still does not appear — because the container never declared its
    // kind. A page that validates and shows nothing.
    const out = load(ok(placeChild(newContainerYaml('Row', 'top', 'krateo-system'), { name: 'fleet', namespace: 'krateo-system', resource: 'tables' }))) as {
      spec: { widgetData: { allowedResources: string[] } }
    }

    expect(out.spec.widgetData.allowedResources).toEqual(['tables'])
  })

  it('does not repeat a plural already declared', () => {
    const once = ok(placeChild(newContainerYaml('Row', 'top', 'krateo-system'), { name: 'a', namespace: 'krateo-system', resource: 'tables' }))
    const out = load(ok(placeChild(once, { name: 'b', namespace: 'krateo-system', resource: 'tables' }))) as {
      spec: { widgetData: { allowedResources: string[] } }
    }

    expect(out.spec.widgetData.allowedResources).toEqual(['tables'])
  })

  it('accumulates distinct plurals', () => {
    const first = ok(placeChild(newContainerYaml('Flex', 'p', 'krateo-system'), { name: 'a', namespace: 'krateo-system', resource: 'tables' }))
    const out = load(ok(placeChild(first, { name: 'b', namespace: 'krateo-system', resource: 'paragraphs' }))) as {
      spec: { widgetData: { allowedResources: string[] } }
    }

    expect(out.spec.widgetData.allowedResources.sort()).toEqual(['paragraphs', 'tables'])
  })
})

describe('removeChild', () => {
  it('removes the reference and its entry together', () => {
    const out = read(ok(removeChild(parent(['a', 'b']), { index: 0, refId: 'a' })))

    expect(out.ids).toEqual(['b'])
    expect(out.refs).toEqual(['b'])
  })

  it('keeps the ref entry while ANY placement survives', () => {
    // The bug this prevents: remove one of two placements, the entry goes, and the surviving
    // placement renders an empty slot because nothing resolves its id any more.
    //
    // This test asserted the OPPOSITE of its name — `ids: []`, `refs: []` — and passed, because
    // removeChild matched by id and deleted BOTH placements, which left the guard it was named
    // after unreachable. Positional removal is what makes one survive, and what makes the name true.
    const twice = ok(placeChild(parent(['divider']), { name: 'divider', namespace: 'krateo-system', resource: 'dividers' }))
    const out = read(ok(removeChild(twice, { index: 0, refId: 'divider' })))

    expect(out.ids).toEqual(['divider'])
    expect(out.refs).toEqual(['divider'])
  })

  it('drops the entry once the LAST placement goes', () => {
    const out = read(ok(removeChild(parent(['a', 'b']), { index: 0, refId: 'a' })))

    expect(out.refs).not.toContain('a')
  })

  it('refuses to remove something that is not placed', () => {
    expect(removeChild(parent(['a']), { index: 3, refId: 'nope' }).ok).toBe(false)
  })

  it('refuses when the draft moved under the tree rather than rewriting the wrong row', () => {
    // The tree is derived from bytes a Files-tab edit can change underneath it. Acting on position
    // alone would then delete whatever row had drifted into that slot.
    expect(removeChild(parent(['a', 'b']), { index: 0, refId: 'b' }).ok).toBe(false)
  })
})

describe('moveChild', () => {
  it('moves up, because items order IS the rendered order', () => {
    const out = read(ok(moveChild(parent(['a', 'b', 'c']), { index: 1, refId: 'b' }, 'up')))

    expect(out.ids).toEqual(['b', 'a', 'c'])
  })

  it('moves down', () => {
    const out = read(ok(moveChild(parent(['a', 'b', 'c']), { index: 1, refId: 'b' }, 'down')))

    expect(out.ids).toEqual(['a', 'c', 'b'])
  })

  it('moves THE placement clicked, not the first one with that id', () => {
    // By id, findIndex always returned the first match: clicking "move up" on the second divider
    // moved the first one instead, and the row the author was looking at did not budge.
    const out = read(ok(moveChild(parent(['divider', 'a', 'divider']), { index: 2, refId: 'divider' }, 'up')))

    expect(out.ids).toEqual(['divider', 'divider', 'a'])
  })

  it('refuses at the ends rather than silently doing nothing', () => {
    // Refusing lets the caller disable the control instead of offering a no-op that looks broken.
    expect(moveChild(parent(['a', 'b']), { index: 0, refId: 'a' }, 'up').ok).toBe(false)
    expect(moveChild(parent(['a', 'b']), { index: 1, refId: 'b' }, 'down').ok).toBe(false)
  })

  it('leaves the ref entries alone — only order changes', () => {
    const out = read(ok(moveChild(parent(['a', 'b']), { index: 1, refId: 'b' }, 'up')))

    expect(out.refs.sort()).toEqual(['a', 'b'])
  })

  it('refuses a child that is not placed', () => {
    expect(moveChild(parent(['a']), { index: 1, refId: 'ghost' }, 'up').ok).toBe(false)
  })
})

describe('newContainerYaml / containerPath', () => {
  it('produces a container that parses and is empty', () => {
    const doc = load(newContainerYaml('Row', 'fleet-top', 'krateo-system')) as {
      kind: string
      spec: { widgetData: { items: unknown[] }; resourcesRefs: { items: unknown[] } }
    }

    expect(doc.kind).toBe('Row')
    expect(doc.spec.widgetData.items).toEqual([])
    expect(doc.spec.resourcesRefs.items).toEqual([])
  })

  it('WRITES an empty allowedResources, because the CRD requires the field', () => {
    // I asserted the opposite first, reasoning that empty means "nothing may be placed here".
    // A server dry-run corrected it: flexes, rows, cols, tabs and tables all REQUIRE the field —
    // "spec.widgetData.allowedResources: Required value" — so omitting it produces a container the
    // apiserver rejects outright. Empty is right because placeChild appends each child's plural as
    // it is placed, so the list grows to exactly what the container holds.
    const doc = load(newContainerYaml('Flex', 'x', 'krateo-system')) as {
      spec: { widgetData: { allowedResources: string[] } }
    }

    expect(doc.spec.widgetData.allowedResources).toEqual([])
  })

  it('does not guess layout properties the author has not chosen', () => {
    const yaml = newContainerYaml('Row', 'x', 'krateo-system')

    // gap/justify/vertical written now would look chosen when they were defaulted.
    for (const guessed of ['gap:', 'justify:', 'vertical:']) {
      expect(yaml).not.toContain(guessed)
    }
  })

  it('names the file by identity alone — a HELD KEY, with no directory', () => {
    // A page draft holds its files under bare tokens and `pagePublishPath` prefixes the chart root
    // once, at publish. This used to take a directory and return a repo path, which then got
    // prefixed a SECOND time: helm/portal/templates/helm/portal/templates/row.fleet-top.yaml.
    expect(containerPath('Row', 'fleet-top')).toBe('row.fleet-top.yaml')
    expect(containerPath('Card', 'x')).toBe('card.x.yaml')
  })

  it('writes the namespace the CRDs require on a new container', () => {
    const doc = load(newContainerYaml('Row', 'top', 'krateo-system')) as { metadata: { namespace: string } }

    expect(doc.metadata.namespace).toBe('krateo-system')
  })

  it('round-trips: a new container accepts a placed child', () => {
    const container = newContainerYaml('Row', 'top', 'krateo-system')
    const placed = placeChild(container, { name: 'stat', namespace: 'krateo-system', resource: 'statistics' })

    expect(placed.ok).toBe(true)
  })

  it('places a child WITH its namespace, without which snowplow resolves it to nothing', () => {
    // The resourcesRefs resolver has no defaulting — it puts this straight into the /call query —
    // so an entry without a namespace resolves against the empty one and the child never renders.
    // It is not an apply error either: the page publishes clean and comes up with a hole in it.
    const doc = load(ok(placeChild(newContainerYaml('Flex', 'p', 'krateo-system'), {
      name: 'stat', namespace: 'krateo-system', resource: 'statistics',
    }))) as { spec: { resourcesRefs: { items: { namespace: string }[] } } }

    expect(doc.spec.resourcesRefs.items[0].namespace).toBe('krateo-system')
  })
})
