/**
 * Agentiko grounding / anti-confabulation coverage.
 *
 * SCOPE: pure-logic only (like the repo's other tests — no RTL / jsdom). We assert:
 *   1. The collector derives a TRUTHFUL page status from the live widget load states
 *      (heavy / error / loading / ready), so Agentiko can give the RIGHT answer
 *      ("the compositions table is very large and still rendering") instead of guessing.
 *   2. The context delta re-sends whenever the page status flips, so grounding does
 *      not go stale mid-conversation.
 *
 * SCOPE BOUNDARY: reporting `pageStatus` truthfully is the frontend's whole share of
 * grounding. The anti-confabulation RULE it feeds (page-load questions are client-side;
 * never blame an unrelated CrashLoopBackOff pod) is a prompt rule, asserted where it
 * lives — the page-load rule of the `autopilot` key in krateo-autopilot's
 * chart/files/prompts-eng.yaml. The empty-preamble invariant lives in actionBridge.test.ts.
 */
import { describe, expect, it } from 'vitest'

import type { PageContextEnvelope, WidgetInventoryEntry } from './types'
import { buildContextDelta, derivePageStatus, loadStateFromStatus, serializePageContext } from './useAgentikoContext'

const widget = (over: Partial<WidgetInventoryEntry> = {}): WidgetInventoryEntry => ({
  endpoint: '/call?resource=flexes&name=x',
  kind: 'Panel',
  ...over,
})

const envelope = (over: Partial<PageContextEnvelope> = {}): PageContextEnvelope => ({
  route: '/compositions',
  widgets: [],
  ...over,
})

describe('collector page-status grounding', () => {
  it('maps react-query state → truthful on-screen load state', () => {
    expect(loadStateFromStatus('pending', 'fetching')).toBe('loading')
    // A success-status widget that is background-refetching still counts as loading.
    expect(loadStateFromStatus('success', 'fetching')).toBe('loading')
    expect(loadStateFromStatus('error', 'idle')).toBe('error')
    expect(loadStateFromStatus('success', 'idle')).toBe('ready')
  })

  it('derives an errored page status when any widget failed to load', () => {
    expect(derivePageStatus([widget({ loadState: 'ready' }), widget({ loadState: 'error' })])).toBe('error')
  })

  it('flags a very large dataset as "heavy" (the compositions-table render hazard)', () => {
    // The grounded RIGHT answer for the reported bug: a huge non-virtualized table.
    expect(derivePageStatus([widget({ kind: 'Table', large: true, loadState: 'ready', summary: 'Table · 60026 rows' })]))
      .toBe('heavy')
  })

  it('prefers loading/error over heavy, and returns undefined with no widgets (unknown ≠ fabricated)', () => {
    expect(derivePageStatus([widget({ large: true, loadState: 'loading' })])).toBe('loading')
    expect(derivePageStatus([])).toBeUndefined()
  })
})

describe('context delta keeps page status fresh', () => {
  const base = envelope({ pageStatus: 'loading', widgets: [widget({ endpoint: '/a', loadState: 'loading' })] })

  it('re-sends the full envelope when pageStatus flips even if route + widgets are unchanged', () => {
    const next = envelope({ pageStatus: 'ready', widgets: [widget({ endpoint: '/a', loadState: 'ready' })] })
    const delta = buildContextDelta(next, base)
    // A full re-send (not the short "Unchanged" note) — the render state changed.
    expect(delta).toBe(serializePageContext(next))
    expect(delta).not.toContain('Unchanged:')
  })

  it('sends only the short note (carrying pageStatus) when nothing render-relevant changed', () => {
    const next = envelope({ pageStatus: 'loading', widgets: [widget({ endpoint: '/a', loadState: 'loading' })] })
    const delta = buildContextDelta(next, base)
    expect(delta).toContain('Unchanged:')
    expect(delta).toContain('page loading')
  })
})
