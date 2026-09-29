// @vitest-environment jsdom
/**
 * A RESUMED page gets its live render back — through the file buses' own apply loop.
 *
 * A resume puts a tree in the store that no edit produced, so nothing in this hook would schedule
 * its apply; the re-apply bus is what does. What these pin:
 *   - the held page is applied, from the held files, through `previewLive`;
 *   - `discardPrevious` takes the replaced page's render down FIRST, in the same loop, so its
 *     DELETEs cannot race the new apply's sweep — and it is not a discard: the draft is not dropped.
 */
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { createBlueprintDraftStore, type BlueprintDraftStore } from './blueprintDraftStore'
import { pageDraftFiles } from './pageDraft'
import { onDraftClose } from './previewDraftClose'
import { emitDraftReapply } from './previewDraftResume'
import { useDraftFileBuses } from './useDraftFileBuses'

const page = pageDraftFiles([{
  apiVersion: 'widgets.templates.krateo.io/v1beta1',
  kind: 'Flex',
  metadata: { name: 'page-fleet', namespace: 'krateo-system' },
  spec: { resourcesRefs: { items: [] }, widgetData: { items: [] } },
}]) as Record<string, string>

const Host = ({ discardLive, previewLive, store }: {
  discardLive: () => Promise<void>
  previewLive: (widgets: Record<string, unknown>[], title: string) => Promise<void>
  store: BlueprintDraftStore
}) => {
  useDraftFileBuses(store, { recordPreview: vi.fn() }, () => null, previewLive, discardLive)
  return null
}

afterEach(cleanup)

describe('the re-apply bus', () => {
  it('applies the held page, and takes the replaced render down first when asked', async () => {
    const order: string[] = []
    const store = createBlueprintDraftStore()
    store.set(page, 'page')
    const previewLive = vi.fn((widgets: Record<string, unknown>[], title: string) => {
      order.push(`apply ${widgets.length} ${title}`)
      return Promise.resolve()
    })
    const discardLive = vi.fn(() => {
      order.push('discard')
      return Promise.resolve()
    })
    let closes = 0
    const stop = onDraftClose(() => { closes += 1 })
    render(<Host discardLive={discardLive} previewLive={previewLive} store={store} />)

    act(() => { emitDraftReapply({ discardPrevious: true }) })
    await vi.waitFor(() => expect(order).toEqual(['discard', 'apply 1 page:flex.page-fleet']))
    expect(closes).toBe(0)
    expect(store.get()?.files).toEqual(page)

    act(() => { emitDraftReapply() })
    await vi.waitFor(() => expect(order).toHaveLength(3))
    expect(discardLive).toHaveBeenCalledTimes(1)
    stop()
  })
})
