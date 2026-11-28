// @vitest-environment jsdom
/**
 * The status pill's mark (approved mockup, portal UX review): a Kubernetes state token carries its
 * family's antd glyph in the dot's place; everything else keeps the dot. The table below is the
 * vocabulary the portal's pills print; the cases that must KEEP the dot are as important as the
 * glyphs, because a wrong glyph on a domain state (Open, Firing) or a bare condition status
 * (False while Paused) would say something untrue.
 */
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { stateFamily } from './stateFamily'
import StatusPill from './StatusPill'

const mark = (label: string, color = 'green') => {
  const { container } = render(<StatusPill color={color} label={label} />)
  const glyph = container.querySelector('[data-state-family]')
  const dot = container.querySelector('span[style*="border-radius: 50%"]')
  return { dot: Boolean(dot), family: glyph?.getAttribute('data-state-family') ?? null, hidden: glyph?.getAttribute('aria-hidden') ?? null }
}

describe('status pill glyphs', () => {
  afterEach(() => { cleanup() })

  it.each([
    ['Ready', 'healthy'], ['Healthy', 'healthy'], ['Synced', 'healthy'], ['ScaledToZero', 'healthy'],
    ['NotReady', 'failed'], ['Degraded', 'failed'], ['Unhealthy', 'failed'], ['Failed', 'failed'],
    ['Pending', 'transitional'], ['Creating', 'transitional'], ['Deleting', 'transitional'], ['Progressing', 'transitional'],
    ['Paused', 'paused'],
    ['NotSynced', 'drift'], ['Drift', 'drift'],
    ['ReadyUnknown', 'unknown'], ['SyncedUnknown', 'unknown'],
  ])('%s carries the %s glyph and no dot', (label, family) => {
    expect(mark(label)).toEqual({ dot: false, family, hidden: 'true' })
  })

  it.each(['Open', 'Merged', 'Firing', 'stable', 'True', 'False', 'Unknown', 'CrashLoopBackOff', 'ready', 'toString'])(
    '%s keeps the dot: not a Kubernetes state token',
    (label) => { expect(mark(label)).toEqual({ dot: true, family: null, hidden: null }) },
  )

  it('no colour, no label, or a sized delta pill: no mark at all, as before', () => {
    expect(mark('Ready', '')).toEqual({ dot: false, family: null, hidden: null })
    expect(mark('')).toEqual({ dot: false, family: null, hidden: null })
    const { container } = render(<StatusPill color='green' label='Ready' style={{ fontSize: 11 }} />)
    expect(container.querySelector('[data-state-family], span[style*="border-radius: 50%"]')).toBeNull()
  })

  it('reads the token, not the colour: Paused and ReadyUnknown share grey but not a glyph', () => {
    expect(mark('Paused', 'gray').family).toBe('paused')
    expect(mark('ReadyUnknown', 'gray').family).toBe('unknown')
  })

  it('a label that is not a string (a ReactNode) keeps the dot', () => {
    expect(stateFamily(<b>Ready</b>)).toBeUndefined()
  })
})
