// @vitest-environment jsdom
/**
 * ONE RESTACTION, TWO WIDGETS — without opening Files.
 *
 * Found filming a "Pod sizing" page: a PieChart and a Table over the SAME RESTAction, which the
 * draft itself carries. The Table's Data modal wrote the RESTAction; the pie's could not pick it,
 * because "Use one that exists" listed only the cluster, and a RESTAction authored in this draft is
 * not on the cluster until the page publishes. The filmer hand-wrote the pie's apiRef in Files.
 *
 * And once picked, the pie's template row started on `dataSource` — a Table's field. A PieChart's
 * records are `data`; a template for a path the kind does not have renders an empty chart.
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { load } from 'js-yaml'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import { pageDraftFiles } from '../../components/Autopilot/pageDraft'

import { installAntdShims } from './composerTestHarness'
import { DataBindingModal } from './DataBindingModal'

const listPlaceableActions = vi.fn()
vi.mock('./placeableWidgets', () => ({
  ACTION_CATEGORY: 'actions',
  listPlaceableActions: (...args: unknown[]) => listPlaceableActions(...args) as unknown,
  listPlaceableWidgets: () => Promise.resolve({ ok: true, widgets: [] }),
}))

beforeAll(installAntdShims)
afterEach(() => {
  cleanup()
  listPlaceableActions.mockReset()
})

/** The held files of the Pod-sizing page as the builder holds them — templated namespace and all. */
const podSizing = () => pageDraftFiles([
  {
    apiVersion: 'widgets.templates.krateo.io/v1beta1',
    kind: 'Flex',
    metadata: { name: 'page-pod-sizing', namespace: 'krateo-system' },
    spec: {
      resourcesRefs: {
        items: [
          { id: 'p', name: 'sizing-pie', namespace: 'krateo-system', resource: 'piecharts' },
          { id: 't', name: 'sizing-table', namespace: 'krateo-system', resource: 'tables' },
        ],
      },
      widgetData: { items: [{ resourceRefId: 'p' }, { resourceRefId: 't' }] },
    },
  },
  {
    apiVersion: 'templates.krateo.io/v1',
    kind: 'RESTAction',
    metadata: { name: 'pod-sizing', namespace: 'krateo-system' },
    spec: { api: [{ name: 'pods', path: '/api/v1/pods' }], filter: '{ byVerdict: [], rows: [] }' },
  },
  {
    apiVersion: 'widgets.templates.krateo.io/v1beta1',
    kind: 'PieChart',
    metadata: { name: 'sizing-pie', namespace: 'krateo-system' },
    spec: { widgetData: { angleField: 'count', colorField: 'verdict', data: [] } },
  },
]) ?? {}

const pieYaml = (files: Record<string, string>): string =>
  Object.entries(files).find(([path]) => path.includes('piechart.sizing-pie'))?.[1] ?? ''

const mount = (files: Record<string, string>, onDone = vi.fn()) => {
  render(
    <DataBindingModal
      files={files}
      namespace='krateo-system'
      onCancel={vi.fn()}
      onDone={onDone}
      open
      snowplowBaseUrl='http://snowplow.test'
      widgetName='sizing-pie'
      widgetYaml={pieYaml(files)}
    />,
  )
  return onDone
}

/** Open the antd Select and return the dropdown's text. */
const openPicker = async (): Promise<string> => {
  // antd 6: the single Select's clickable node is `.ant-select-content`.
  const picker = document.querySelector('.ant-select .ant-select-content')
  fireEvent.mouseDown(picker as Element)
  await waitFor(() => expect(document.querySelector('.ant-select-dropdown')).toBeTruthy())
  // The rendered rows, in order — group headings and options alike. The dropdown's raw
  // textContent also carries rc-select's hidden a11y list, which is not the visual order.
  return [...document.querySelectorAll('.ant-select-dropdown .ant-select-item')]
    .map((row) => row.textContent ?? '').join(' | ')
}

