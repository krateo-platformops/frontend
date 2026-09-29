/**
 * WRITE-AHEAD for a page's live preview: `beforeApply` (the draft-record flush) runs, and settles,
 * before the preview's FIRST sandbox write — the sweep — so a tab killed mid-apply has already stored
 * the page it was previewing. A blocked preview (validation) writes nothing and saves nothing.
 *
 * Kept apart from previewPageV2.test.ts so this seam's test does not ride on that file's fixtures.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { WriteOp, WriteOpResult } from '../../hooks/runRestSet'

import { resetKindCacheForTests } from './kindResolver'
import { applyPreviewPageV2 } from './previewPageV2'
import { createPreviewPageSession, primeDraftKinds, WIDGETS_API_VERSION } from './previewSandbox'

vi.mock('./previewBus', () => ({ openAutopilotPreview: vi.fn(), setPreviewProblems: vi.fn() }))

const SANDBOX = 'krateo-preview'
const SNOWPLOW = 'http://snowplow.test'
const PLURALS: Record<string, string> = { Flex: 'flexes', Paragraph: 'paragraphs' }

const widgets = (): Record<string, unknown>[] => [
  {
    kind: 'Flex',
    metadata: { name: 'page-preview-draft', namespace: 'krateo-system' },
    spec: {
      resourcesRefs: {
        items: [{ allowed: true, apiVersion: WIDGETS_API_VERSION, id: 'p1', name: 'preview-draft-title', namespace: 'krateo-system', resource: 'paragraphs', verb: 'GET' }],
      },
      widgetData: { allowedResources: ['paragraphs'], items: [{ resourceRefId: 'p1' }] },
    },
  },
  { kind: 'Paragraph', metadata: { name: 'preview-draft-title' }, spec: { widgetData: { text: 'Draft paragraph' } } },
]

beforeEach(async () => {
  vi.clearAllMocks()
  resetKindCacheForTests()
  vi.stubGlobal('fetch', vi.fn((url: string) => {
    const plural = PLURALS[new URL(url).searchParams.get('kind') ?? '']
    return Promise.resolve(plural
      ? { json: () => Promise.resolve({ plural }), ok: true, status: 200 }
      : { json: () => Promise.resolve({}), ok: false, status: 404 })
  }))
  await primeDraftKinds(Object.keys(PLURALS).map((kind) => ({ kind })), SNOWPLOW)
})

const deps = (order: string[], beforeApply: () => Promise<unknown>) => ({
  beforeApply,
  handleActionSet: vi.fn((ops: readonly WriteOp[]): Promise<WriteOpResult[] | null> => {
    order.push(...ops.map((op) => op.verb))
    return Promise.resolve(ops.map((_, index) => ({ index, message: 'OK', ok: true, status: 201 })))
  }),
  sandboxNamespace: SANDBOX,
  session: createPreviewPageSession(),
  sessionId: 's_test',
})

describe('page live preview — write-ahead', () => {
  it('the record is written (and settled) before the first sandbox write', async () => {
    const order: string[] = []
    const beforeApply = vi.fn(async () => {
      await Promise.resolve()
      order.push('record')
    })
    const chip = await applyPreviewPageV2({ verb: 'previewPage', widgets: widgets() }, deps(order, beforeApply))
    expect(chip?.label).not.toMatch(/blocked|denied/)
    expect(beforeApply).toHaveBeenCalledTimes(1)
    expect(order[0]).toBe('record')
    expect(order.slice(1)).toContain('POST')
  })

  it('a save that fails does not stop the preview', async () => {
    const order: string[] = []
    const chip = await applyPreviewPageV2({ verb: 'previewPage', widgets: widgets() }, deps(order, () => Promise.reject(new Error('down'))))
    expect(chip?.label).not.toMatch(/blocked|denied/)
    expect(order).toContain('POST')
  })

  it('a preview blocked by validation saves nothing, writes nothing, and reports no success', async () => {
    const order: string[] = []
    const beforeApply = vi.fn(() => Promise.resolve())
    const afterApply = vi.fn()
    await applyPreviewPageV2({ verb: 'previewPage', widgets: [{ kind: 'Paragraph', metadata: { name: 'p' }, spec: { widgetData: {} } }] }, { ...deps(order, beforeApply), afterApply })
    expect(beforeApply).not.toHaveBeenCalled()
    expect(afterApply).not.toHaveBeenCalled()
    expect(order).toEqual([])
  })
})

describe('page live preview — afterApply (the success signal the record\'s renderedHash hangs on)', () => {
  it('is called ONCE, with the widgets as proposed, when every draft applied', async () => {
    const order: string[] = []
    const afterApply = vi.fn(() => { order.push('applied') })
    const proposed = widgets()
    await applyPreviewPageV2({ verb: 'previewPage', widgets: proposed }, { ...deps(order, () => Promise.resolve()), afterApply })
    expect(afterApply).toHaveBeenCalledTimes(1)
    expect(afterApply).toHaveBeenCalledWith(proposed)
    expect(order.at(-1)).toBe('applied')
  })

  it('is NOT called when the apply failed', async () => {
    const afterApply = vi.fn()
    const failing = {
      ...deps([], () => Promise.resolve()),
      afterApply,
      handleActionSet: vi.fn((ops: readonly WriteOp[]): Promise<WriteOpResult[] | null> => Promise.resolve(ops.map((op, index) => (
        op.verb === 'POST' ? { index, message: 'forbidden', ok: false, status: 403 } : { index, message: 'OK', ok: true, status: 200 }
      )))),
    }
    const chip = await applyPreviewPageV2({ verb: 'previewPage', widgets: widgets() }, failing)
    expect(chip?.label).toMatch(/^preview apply failed/)
    expect(afterApply).not.toHaveBeenCalled()
  })
})
