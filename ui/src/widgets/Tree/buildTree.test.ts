import { describe, expect, it } from 'vitest'

import { ancestorsOf, buildTree, type NestedNode } from './buildTree'

type Node = { key: string; parentKey?: string }
const shape = (entries: NestedNode<Node>[]): unknown => entries.map(({ children, node }) => (children.length ? { [node.key]: shape(children) } : node.key))

describe('buildTree', () => {
  it('nests a flat list through parentKey, keeping sibling order', () => {
    expect(shape(buildTree([
      { key: 'a' }, { key: 'a2', parentKey: 'a' }, { key: 'a1', parentKey: 'a' }, { key: 'a1x', parentKey: 'a1' }, { key: 'b' },
    ]))).toEqual([{ a: ['a2', { a1: ['a1x'] }] }, 'b'])
  })

  it('accepts a child listed before its parent', () => {
    expect(shape(buildTree([{ key: 'c', parentKey: 'p' }, { key: 'p' }]))).toEqual([{ p: ['c'] }])
  })

  it('draws a node whose parent is missing at the root, so a filtered answer loses nothing', () => {
    expect(shape(buildTree([{ key: 'a' }, { key: 'orphan', parentKey: 'gone' }]))).toEqual(['a', 'orphan'])
  })

  it('keeps the first of two nodes sharing a key', () => {
    const roots = buildTree([{ key: 'a', parentKey: undefined }, { key: 'a', parentKey: 'x' }, { key: 'x' }])
    expect(shape(roots)).toEqual(['a', 'x'])
  })

  it('breaks a cycle instead of dropping its nodes', () => {
    const roots = buildTree([{ key: 'a', parentKey: 'b' }, { key: 'b', parentKey: 'a' }, { key: 'self', parentKey: 'self' }])
    const keys = JSON.stringify(shape(roots))
    expect(keys).toContain('"a"')
    expect(keys).toContain('"b"')
    expect(keys).toContain('"self"')
  })
})

describe('ancestorsOf', () => {
  const roots = buildTree([{ key: 'a' }, { key: 'b', parentKey: 'a' }, { key: 'c', parentKey: 'b' }, { key: 'd' }])

  it('names the ancestors, nearest first', () => {
    expect(ancestorsOf(roots, 'c')).toEqual(['b', 'a'])
  })

  it('names none for a root or an unknown key', () => {
    expect(ancestorsOf(roots, 'd')).toEqual([])
    expect(ancestorsOf(roots, 'nope')).toEqual([])
  })
})
