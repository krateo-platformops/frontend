// @vitest-environment jsdom
/**
 * The composer's side of Resume (screens 3 and 4). The provider is played here on its bus. What
 * these pin:
 *   - a failed read is a sentence where the draft would have been, and nothing is asked of the
 *     provider;
 *   - the replace prompt appears ONLY when the provider answers that a draft is held, names both
 *     drafts and their readiness, and "Close and resume" is what sends `replace`; Cancel sends nothing;
 *   - with nothing held there is no prompt, just the restored banner;
 *   - a record of the other kind is not loaded, and the link is consumed either way;
 *   - an adoption whose read fails adopts nothing;
 *   - the legacy Discard asks the provider to delete the WHOLE set it read, returns to the Portal
 *     Builder once deleted, and refuses a root that belongs to a record.
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { App as AntdApp } from 'antd'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { installAntdShims } from '../../pages/PageComposer/composerTestHarness'

import { legacyPageSet, PREVIEW_LABELS, serveLegacyPageSet } from './__fixtures__/legacyPageSet'
import type { DraftKind } from './blueprintDraftStore'
import { DRAFT_RECORD_KEY, treeHash, type DraftRecordBody } from './draftRecord'
import { emitDraftResumeResult, emitLegacyDiscardResult, onDraftResume, onLegacyDiscard, type DraftResumeDetail, type LegacyDiscardDetail } from './previewDraftResume'
import { useDraftResume } from './useDraftResume'

const files = { 'Chart.yaml': 'apiVersion: v2\nname: payments-api\nversion: 0.1.0\n' }
const record: DraftRecordBody = { files, kind: 'blueprint', name: 'payments-api', renderedHash: treeHash(files), state: 'open', updatedAt: '2026-09-29T12:04:00Z', version: 1 }

const Host = ({ allowAdopt, kind }: { allowAdopt?: boolean; kind: DraftKind }) => {
  const element = useDraftResume({ allowAdopt, kind, sandboxNamespace: 'krateo-preview', snowplowBaseUrl: 'https://snowplow.test' })
  return <AntdApp>{element}</AntdApp>
}

let asked: DraftResumeDetail[]
let stop: () => void

const serve = (status: number, json: unknown) => vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ json: () => Promise.resolve(json), ok: status === 200, status })))

const open = (search: string, kind: DraftKind = 'blueprint', allowAdopt?: boolean) => {
  window.history.replaceState(null, '', `/blueprint-builder/compose${search}`)
  render(<Host allowAdopt={allowAdopt} kind={kind} />)
}

beforeEach(() => {
  installAntdShims()
  asked = []
  stop = onDraftResume((detail) => { asked.push(detail) })
})

afterEach(() => {
  stop()
  cleanup()
  vi.unstubAllGlobals()
})

describe('useDraftResume', () => {
  it('a failed read is a sentence, and the provider is asked nothing', async () => {
    serve(404, {})
    open('?resume=draft-blueprint-admin-payments-api')
    expect(await screen.findByText(/is not in your drafts any more/)).toBeTruthy()
    expect(asked).toEqual([])
    expect(window.location.search).toBe('')
  })

  it('an invalid name is ignored — nothing is read', () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    open('?resume=page-fleet')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('shows the replace prompt only when a draft is held, and sends replace only on "Close and resume"', async () => {
    serve(200, { data: { [DRAFT_RECORD_KEY]: JSON.stringify(record) } })
    open('?resume=draft-blueprint-admin-payments-api')
    await waitFor(() => expect(asked).toHaveLength(1))
    expect(asked[0].replace).toBeUndefined()
    expect(screen.queryByText(/to resume/)).toBeNull()

    act(() => { emitDraftResumeResult({ held: { kind: 'blueprint', name: 'catalog-service', previewed: false }, id: asked[0].id, outcome: 'held' }) })
    expect(await screen.findByText('Close catalog-service to resume payments-api?')).toBeTruthy()
    expect(screen.getByText(/catalog-service is saved in Your drafts, so closing it loses/)).toBeTruthy()
    expect(screen.getByText('catalog-service · Preview needed')).toBeTruthy()
    expect(screen.getByText('payments-api · ready to publish')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Close and resume' }))
    expect(asked).toHaveLength(2)
    expect(asked[1]).toMatchObject({ record, replace: true })

    act(() => { emitDraftResumeResult({ id: asked[1].id, outcome: 'resumed', previewed: true, relinked: true }) })
    expect(await screen.findByText(/^Restored from your drafts — last saved/)).toBeTruthy()
    expect(screen.getByText('The chart is exactly as you left it, and Undo starts here. Autopilot\'s thread is re-linked.')).toBeTruthy()
  })

  it('Cancel sends nothing', async () => {
    serve(200, { data: { [DRAFT_RECORD_KEY]: JSON.stringify(record) } })
    open('?resume=draft-blueprint-admin-payments-api')
    await waitFor(() => expect(asked).toHaveLength(1))
    act(() => { emitDraftResumeResult({ held: { kind: 'blueprint', name: 'catalog-service', previewed: true }, id: asked[0].id, outcome: 'held' }) })
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }))
    expect(asked).toHaveLength(1)
  })

  it('with nothing held, no prompt — the banner, saying to preview again when the hash did not match', async () => {
    serve(200, { data: { [DRAFT_RECORD_KEY]: JSON.stringify(record) } })
    open('?resume=draft-blueprint-admin-payments-api')
    await waitFor(() => expect(asked).toHaveLength(1))
    act(() => { emitDraftResumeResult({ id: asked[0].id, outcome: 'resumed', previewed: false, relinked: false }) })
    expect(await screen.findByText('The chart is exactly as you left it, and Undo starts here. It changed after its last Preview, so preview it again before publishing.')).toBeTruthy()
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('a record of the other kind is not loaded here', async () => {
    serve(200, { data: { [DRAFT_RECORD_KEY]: JSON.stringify({ ...record, kind: 'page', name: 'fleet' }) } })
    open('?resume=draft-page-admin-fleet')
    expect(await screen.findByText(/resume it from the Portal Builder/)).toBeTruthy()
    expect(asked).toEqual([])
  })

  it('an adoption whose read fails adopts nothing, and says why', async () => {
    serve(403, {})
    open('?adopt=page-fleet', 'page', true)
    expect(await screen.findByText(/Nothing was adopted: you are not allowed to read flexes\/page-fleet/)).toBeTruthy()
    expect(asked).toEqual([])
  })

  describe('?discard-legacy=', () => {
    let discards: LegacyDiscardDetail[]
    let stopDiscard: () => void
    beforeEach(() => {
      discards = []
      stopDiscard = onLegacyDiscard((detail) => { discards.push(detail) })
    })
    afterEach(() => { stopDiscard() })

    it('reads the whole set, asks for all of it to be deleted, and returns to the Portal Builder', async () => {
      vi.stubGlobal('fetch', serveLegacyPageSet())
      window.history.replaceState(null, '', '/portal-builder/compose?discard-legacy=page-fleet')
      render(<Host allowAdopt kind='page' />)
      await waitFor(() => expect(discards).toHaveLength(1))
      expect(discards[0].root).toBe('page-fleet')
      expect(discards[0].targets.map(({ name }) => name)).toEqual(['page-fleet', 'fleet-row', 'fleet-table', 'fleet-data'])
      expect(asked).toEqual([])
      act(() => { emitLegacyDiscardResult({ id: discards[0].id, message: 'Deleted page-fleet.', outcome: 'deleted' }) })
      expect(window.location.pathname).toBe('/portal-builder')
    })

    it('a failed delete stays and names what is left', async () => {
      vi.stubGlobal('fetch', serveLegacyPageSet())
      window.history.replaceState(null, '', '/portal-builder/compose?discard-legacy=page-fleet')
      render(<Host allowAdopt kind='page' />)
      await waitFor(() => expect(discards).toHaveLength(1))
      act(() => { emitLegacyDiscardResult({ id: discards[0].id, message: 'page-fleet was not deleted completely; still in the sandbox: rows/fleet-row.', outcome: 'failed' }) })
      expect(await screen.findByText(/still in the sandbox: rows\/fleet-row/)).toBeTruthy()
      expect(window.location.pathname).toBe('/portal-builder/compose')
    })

    it('refuses a root that belongs to a record — nothing is asked', async () => {
      const root = legacyPageSet['page-fleet'] as { metadata: Record<string, unknown> }
      vi.stubGlobal('fetch', serveLegacyPageSet({}, { 'page-fleet': { ...root, metadata: { ...root.metadata, labels: { ...PREVIEW_LABELS, 'krateo.io/draft-owner': 'admin' } } } }))
      window.history.replaceState(null, '', '/portal-builder/compose?discard-legacy=page-fleet')
      render(<Host allowAdopt kind='page' />)
      expect(await screen.findByText(/Nothing was deleted: page-fleet is the preview of a draft that already has an owner/)).toBeTruthy()
      expect(discards).toEqual([])
    })
  })
})
