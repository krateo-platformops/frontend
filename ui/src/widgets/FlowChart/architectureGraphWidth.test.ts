import { describe, expect, it } from 'vitest'

import { architectureGraphWidth } from './architectureVariant'

describe('architectureGraphWidth (portal#310)', () => {
  it('is four columns wide for the builder-publish chain', () => {
    const nodes = [{ id: 'repository' }, { id: 'repo' }, { id: 'localresources' }, { id: 'pullrequest' }]
    const edges = [
      { source: 'repository', target: 'repo' },
      { source: 'repository', target: 'localresources' },
      { source: 'repo', target: 'localresources' },
      { source: 'localresources', target: 'pullrequest' },
    ]
    // 4 ranks: 4*220 + 3*160
    expect(architectureGraphWidth(nodes, edges)).toBe(1360)
  })

  it('is one card wide for a single node, and 0 for none', () => {
    expect(architectureGraphWidth([{ id: 'only' }], [])).toBe(220)
    expect(architectureGraphWidth([], [])).toBe(0)
  })

  it('does not hang on a cycle in a malformed payload', () => {
    const nodes = [{ id: 'a' }, { id: 'b' }]
    const edges = [{ source: 'a', target: 'b' }, { source: 'b', target: 'a' }]
    expect(architectureGraphWidth(nodes, edges)).toBeGreaterThan(0)
  })
})
