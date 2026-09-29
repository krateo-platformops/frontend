/**
 * Adopting a legacy page set. What these pin:
 *   - the walk reads the root and every object it reaches IN THE SANDBOX (refs of refs, and a
 *     RESTAction apiRef), and never reads a widget placed from elsewhere;
 *   - the rebuilt tree is what the builder holds for a page (pageDraftFiles), with the sandbox's
 *     rewrite and the apiserver's bookkeeping gone;
 *   - only objects labelled as preview drafts are retired, one DELETE each, by exact name;
 *   - any failed read adopts NOTHING, and says which object and why;
 *   - the root is taken verbatim, and an owner-scoped preview root is refused.
 */
import { load } from 'js-yaml'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { legacyPageSet as objects, LEGACY_NS as NS, PREVIEW_LABELS as PREVIEW, serveLegacyPageSet as serve } from './__fixtures__/legacyPageSet'
import { adoptRootFrom, isLegacyRootName, legacyDeleteOps, readLegacyPageSet } from './adoptLegacyPage'

const readNames = (fetchMock: ReturnType<typeof serve>): string[] =>
  fetchMock.mock.calls.map(([input]) => new URL(input).searchParams.get('name') ?? '')

afterEach(() => { vi.unstubAllGlobals() })

describe('adopt link', () => {
  it('takes a page-<slug> root verbatim and nothing else', () => {
    expect(adoptRootFrom('?adopt=page-fleet')).toBe('page-fleet')
    expect(adoptRootFrom('?adopt=fleet')).toBeNull()
    expect(adoptRootFrom('?adopt=page-Fleet')).toBeNull()
    expect(isLegacyRootName(`page-${'a'.repeat(60)}`)).toBe(false)
  })
})

describe('readLegacyPageSet', () => {
  it('rebuilds the page the builder would hold from the root and everything it reaches in the sandbox', async () => {
    const fetchMock = serve()
    vi.stubGlobal('fetch', fetchMock)
    const read = await readLegacyPageSet('https://snowplow.test', NS, 'page-fleet')
    if (!read.ok) { throw new Error(read.message) }
    expect(readNames(fetchMock)).toEqual(['page-fleet', 'fleet-header', 'fleet-row', 'fleet-table', 'fleet-data'])
    expect(read.record).toMatchObject({ kind: 'page', name: 'fleet', state: 'open', updatedAt: '2026-09-18T10:00:00Z', version: 1 })
    expect(read.record.renderedHash).toBeUndefined()
    expect(Object.keys(read.record.files).sort()).toEqual([
      'Chart.yaml',
      'templates/_tiers.tpl',
      'templates/flex.page-fleet.yaml',
      'templates/pageheader.fleet-header.yaml',
      'templates/restaction.fleet-data.yaml',
      'templates/row.fleet-row.yaml',
      'templates/table.fleet-table.yaml',
      'values.schema.json',
      'values.yaml',
    ])
    const root = load(read.record.files['templates/flex.page-fleet.yaml']) as { metadata: Record<string, unknown>; spec: { resourcesRefs: { items: { name: string; namespace: string }[] } } }
    // The sandbox's rewrite and the apiserver's bookkeeping are gone; the author's annotation stays.
    expect(root.metadata).toEqual({ annotations: { 'krateo.io/nav-path': '/fleet' }, name: 'page-fleet', namespace: expect.stringContaining('page.tierNamespace') as string })
    const refs = Object.fromEntries(root.spec.resourcesRefs.items.map((item) => [item.name, item.namespace]))
    expect(refs['fleet-row']).toContain('page.tierNamespace')
    expect(refs['shared-notice']).toBe('krateo-system')
    const table = load(read.record.files['templates/table.fleet-table.yaml']) as Record<string, { apiRef?: unknown }>
    expect(table.status).toBeUndefined()
    expect(table.spec.apiRef).toEqual({ name: 'fleet-data', namespace: 'krateo-system' })
    // Retired: the objects a preview put there, by exact name — not the unlabelled header.
    expect(read.retire.map(({ gvr, name }) => `${gvr.resource}/${name}`)).toEqual(['flexes/page-fleet', 'rows/fleet-row', 'tables/fleet-table', 'restactions/fleet-data'])
  })

  it('adopts nothing when any read fails, and names the object', async () => {
    vi.stubGlobal('fetch', serve({ 'fleet-table': 404 }))
    const missing = await readLegacyPageSet('https://snowplow.test', NS, 'page-fleet')
    expect(missing).toEqual({ message: 'Nothing was adopted: tables/fleet-table is not in the sandbox any more. The old draft is still in the sandbox, unchanged.', ok: false })
    vi.stubGlobal('fetch', serve({ 'page-fleet': 403 }))
    expect(await readLegacyPageSet('https://snowplow.test', NS, 'page-fleet')).toEqual({ message: expect.stringContaining('not allowed to read flexes/page-fleet') as string, ok: false })
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('offline'))))
    expect(await readLegacyPageSet('https://snowplow.test', NS, 'page-fleet')).toEqual({ message: expect.stringContaining('offline') as string, ok: false })
  })

  it('refuses a root that is not a preview draft, or is an owner-scoped preview of a record', async () => {
    const root = objects['page-fleet'] as { metadata: Record<string, unknown> }
    vi.stubGlobal('fetch', serve({}, { 'page-fleet': { ...root, metadata: { ...root.metadata, labels: {} } } }))
    expect((await readLegacyPageSet('https://snowplow.test', NS, 'page-fleet')).ok).toBe(false)
    vi.stubGlobal('fetch', serve({}, { 'page-fleet': { ...root, metadata: { ...root.metadata, labels: { ...PREVIEW, 'krateo.io/draft-owner': 'admin' } } } }))
    expect(await readLegacyPageSet('https://snowplow.test', NS, 'page-fleet')).toEqual({ message: expect.stringContaining('already has an owner') as string, ok: false })
  })

  it('the same walk serves the legacy Discard, and says nothing was deleted when a read fails', async () => {
    vi.stubGlobal('fetch', serve({ 'fleet-row': 404 }))
    expect(await readLegacyPageSet('https://snowplow.test', NS, 'page-fleet', 'discard')).toEqual({
      message: 'Nothing was deleted: rows/fleet-row is not in the sandbox any more. The old draft is still in the sandbox, unchanged.',
      ok: false,
    })
  })

  it('reads nothing without a sandbox', async () => {
    const fetchMock = serve()
    vi.stubGlobal('fetch', fetchMock)
    expect((await readLegacyPageSet('https://snowplow.test', undefined, 'page-fleet')).ok).toBe(false)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('legacyDeleteOps', () => {
  it('is one DELETE per retired object, by exact name, in the sandbox, through /call', () => {
    const ops = legacyDeleteOps([
      { gvr: { group: 'widgets.templates.krateo.io', resource: 'flexes', version: 'v1beta1' }, name: 'page-fleet' },
      { gvr: { group: 'templates.krateo.io', resource: 'restactions', version: 'v1' }, name: 'fleet-data' },
    ], NS)
    expect(ops).toEqual([
      { path: '/call?apiVersion=widgets.templates.krateo.io%2Fv1beta1&resource=flexes&name=page-fleet&namespace=krateo-preview', verb: 'DELETE' },
      { path: '/call?apiVersion=templates.krateo.io%2Fv1&resource=restactions&name=fleet-data&namespace=krateo-preview', verb: 'DELETE' },
    ])
  })
})
