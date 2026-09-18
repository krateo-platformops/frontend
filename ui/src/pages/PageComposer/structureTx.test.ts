/**
 * The atomic multi-file commit. These tests drive the REAL structural primitives against real YAML
 * rather than stubs, because the properties under test are about how those primitives COMPOSE —
 * a stub would compose perfectly and prove nothing.
 *
 * Two of them are the reason this module exists at all:
 *   - a reparent inside ONE container is two edits on ONE file, and the naive loop reads the
 *     original bytes twice and silently discards the first edit;
 *   - a failure anywhere must leave NOTHING applied, or the draft is neither the before nor the
 *     after and the child has vanished from one parent without appearing in the other.
 */
import { describe, expect, it } from 'vitest'

import { placeChild, removeChild } from './structureEdit'
import { reparentChild, runStructureTx } from './structureTx'

/** A real Flex container as YAML — the primitives parse and re-dump this, so it must be genuine. */
const container = (name: string, children: readonly string[] = [], allowed: readonly string[] = []) => {
  const lines: string[] = [
    'kind: Flex',
    'apiVersion: widgets.templates.krateo.io/v1beta1',
    'metadata:',
    `  name: ${name}`,
    '  namespace: krateo-system',
    'spec:',
    '  widgetData:',
  ]
  lines.push(allowed.length ? '    allowedResources:' : '    allowedResources: []')
  allowed.forEach((plural) => lines.push(`      - ${plural}`))
  lines.push(children.length ? '    items:' : '    items: []')
  children.forEach((refId) => lines.push(`      - resourceRefId: ${refId}`))
  lines.push('  resourcesRefs:')
  lines.push(children.length ? '    items:' : '    items: []')
  children.forEach((refId) => {
    lines.push(`      - id: ${refId}`)
    lines.push(`        name: ${refId}`)
    lines.push('        namespace: krateo-system')
    lines.push('        resource: cards')
    lines.push('        verb: GET')
  })
  return lines.join('\n')
}

const CARD = { name: 'card-a', namespace: 'krateo-system', resource: 'cards' }

const files = () => ({
  'templates/flex.left.yaml': container('left', ['card-a'], ['cards']),
  'templates/flex.right.yaml': container('right'),
})

describe('runStructureTx — all or nothing', () => {
  it('applies every edit and returns ONLY the files that changed', () => {
    const result = runStructureTx(files(), [
      { apply: (yaml) => placeChild(yaml, CARD), path: 'templates/flex.right.yaml' },
    ])
    expect(result.ok).toBe(true)
    if (!result.ok) { return }
    expect(Object.keys(result.files)).toEqual(['templates/flex.right.yaml'])
    expect(result.files['templates/flex.right.yaml']).toContain('card-a')
  })

  it('applies NOTHING when a later edit fails', () => {
    const result = runStructureTx(files(), [
      // this one would succeed on its own
      { apply: (yaml) => placeChild(yaml, CARD), path: 'templates/flex.right.yaml' },
      // and this one cannot: index 7 holds no child
      { apply: (yaml) => removeChild(yaml, { index: 7, refId: 'card-a' }), path: 'templates/flex.left.yaml' },
    ])
    expect(result.ok).toBe(false)
    if (result.ok) { return }
    expect(result.path).toBe('templates/flex.left.yaml')
    // and crucially: no partial result is handed back for the edit that DID succeed
    expect(result).not.toHaveProperty('files')
  })

  it('refuses a path the draft does not carry, naming it', () => {
    const result = runStructureTx(files(), [
      { apply: (yaml) => placeChild(yaml, CARD), path: 'templates/flex.nowhere.yaml' },
    ])
    expect(result.ok).toBe(false)
    if (result.ok) { return }
    expect(result.path).toBe('templates/flex.nowhere.yaml')
    expect(result.error).toContain('nothing to edit')
  })

  it('THREADS a path touched twice — the second edit sees the first', () => {
    // The case the naive loop gets wrong: both edits read `files[path]`, so the second overwrites
    // the first and the removal silently disappears.
    const result = runStructureTx(files(), [
      { apply: (yaml) => removeChild(yaml, { index: 0, refId: 'card-a' }), path: 'templates/flex.left.yaml' },
      { apply: (yaml) => placeChild(yaml, { ...CARD, name: 'card-b' }), path: 'templates/flex.left.yaml' },
    ])
    expect(result.ok).toBe(true)
    if (!result.ok) { return }
    const left = result.files['templates/flex.left.yaml']
    // the second edit applied, and the first was NOT discarded
    expect(left).toContain('card-b')
    expect(left).not.toContain('card-a')
  })

  it('omits a file whose content did not actually change', () => {
    // placeChild is idempotent on allowedResources; an edit that produces identical bytes must not
    // be reported as a change (a no-op rewrite reads as a diff and re-renders the preview).
    const start = files()
    const result = runStructureTx(start, [
      { apply: (yaml) => ({ content: yaml, ok: true as const }), path: 'templates/flex.left.yaml' },
    ])
    expect(result.ok).toBe(true)
    if (!result.ok) { return }
    expect(result.files).toEqual({})
  })
})

