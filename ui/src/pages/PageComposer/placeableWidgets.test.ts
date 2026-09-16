/**
 * The listing exists so "Place existing" offers the SAME set the old `compose-page` card did —
 * retiring that card must not quietly narrow what a person can place. So what is under test is the
 * contract with `restaction.page-composable`, and every way it can fail to hold.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

import { listPlaceableWidgets } from './placeableWidgets'

const respond = (body: unknown, ok = true, status = 200) => {
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({
    json: () => Promise.resolve(body),
    ok,
    status,
  })))
}

afterEach(() => vi.unstubAllGlobals())

describe('listPlaceableWidgets', () => {
  it('reads the jq output straight off .status, where snowplow puts it', async () => {
    // NOT .status.widgetData — that is the widget shape. A RESTAction's filter output lands in
    // .status itself, which is the contract callBlueprintRenderRA already relies on.
    respond({ status: { widgets: [{ id: 'cards/a', name: 'a', resource: 'cards' }] } })

    const result = await listPlaceableWidgets('http://snowplow', 'krateo-system')

    expect(result).toEqual({ ok: true, widgets: [{ name: 'a', resource: 'cards' }] })
  })

  it('calls the RESTAction over the same /call transport a widget uses', async () => {
    respond({ status: { widgets: [] } })
    await listPlaceableWidgets('http://snowplow/', 'krateo-system')

    const url = new URL((vi.mocked(fetch).mock.calls[0][0]) as string)
    expect(url.pathname).toBe('/call')
    expect(url.searchParams.get('resource')).toBe('restactions')
    expect(url.searchParams.get('name')).toBe('page-composable')
    expect(url.searchParams.get('namespace')).toBe('krateo-system')
  })

  it('drops a row missing its plural, which could never be placed', async () => {
    // A container that does not declare the child's plural renders nothing, so half an entry is
    // not placeable — omitting it from the picker beats placing something invisible.
    respond({ status: { widgets: [{ name: 'a', resource: 'cards' }, { name: 'b' }, { resource: 'tables' }] } })

    const result = await listPlaceableWidgets('http://snowplow', 'krateo-system')

    expect(result).toEqual({ ok: true, widgets: [{ name: 'a', resource: 'cards' }] })
  })

  it('reports a 403 as content rather than throwing', async () => {
    // Each step runs under the caller's own RBAC, so a 403 is a real and expected answer: this
    // user may not list these. An empty picker that does not say why is the failure to avoid.
    respond(null, false, 403)

    const result = await listPlaceableWidgets('http://snowplow', 'krateo-system')

    expect(result.ok).toBe(false)
    expect(result).toHaveProperty('error', expect.stringContaining('403'))
  })

  it('reports a RESTAction that is not installed', async () => {
    respond({ status: {} })

    const result = await listPlaceableWidgets('http://snowplow', 'krateo-system')

    expect(result.ok).toBe(false)
  })

  it('reports an unreachable snowplow rather than rejecting', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('offline'))))

    await expect(listPlaceableWidgets('http://snowplow', 'krateo-system')).resolves.toMatchObject({ ok: false })
  })
})
