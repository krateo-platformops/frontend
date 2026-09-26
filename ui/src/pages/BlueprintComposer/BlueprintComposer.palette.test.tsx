// @vitest-environment jsdom
/**
 * Screen 4 — the palette: three classes, discovered from the cluster AS THE PERSON, each failure a
 * sentence. The RESTAction and the CRDs are answered by URL (routeFetch); the status is the
 * blueprint-palette filter's output over the krateo-057 dump, sliced to four groups.
 */
import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { AUTOPILOT_PREVIEW_FILES_BATCH_EVENT, type FilesBatchDetail } from '../../components/Autopilot/previewFilesBatch'
import { graphDouble } from '../../components/DependencyGraph/flowGraphDouble'
import { invalidateAccessTokenCache } from '../../utils/getAccessToken'

import { PALETTE_STATUS } from './__fixtures__/s4a'
import { COMPOSITIONS_DENIED, CUSTOM_DENIED, PALETTE_NOT_CONFIGURED, PALETTE_RA_MISSING } from './blueprintPalette'
import { hold, installAntdShims, installScrollShim, listen, mount, mountWithConfig, routeFetch, seededChart } from './blueprintTestHarness'

vi.mock('@ant-design/graphs', () => import('../../components/DependencyGraph/flowGraphDouble'))
vi.mock('@antv/g6-extension-react', () => ({ ReactNode: vi.fn() }))

beforeAll(() => {
  installAntdShims()
  installScrollShim()
})
beforeEach(() => {
  graphDouble.reset()
  invalidateAccessTokenCache()
  localStorage.setItem('K_user', JSON.stringify({ accessToken: 'tok-admin' }))
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  localStorage.clear()
  invalidateAccessTokenCache()
})

const PALETTE_URL = 'name=blueprint-palette'
const palette = () => screen.getByRole('region', { name: 'Add' })
const section = (name: string) => within(palette()).getByRole('group', { name })
const rowNames = (name: string) => within(section(name)).getAllByRole('button').map((button) => button.getAttribute('aria-label'))

/** Mount on a held chart with the palette answered as `status`, and wait for the read to land. */
const open = async (status: unknown = PALETTE_STATUS, chart = 'orders') => {
  const fetched = routeFetch({ [PALETTE_URL]: { body: { status }, status: 200 } })
  mountWithConfig()
  hold(seededChart(chart))
  await waitFor(() => expect(section('Custom resources').getAttribute('aria-busy')).toBeNull())
  return fetched
}

