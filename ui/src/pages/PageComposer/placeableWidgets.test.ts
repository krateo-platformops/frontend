/**
 * The listing exists so "Place existing" offers at least the set the old `compose-page` card did —
 * retiring that card must not quietly narrow what a person can place. What is under test is the
 * contract with snowplow's `/list`, which replaced `restaction.page-composable` (deleted in
 * portal#245), and every way it can fail to hold.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

import { listPlaceableActions, listPlaceableWidgets } from './placeableWidgets'

const respond = (body: unknown, ok = true, status = 200) => {
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({
    json: () => Promise.resolve(body),
    ok,
    status,
  })))
}

afterEach(() => vi.unstubAllGlobals())

describe('listPlaceableWidgets', () => {
  /*
   * WHAT CHANGED AND WHY. This read a RESTAction — `page-composable` — because `/call` cannot list
   * a collection: snowplow's ParseNamespacedName refuses a request with no `name`, so the frontend
   * could fetch a named object and nothing else. The RA's api steps did the collection GETs, and
   * the cost was a hand-written list of SEVEN kinds living in the portal chart: a different repo,
   * released separately, failing silently apart — a kind it omitted was simply absent from the
   * palette with no error anywhere.
   *
   * `/list?category=widgets` discovers the GVRs server-side and lists each under the CALLER'S own
   * client. Every widget CRD declares `categories: [widgets, krateo]` — checked across all
   * forty-four — so one request returns everything the user may see, with nothing to keep in step.
   */
  it('asks snowplow to LIST the widgets category, in the draft namespace', async () => {
    respond([])
    await listPlaceableWidgets('http://snowplow/', 'krateo-system')

    const url = new URL((vi.mocked(fetch).mock.calls[0][0]) as string)
    expect(url.pathname).toBe('/list')
    expect(url.searchParams.get('category')).toBe('widgets')
    expect(url.searchParams.get('ns')).toBe('krateo-system')
  })

  it('reads a bare ARRAY of objects — /list is not an envelope and not a k8s List', async () => {
    respond([{ kind: 'Card', metadata: { name: 'a' } }])

    const result = await listPlaceableWidgets('http://snowplow', 'krateo-system')

    expect(result).toEqual({ ok: true, widgets: [{ name: 'a', resource: 'cards' }] })
  })

  it('derives the plural from the KIND through the generated table, never by guessing', async () => {
    // lowercase(kind)+"s" is wrong for a good number of them, and a wrong plural places a child its
    // parent will not declare — so it renders nothing and reports nothing.
    respond([
      { kind: 'Listy', metadata: { name: 'runs' } },
      { kind: 'PieChart', metadata: { name: 'split' } },
    ])

    const result = await listPlaceableWidgets('http://snowplow', 'krateo-system')

    expect(result).toEqual({ ok: true, widgets: [{ name: 'runs', resource: 'listies' }, { name: 'split', resource: 'piecharts' }] })
  })

  it('reaches kinds the old seven-kind RESTAction could never return', async () => {
    // The palette can place a BarChart now because the category discovers it, not because anybody
    // added it to a list.
    respond([{ kind: 'BarChart', metadata: { name: 'throughput' } }])

    await expect(listPlaceableWidgets('http://snowplow', 'krateo-system'))
      .resolves.toEqual({ ok: true, widgets: [{ name: 'throughput', resource: 'barcharts' }] })
  })

  it('drops a row this build cannot place, rather than guessing its plural', async () => {
    respond([
      { kind: 'Card', metadata: { name: 'a' } },
      { kind: 'SomethingNewerThanThisBuild', metadata: { name: 'b' } },
      { kind: 'Card', metadata: {} },
    ])

    const result = await listPlaceableWidgets('http://snowplow', 'krateo-system')

    expect(result).toEqual({ ok: true, widgets: [{ name: 'a', resource: 'cards' }] })
  })

  it('reports a 403 as content rather than throwing', async () => {
    // The listing runs under the caller's own client, so a 403 is a real and expected answer: this
    // user may not list these. An empty picker that does not say why is the failure to avoid.
    respond(null, false, 403)

    const result = await listPlaceableWidgets('http://snowplow', 'krateo-system')

    expect(result.ok).toBe(false)
    expect(result).toHaveProperty('error', expect.stringContaining('may not list'))
  })

  it('reports a shape it does not understand rather than showing an empty picker', async () => {
    respond({ status: {} })

    const result = await listPlaceableWidgets('http://snowplow', 'krateo-system')

    expect(result.ok).toBe(false)
  })

  it('reports an unreachable snowplow rather than rejecting', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('offline'))))

    await expect(listPlaceableWidgets('http://snowplow', 'krateo-system')).resolves.toMatchObject({ ok: false })
  })
})

describe('listPlaceableActions — the RESTAction picker', () => {
  /*
   * THE PICKER WAS EMPTY AND NOTHING SAID SO. The listing returned 85 objects with HTTP 200 and the
   * dropdown showed none, because the parse resolved a row's plural through `WIDGET_KINDS` — the
   * generated table of the forty-four WIDGET kinds. RESTAction is not one of them: it belongs to
   * templates.krateo.io, from snowplow's chart, while the generator reads helm/frontend-crds. So
   * every row failed the name-and-plural guard and was dropped silently.
   *
   * Silently is the operative word. An empty picker is exactly what an empty namespace looks like,
   * so there was no error to see and no symptom to chase — which is why this is pinned by the
   * SHAPE of a real listing response rather than by a hand-written row that happens to pass.
   */
  const restActionRow = (name: string) => ({
    apiVersion: 'templates.krateo.io/v1',
    kind: 'RESTAction',
    metadata: { name, namespace: 'krateo-system' },
    spec: { api: [] },
  })

  it('keeps RESTActions, which the widget table can never resolve', async () => {
    respond([restActionRow('pod-sizing'), restActionRow('platform-alerts')])
    const result = await listPlaceableActions('http://snowplow.test', 'krateo-system')

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.widgets).toEqual([
        { name: 'pod-sizing', resource: 'restactions' },
        { name: 'platform-alerts', resource: 'restactions' },
      ])
    }
  })

  it('asks for the ACTIONS category — the one the RESTAction CRD declares', async () => {
    respond([])
    await listPlaceableActions('http://snowplow.test', 'krateo-system')

    const url = String((globalThis.fetch as unknown as { mock: { calls: string[][] } }).mock.calls[0][0])
    expect(url).toContain('category=actions')
    expect(url).toContain('ns=krateo-system')
  })

  it('drops a row of some OTHER kind rather than mislabelling it a RESTAction', async () => {
    // The category is snowplow's, not ours: if something else ever declares it, a fixed plural
    // would place a child its parent cannot render.
    respond([{ apiVersion: 'x/v1', kind: 'Something', metadata: { name: 'n' } }])
    const result = await listPlaceableActions('http://snowplow.test', 'krateo-system')

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.widgets).toEqual([])
    }
  })

  it('names RESTActions in its refusal, not "widgets"', async () => {
    respond([], false, 403)
    const result = await listPlaceableActions('http://snowplow.test', 'krateo-system')

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toContain('RESTActions')
    }
  })
})
