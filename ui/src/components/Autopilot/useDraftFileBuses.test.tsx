// @vitest-environment jsdom
/**
 * A page STARTED BY A PERSON gets the same live render a proposed one does.
 *
 * There was no test on this hook at all, which is how the gap survived: `onDraftStart` said it took
 * "the SAME entry point a proposed page takes", and it did share `recordPagePreview` — but a
 * proposed page ALSO goes through `previewPage`, which applies the drafts to the sandbox and hands
 * the drawer a `liveEndpoint`. A hand-started one stopped at the held bytes, so the agent's page
 * rendered and the person's showed YAML.
 *
 * It became the wrong way round when drag & drop became the only way to build a page (portal#237):
 * the primary path was the one with no live preview.
 */
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { createBlueprintDraftStore } from './blueprintDraftStore'
import { AUTOPILOT_PREVIEW_EVENT } from './previewBus'
import { emitDraftStart } from './previewDraftStart'
import { useDraftFileBuses } from './useDraftFileBuses'

/** A page draft set: the `page-<slug>` root Flex is what makes it a page at all. */
const widgets = () => [
  {
    apiVersion: 'widgets.templates.krateo.io/v1beta1',
    kind: 'Flex',
    metadata: { name: 'page-service-catalog', namespace: 'krateo-system' },
    spec: { widgetData: { items: [] } },
  },
]

const Host = ({ previewLive }: { previewLive?: (w: Record<string, unknown>[], t: string) => Promise<void> }) => {
  const store = createBlueprintDraftStore()
  useDraftFileBuses(store, { recordPreview: vi.fn() }, () => null, previewLive)
  return null
}

afterEach(cleanup)

describe('a hand-started draft', () => {
  it('goes through the LIVE preview path, the same one a proposal takes', () => {
    const previewLive = vi.fn().mockResolvedValue(undefined)
    render(<Host previewLive={previewLive} />)

    act(() => { emitDraftStart({ title: 'Service catalog', widgets: widgets() }) })

    expect(previewLive).toHaveBeenCalledTimes(1)
    const [sent, sentTitle] = previewLive.mock.calls[0] as [Record<string, unknown>[], string]
    expect((sent[0].metadata as { name: string }).name).toBe('page-service-catalog')
    expect(sentTitle).toBe('Service catalog')
  })

  it('does NOT fall back to the source-only drawer when a live path exists', () => {
    // The old behaviour opened the source payload directly. Doing both would race two payloads
    // onto one bus and the source-only one could win — a live preview that flickers into YAML.
    const previewLive = vi.fn().mockResolvedValue(undefined)
    const opened: unknown[] = []
    const onPreview = (event: Event) => opened.push((event as CustomEvent).detail)
    window.addEventListener(AUTOPILOT_PREVIEW_EVENT, onPreview)
    render(<Host previewLive={previewLive} />)

    act(() => { emitDraftStart({ title: 'Service catalog', widgets: widgets() }) })

    window.removeEventListener(AUTOPILOT_PREVIEW_EVENT, onPreview)
    expect(opened).toEqual([])
  })

  it('still opens source-only with NO live path — a non-UI caller keeps working', () => {
    const opened: unknown[] = []
    const onPreview = (event: Event) => opened.push((event as CustomEvent).detail)
    window.addEventListener(AUTOPILOT_PREVIEW_EVENT, onPreview)
    render(<Host />)

    act(() => { emitDraftStart({ title: 'Service catalog', widgets: widgets() }) })

    window.removeEventListener(AUTOPILOT_PREVIEW_EVENT, onPreview)
    expect(opened).toHaveLength(1)
  })

  it('is REFUSED while a draft is already held — seeding over one discards unpublished work', () => {
    const previewLive = vi.fn().mockResolvedValue(undefined)
    render(<Host previewLive={previewLive} />)
    act(() => { emitDraftStart({ title: 'First', widgets: widgets() }) })
    act(() => { emitDraftStart({ title: 'Second', widgets: widgets() }) })
    expect(previewLive).toHaveBeenCalledTimes(1)
  })
})
