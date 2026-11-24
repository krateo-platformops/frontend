// @vitest-environment jsdom
/**
 * frontend#496: the author's next visit to a builder removes the previews they abandoned. Every rule
 * that KEEPS something has a case here, because a wrong delete costs someone their page. The objects
 * are shaped as krateo-057's two leftovers were (a root, nested containers, a data source).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { RecordRead } from './draftResume'
import { ownerTagOf, sandboxDraftName } from './previewSandbox'
import { ABANDONED_AFTER_MS, pageOfRoot, planPreviewSweep, previewSweepSettled, resetPreviewSweep, startPreviewSweep, type SweepDeps, sweepOwnPreviews } from './previewSweep'

vi.mock('./kindResolver', () => ({
  pluralOf: (_api: string, kind: string) => ({ Card: 'cards', Flex: 'flexes', Row: 'rows', Table: 'tables' })[kind],
  primeKinds: () => Promise.resolve(),
}))

const NS = 'krateo-preview'
const ME = 'admin'
const NOW = Date.parse('2026-11-24T10:00:00Z')
const OLD = '2026-11-20T10:00:00Z'
const FRESH = '2026-11-24T09:00:00Z'
const API = 'widgets.templates.krateo.io/v1beta1'
const PLURAL: Record<string, string> = { Card: 'cards', Flex: 'flexes', RESTAction: 'restactions', Row: 'rows', Table: 'tables' }
const at = (name: string, owner = ME) => sandboxDraftName(name, owner)

interface Draft { apiRef?: string; created?: string; kind: string; labels?: Record<string, string>; name: string; owner?: string | null; refs?: [string, string][] }
const object = ({ apiRef, created = OLD, kind, labels, name, owner = ME, refs = [] }: Draft) => ({
  apiVersion: kind === 'RESTAction' ? 'templates.krateo.io/v1' : API,
  kind,
  metadata: {
    creationTimestamp: created,
    labels: labels ?? { 'krateo.io/purpose': 'preview-draft', ...(owner ? { 'krateo.io/draft-owner': owner } : {}) },
    name: owner ? at(name, owner) : name,
    namespace: NS,
  },
  spec: {
    ...(apiRef ? { apiRef: { name: at(apiRef), namespace: NS } } : {}),
    resourcesRefs: { items: refs.map(([refKind, refName]) => ({ apiVersion: API, name: at(refName), namespace: NS, resource: PLURAL[refKind] })) },
  },
})

/** A page as the sandbox holds it: root → row → card → table, whose rows come from a data source. */
const page = (name: string, created = OLD) => [
  object({ created, kind: 'Flex', name: `page-${name}`, refs: [['Row', `${name}-row`]] }),
  object({ created, kind: 'Row', name: `${name}-row`, refs: [['Card', `${name}-card`]] }),
  object({ created, kind: 'Card', name: `${name}-card`, refs: [['Table', `${name}-table`]] }),
  object({ apiRef: `${name}-data`, created, kind: 'Table', name: `${name}-table` }),
  object({ created, kind: 'RESTAction', name: `${name}-data` }),
]
const ALL = (name: string) => [`page-${name}`, `${name}-row`, `${name}-card`, `${name}-table`, `${name}-data`].map((each) => at(each)).sort()

const plan = (listed: ReturnType<typeof object>[], saved: Record<string, string>, heldPage?: string) =>
  planPreviewSweep(listed, { heldPage, now: NOW, owner: ME, sandboxNamespace: NS, savedAt: new Map(Object.entries(saved).map(([key, value]) => [key, Date.parse(value)])) })
const names = (listed: ReturnType<typeof object>[], saved: Record<string, string>, heldPage?: string) =>
  plan(listed, saved, heldPage).targets.map(({ name }) => name).sort()

