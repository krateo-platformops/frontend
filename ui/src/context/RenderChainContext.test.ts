import { describe, expect, it } from 'vitest'

import { MAX_RENDER_DEPTH, inspectChain, shortName } from './RenderChainContext'

const ep = (name: string) => `http://x/call?resource=flexes&name=${name}`

/*
 * A cycle is two CRs each naming the other, in different files, each correct in isolation. Nothing
 * in the CRD, the server dry-run or the chart lint can see it — so the render path is the only
 * place it can be caught, and before this it was caught by the browser's stack running out.
 */
describe('render chain bounds (X6)', () => {
  it('renders when the endpoint is new to the chain', () => {
    expect(inspectChain([ep('a'), ep('b')], ep('c')).verdict).toBe('render')
  })

  it('names the other CR when two reference each other', () => {
    const got = inspectChain([ep('page'), ep('card-a')], ep('page'))
    expect(got.verdict).toBe('cycle')
    expect('reason' in got && got.reason).toContain('card-a')
  })

  it('reports a self-reference as itself, not as a pair', () => {
    const got = inspectChain([ep('loop')], ep('loop'))
    expect(got.verdict).toBe('cycle')
    expect('reason' in got && got.reason).toContain('references itself')
  })

  it('caps a chain that is merely absurdly deep', () => {
    const deep = Array.from({ length: MAX_RENDER_DEPTH }, (_, i) => ep(`w${i}`))
    expect(inspectChain(deep, ep('one-more')).verdict).toBe('too-deep')
  })

  it('leaves real compositions alone — the deepest measured chart chain is 9', () => {
    const real = Array.from({ length: 9 }, (_, i) => ep(`level${i}`))
    expect(inspectChain(real, ep('level9')).verdict).toBe('render')
  })

  it('pulls a usable CR name out of an endpoint, and degrades when it cannot', () => {
    expect(shortName(ep('alerts-page-header'))).toBe('alerts-page-header')
    expect(shortName('http://x/call?resource=flexes')).toBe('another widget')
  })
})