describe('BlueprintComposer — the palette (screen 4)', () => {
  it('1. the native section: the nine, in the mockup\'s order, each named with its readiness', async () => {
    await open()
    expect(within(section('Kubernetes native')).getByText('9')).toBeTruthy()
    expect(rowNames('Kubernetes native')).toEqual([
      'Deployment · apps/v1 · available',
      'StatefulSet · apps/v1 · ready replicas',
      'Service · v1 · has endpoints',
      'ConfigMap · v1 · exists',
      'Secret · v1 · exists',
      'Ingress · networking/v1 · lb address',
      'PersistentVolumeClaim · v1 · bound',
      'Job · batch/v1 · complete',
      'CronJob · batch/v1 · exists',
    ])
  })

  it('2. custom: "N kinds · M groups", groups closed; "git" matches two groups and opens both, each labelled by its owner', async () => {
    await open()
    const custom = section('Custom resources')
    expect(within(custom).getByText('72 kinds · 4 groups')).toBeTruthy()
    const github = within(custom).getByRole('button', { name: /github\.krateo\.io/ })
    expect(github.getAttribute('aria-expanded')).toBe('false')
    act(() => { fireEvent.change(within(palette()).getByLabelText('Filter by kind or group'), { target: { value: 'git' } }) })
    expect(within(palette()).getByText('2 groups match')).toBeTruthy()
    const groups = within(section('Custom resources')).getAllByRole('button', { expanded: true })
    expect(groups.map((group) => group.textContent)).toEqual(['▾git.krateo.iogit-provider-crd · 2', '▾github.krateo.iogithub-provider-kog · 58'])
    expect(within(section('Custom resources')).getByText('github-provider-kog · 58')).toBeTruthy()
    expect(within(section('Custom resources')).getByText('git-provider-crd · 2')).toBeTruthy()
    expect(within(section('Custom resources')).getByText('1 cluster-scoped kinds are not listed: a composition\'s resources live in its own namespace.')).toBeTruthy()
  })

  it('3. the Repository row says its version and the readiness field its CRD declares', async () => {
    await open()
    act(() => { within(section('Custom resources')).getByRole('button', { name: /github\.krateo\.io/ }).click() })
    const row = within(section('Custom resources')).getByRole('button', { name: 'Repository · v2022-11-28 · default_branch' })
    expect(row.querySelectorAll('span')[1].textContent).toBe('v2022-11-28 · default_branch')
  })

  it('4. a blueprint row: name → Kind · version · N running — and no count where none could be made', async () => {
    await open()
    expect(within(section('Krateo compositions')).getByText('3 installed')).toBeTruthy()
    expect(rowNames('Krateo compositions')).toEqual([
      'aws-rds-stack → AwsRdsStack · v0-3-0 · 3 running',
      'builder-publish → BuilderPublish · v1-8-40 · 23 running',
      'mongodb → Mongodb · v0-1-2',
    ])
  })

  it('5. crds 403: the custom sentence, while native and compositions still render', async () => {
    await open({ ...PALETTE_STATUS, custom: { error: { code: 403, message: 'forbidden', reason: 'Forbidden' } } })
    expect(within(section('Custom resources')).getByText(CUSTOM_DENIED)).toBeTruthy()
    expect(rowNames('Kubernetes native')).toHaveLength(9)
    expect(rowNames('Krateo compositions')).toHaveLength(3)
  })

  it('6. compdefs 403 (cyberjoker): the compositions sentence', async () => {
    await open({ ...PALETTE_STATUS, compositions: { error: { code: 403, message: 'forbidden', reason: 'Forbidden' } } })
    expect(within(section('Krateo compositions')).getByText(COMPOSITIONS_DENIED)).toBeTruthy()
    expect(within(section('Krateo compositions')).queryAllByRole('button')).toEqual([])
    expect(within(section('Custom resources')).getByText('72 kinds · 4 groups')).toBeTruthy()
  })

  it('7. the RESTAction 404s: ONE sentence for the pane — and a native kind still places', async () => {
    routeFetch({})
    const batches = listen<FilesBatchDetail>(AUTOPILOT_PREVIEW_FILES_BATCH_EVENT)
    mountWithConfig()
    hold(seededChart())
    await waitFor(() => expect(within(palette()).getByText(PALETTE_RA_MISSING)).toBeTruthy())
    expect(within(palette()).getAllByText(PALETTE_RA_MISSING)).toHaveLength(1)
    expect(within(palette()).queryByRole('group', { name: 'Custom resources' })).toBeNull()
    act(() => { within(section('Kubernetes native')).getByRole('button', { name: /^ConfigMap/ }).click() })
    batches.stop()
    expect(batches.seen).toHaveLength(1)
    expect(Object.keys(batches.seen[0].add ?? {})).toEqual(['templates/configmap.yaml'])
  })

  it('8. no config: the not-configured sentence, and nothing is fetched', async () => {
    const fetched = routeFetch({})
    mount()
    hold(seededChart())
    await waitFor(() => expect(within(palette()).getByText(PALETTE_NOT_CONFIGURED)).toBeTruthy())
    expect(fetched).not.toHaveBeenCalled()
  })

  it('9. nesting the chart into itself: said beside the row, refused when tried, and no batch is emitted', async () => {
    const fetched = await open(PALETTE_STATUS, 'builder-publish')
    expect(within(section('Krateo compositions')).getByText('Nesting the chart you are composing (builder-publish into builder-publish) is refused as a cycle when you try it — the same kernel that refuses a cyclic edge.')).toBeTruthy()
    const batches = listen<FilesBatchDetail>(AUTOPILOT_PREVIEW_FILES_BATCH_EVENT)
    act(() => { within(section('Krateo compositions')).getByRole('button', { name: /^builder-publish/ }).click() })
    batches.stop()
    expect(within(palette()).getByRole('alert').textContent).toContain('Nesting builder-publish into builder-publish is refused as a cycle — a blueprint cannot contain itself.')
    expect(batches.seen).toEqual([])
    // Refused before any read: the CRD was never asked for.
    expect(fetched.mock.calls.map(([url]) => url).filter((url) => url.includes('customresourcedefinitions'))).toEqual([])
  })

  it('10. while listing, the discovered sections are busy and say so', async () => {
    let release: (answer: { status: number; body: unknown }) => void = () => undefined
    routeFetch({ [PALETTE_URL]: () => new Promise((resolve) => { release = resolve }) })
    mountWithConfig()
    hold(seededChart())
    expect(section('Custom resources').getAttribute('aria-busy')).toBe('true')
    expect(section('Krateo compositions').getAttribute('aria-busy')).toBe('true')
    expect(within(section('Custom resources')).getByText('Listing what you may place…')).toBeTruthy()
    await act(async () => {
      release({ body: { status: PALETTE_STATUS }, status: 200 })
      await Promise.resolve()
    })
    await waitFor(() => expect(section('Custom resources').getAttribute('aria-busy')).toBeNull())
  })

  it('11. the request: /call for the RESTAction in the frontend namespace, with the person\'s own bearer', async () => {
    const fetched = await open()
    const [url, init] = fetched.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('http://snowplow/call?resource=restactions&apiVersion=templates.krateo.io%2Fv1&name=blueprint-palette&namespace=krateo-system')
    expect(init).toEqual({ headers: { Authorization: 'Bearer tok-admin' } })
  })

  it('nothing matches the filter: said', async () => {
    await open()
    act(() => { fireEvent.change(within(palette()).getByLabelText('Filter by kind or group'), { target: { value: 'zzz' } }) })
    expect(within(palette()).getByText('Nothing matches “zzz”.')).toBeTruthy()
  })
})