describe('what a visit removes', () => {
  it('an abandoned page: every object of its set, its data source included, the root last', () => {
    expect(names(page('gke'), { gke: OLD })).toEqual(ALL('gke'))
    expect(plan(page('gke'), { gke: OLD }).targets.at(-1)?.name).toBe(at('page-gke'))
    expect(plan(page('gke'), { gke: OLD }).pages).toEqual(['gke'])
  })

  const keeps: [string, ReturnType<typeof object>[], Record<string, string>, string?][] = [
    ['no saved draft', page('gke'), {}],
    ['a draft saved within the day', page('gke'), { gke: FRESH }],
    ['a preview written within the day', page('gke', FRESH), { gke: OLD }],
    ['the draft held in this tab', page('gke'), { gke: OLD }, 'gke'],
    ['another person’s preview', [object({ kind: 'Flex', name: 'page-gke', owner: 'luca' })], { gke: OLD }],
    ['a preview with no owner (Unowned drafts)', [object({ kind: 'Flex', name: 'page-gke', owner: null })], { gke: OLD }],
    ['an object that is not a preview', [object({ kind: 'Flex', labels: { 'krateo.io/draft-owner': ME }, name: 'page-gke' })], { gke: OLD }],
    ['objects with no root of their own', page('gke').slice(1), { gke: OLD }],
    ['a root whose creation time cannot be read', [object({ created: 'soon', kind: 'Flex', name: 'page-gke' })], { gke: OLD }],
  ]
  for (const [why, listed, saved, held] of keeps) {
    it(`keeps: ${why}`, () => { expect(names(listed, saved, held)).toEqual([]) })
  }

  it('exactly a day is not yet more than a day', () => {
    const edge = new Date(NOW - ABANDONED_AFTER_MS).toISOString()
    expect(names(page('gke', edge), { gke: edge })).toEqual([])
  })

  it('an object a preview that stays still refers to stays', () => {
    const shared = [...page('gke'), object({ created: FRESH, kind: 'Flex', name: 'page-live', refs: [['Card', 'gke-card']] })]
    // The card keeps what it holds: the table and the data source behind it.
    expect(names(shared, { gke: OLD, live: FRESH })).toEqual([at('gke-row'), at('page-gke')].sort())
  })

  it('a child someone else owns, reached from an own page, is not removed', () => {
    const listed = page('gke').map((cr) => (cr.kind === 'Card' ? { ...cr, metadata: { ...cr.metadata, labels: { ...cr.metadata.labels, 'krateo.io/draft-owner': 'luca' } } } : cr))
    expect(names(listed, { gke: OLD })).toEqual([at('gke-row'), at('page-gke')].sort())
  })

  it('a name that was cut to fit reads as no page with a record, so its preview stays', () => {
    const long = 'a-page-with-a-name-that-does-not-fit-in-a-kubernetes-label-value'
    expect(pageOfRoot(at(`page-${long}`), ME)).not.toBe(long)
    expect(pageOfRoot(`page-gke-${ownerTagOf(ME)}`, ME)).toBe('gke')
    expect(pageOfRoot(`page-gke-${ownerTagOf('luca')}`, ME)).toBeNull()
    expect(names([object({ kind: 'Flex', name: `page-${long}` })], { [long]: OLD })).toEqual([])
  })
})