describe('"Use one that exists" offers the draft\'s own RESTActions', () => {
  it('lists them FIRST, in their own group, before the cluster\'s', async () => {
    listPlaceableActions.mockResolvedValue({ ok: true, widgets: [{ name: 'cluster-pods', resource: 'restactions' }] })
    const files = podSizing()
    expect(pieYaml(files)).toContain('kind: PieChart')
    mount(files)
    await waitFor(() => expect(listPlaceableActions).toHaveBeenCalled())

    const shown = await openPicker()
    expect(shown).toContain('In this draft')
    expect(shown).toContain('On the cluster')
    expect(shown.indexOf('In this draft')).toBeLessThan(shown.indexOf('pod-sizing'))
    expect(shown.indexOf('pod-sizing')).toBeLessThan(shown.indexOf('On the cluster'))
    expect(shown.indexOf('On the cluster')).toBeLessThan(shown.indexOf('cluster-pods'))
  })

  it('still offers them when the cluster listing FAILS — they need no request', async () => {
    listPlaceableActions.mockResolvedValue({ error: 'you may not list RESTActions in this namespace', ok: false })
    mount(podSizing())
    await waitFor(() => expect(screen.getByText('you may not list RESTActions in this namespace')).toBeTruthy())

    const shown = await openPicker()
    expect(shown).toContain('In this draft')
    expect(shown).toContain('pod-sizing')
  })

  it('binds the pie to it: apiRef in the page namespace, and data ← a field of its output', async () => {
    listPlaceableActions.mockResolvedValue({ ok: true, widgets: [] })
    const onDone = mount(podSizing())
    await openPicker()
    fireEvent.click(screen.getByTitle('pod-sizing'))

    // The template row opens on the PIE's data field, not a Table's `dataSource`.
    fireEvent.click(screen.getByText('What fills the widget'))
    const path = await screen.findByLabelText('widgetData path 1')
    expect((path as HTMLInputElement).value).toBe('data')
    fireEvent.change(screen.getByLabelText('expression 1'), { target: { value: '.byVerdict' } })

    fireEvent.click(screen.getByText('Apply'))

    expect(onDone).toHaveBeenCalledTimes(1)
    const [[result]] = onDone.mock.calls as [[{ restAction?: unknown; widgetYaml: string }]]
    // Nothing new to add: the RESTAction is already a file in the draft.
    expect(result.restAction).toBeUndefined()
    const { spec } = (load(result.widgetYaml) as { spec: Record<string, unknown> })
    // The draft's file carries the TEMPLATED namespace; the apiRef names the place instead.
    expect(spec.apiRef).toEqual({ name: 'pod-sizing', namespace: 'krateo-system' })
    // The `${ }` wrapper is snowplow's jq contract, added when the author omits it.
    // eslint-disable-next-line no-template-curly-in-string
    expect(spec.widgetDataTemplate).toEqual([{ expression: '${ .byVerdict }', forPath: 'data' }])
  })

  it('keeps a cluster pick distinct from a draft one of the same name', async () => {
    // An earlier publish of this page puts the same name on the cluster. A bare-name value made the
    // two ONE option; each group's row must select only itself.
    listPlaceableActions.mockResolvedValue({ ok: true, widgets: [{ name: 'pod-sizing', resource: 'restactions' }] })
    mount(podSizing())
    await waitFor(() => expect(listPlaceableActions).toHaveBeenCalled())
    await openPicker()
    await waitFor(() => expect(document.querySelectorAll('.ant-select-item-option[title="pod-sizing"]')).toHaveLength(2))
    fireEvent.click(document.querySelectorAll('.ant-select-item-option[title="pod-sizing"]')[1])

    await openPicker()
    const rows = [...document.querySelectorAll('.ant-select-item-option[title="pod-sizing"]')]
    expect(rows.map((row) => row.classList.contains('ant-select-item-option-selected'))).toEqual([false, true])
  })
})