describe('runStructureTx — expectContent', () => {
  it('refuses when the file changed since the edit was planned', () => {
    const result = runStructureTx(files(), [
      { apply: (yaml) => placeChild(yaml, CARD), expectContent: 'something else entirely', path: 'templates/flex.right.yaml' },
    ])
    expect(result.ok).toBe(false)
    if (result.ok) { return }
    expect(result.error).toContain('changed since this edit was planned')
  })

  it('checks it only on FIRST touch, so a same-file pair is not refused by its own first edit', () => {
    // Without the first-touch rule the second edit compares the pinned ORIGINAL bytes against the
    // staged (already-edited) ones and refuses every legitimate reorder.
    const start = files()
    const original = start['templates/flex.left.yaml']
    const result = runStructureTx(start, [
      { apply: (yaml) => removeChild(yaml, { index: 0, refId: 'card-a' }), expectContent: original, path: 'templates/flex.left.yaml' },
      { apply: (yaml) => placeChild(yaml, { ...CARD, name: 'card-b' }), expectContent: original, path: 'templates/flex.left.yaml' },
    ])
    expect(result.ok).toBe(true)
  })
})

describe('reparentChild', () => {
  it('moves a child between containers, rewriting BOTH parents in one commit', () => {
    const result = reparentChild(files(), {
      at: { index: 0, refId: 'card-a' },
      child: CARD,
      fromPath: 'templates/flex.left.yaml',
      toPath: 'templates/flex.right.yaml',
    })
    expect(result.ok).toBe(true)
    if (!result.ok) { return }
    expect(Object.keys(result.files).sort()).toEqual(['templates/flex.left.yaml', 'templates/flex.right.yaml'])
    expect(result.files['templates/flex.left.yaml']).not.toContain('card-a')
    expect(result.files['templates/flex.right.yaml']).toContain('card-a')
    // the receiving container must also declare the plural or it will not render the child
    expect(result.files['templates/flex.right.yaml']).toContain('cards')
  })

  it('reorders within ONE container — same file, one commit', () => {
    const start = {
      'templates/flex.left.yaml': container('left', ['card-a', 'card-b'], ['cards']),
    }
    const result = reparentChild(start, {
      at: { index: 0, refId: 'card-a' },
      child: CARD,
      fromPath: 'templates/flex.left.yaml',
      toPath: 'templates/flex.left.yaml',
    })
    expect(result.ok).toBe(true)
    if (!result.ok) { return }
    const left = result.files['templates/flex.left.yaml']
    // card-a left index 0 and was re-placed at the end: card-b now precedes it.
    expect(left.indexOf('card-b')).toBeLessThan(left.lastIndexOf('card-a'))
  })

  it('applies nothing when the source index does not hold the expected child', () => {
    const before = files()
    const result = reparentChild(before, {
      at: { index: 0, refId: 'not-there' },
      child: CARD,
      fromPath: 'templates/flex.left.yaml',
      toPath: 'templates/flex.right.yaml',
    })
    expect(result.ok).toBe(false)
    if (result.ok) { return }
    expect(result.path).toBe('templates/flex.left.yaml')
  })
})