describe('the sweep', () => {
  type Writer = SweepDeps['writer']
  const handleActionSet = vi.fn<Writer['handleActionSet']>()
  const record = (name: string): Promise<RecordRead> => Promise.resolve({ ok: true, record: { files: {}, kind: 'page', name: name.replace('draft-page-admin-', ''), state: 'open', updatedAt: OLD, version: 1 } })
  let sandbox: { actions: unknown; widgets: unknown }
  const deps = (over: Partial<SweepDeps> = {}): SweepDeps => ({
    heldPage: () => undefined, now: () => NOW, readRecord: record, snowplowBaseUrl: 'http://sp', username: () => ME, writer: { handleActionSet, sandboxNamespace: NS }, ...over,
  })

  beforeEach(() => {
    sandbox = { actions: page('gke').slice(4), widgets: page('gke').slice(0, 4) }
    handleActionSet.mockReset()
    handleActionSet.mockImplementation((ops) => Promise.resolve(ops.map((_, index) => ({ index, message: '', ok: true, status: 200 }))))
    vi.stubGlobal('fetch', vi.fn((url: string) => {
      const category = new URL(url).searchParams.get('category') as 'actions' | 'widgets'
      const body = sandbox[category]
      return Promise.resolve(body === 'denied' ? new Response('', { status: 403 }) : new Response(JSON.stringify(body), { status: 200 }))
    }))
  })
  afterEach(() => {
    resetPreviewSweep()
    vi.unstubAllGlobals()
  })

  it('deletes through the audited set fabric, in the sandbox only, in sets the fabric accepts', async () => {
    sandbox.widgets = [...page('gke').slice(0, 4), ...page('xxx').slice(0, 4), ...page('yyy').slice(0, 4)]
    sandbox.actions = [...page('gke').slice(4), ...page('xxx').slice(4), ...page('yyy').slice(4)]
    expect(await sweepOwnPreviews(deps())).toEqual({ pages: ['gke', 'xxx', 'yyy'], removed: 15 })
    const sets = handleActionSet.mock.calls.map(([ops]) => ops)
    expect(sets.map((ops) => ops.length)).toEqual([10, 5])
    expect(sets.flat().every(({ path, verb }) => verb === 'DELETE' && path.includes(`namespace=${NS}`))).toBe(true)
    expect(handleActionSet.mock.calls[0][1]).toEqual({ silent: true, skipConfirmForSandbox: NS })
  })

  it('a refused removal stops before the roots, so the next visit finds the page again', async () => {
    handleActionSet.mockImplementation((ops) => Promise.resolve(ops.map((_, index) => ({ index, message: 'no', ok: false, status: 403 }))))
    sandbox.widgets = [...page('gke').slice(0, 4), ...page('xxx').slice(0, 4), ...page('yyy').slice(0, 4)]
    sandbox.actions = [...page('gke').slice(4), ...page('xxx').slice(4), ...page('yyy').slice(4)]
    expect(await sweepOwnPreviews(deps())).toBe('the sandbox refused a removal')
    expect(handleActionSet).toHaveBeenCalledOnce()
    expect(handleActionSet.mock.calls[0][0].some(({ path }) => /name=page-/.test(path))).toBe(false)
  })

  it('already gone is done', async () => {
    handleActionSet.mockImplementation((ops) => Promise.resolve(ops.map((_, index) => ({ index, message: 'not found', ok: false, status: 404 }))))
    expect(await sweepOwnPreviews(deps())).toEqual({ pages: ['gke'], removed: 0 })
  })

  const nothing: [string, () => Partial<SweepDeps>][] = [
    ['the widgets were not read', () => { sandbox.widgets = 'denied'; return {} }],
    ['the data sources were not read', () => { sandbox.actions = 'denied'; return {} }],
    ['the list is not a list', () => { sandbox.widgets = { items: [] }; return {} }],
    ['nobody is signed in', () => ({ username: () => undefined })],
    ['the record was not read', () => ({ readRecord: () => Promise.resolve({ message: 'gone', ok: false }) })],
    ['the record is another page’s', () => ({ readRecord: () => record('draft-page-admin-other') })],
    ['the draft is held here', () => ({ heldPage: () => 'gke' })],
  ]
  for (const [why, over] of nothing) {
    it(`writes nothing when ${why}`, async () => {
      await sweepOwnPreviews(deps(over()))
      expect(handleActionSet).not.toHaveBeenCalled()
    })
  }

  it('runs once per document, and a preview waits for it', async () => {
    let release: () => void = () => undefined
    handleActionSet.mockImplementation((ops) => new Promise((resolve) => {
      release = () => { resolve(ops.map((_, index) => ({ index, message: '', ok: true, status: 200 }))) }
    }))
    startPreviewSweep(deps())
    startPreviewSweep(deps())
    await vi.waitFor(() => { expect(handleActionSet).toHaveBeenCalledOnce() })
    let settled = false
    const waiting = previewSweepSettled().then(() => { settled = true })
    await Promise.resolve()
    expect(settled).toBe(false)
    release()
    await waiting
    expect(settled).toBe(true)
  })

  it('a preview does not wait when no sweep ran', async () => { await previewSweepSettled() })
})
