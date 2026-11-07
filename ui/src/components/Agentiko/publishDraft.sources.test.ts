/**
 * The publishing fields in the COMMITTED Chart.yaml (the krateo-blueprints publishing standard).
 * `sources` is the repository a chart is published from, written at publish from the confirmed
 * destination: the repository is not known when a chart starts, so no start can write it. The kind's
 * keyword, the icon and a page set's krateo.io/kind are filled at publish too when missing, so a draft
 * started before they existed is not refused at its first release. The blueprints index publishes the
 * archive release-oci packs from the committed tree, so nothing after the publish can add them.
 *
 * `buildClaimPublish` is mocked: what is under test is the Chart.yaml this function hands it.
 */
import { load } from 'js-yaml'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./builderClaimPublish', () => ({
  buildClaimPublish: vi.fn(() => Promise.resolve({ branch: 'builder/x', compiled: { denial: null, ops: [] }, deepLink: null })),
}))

import { startChart } from '../../pages/BlueprintBuilder/startChart'

import { createBlueprintDraftStore } from './blueprintDraftStore'
import { buildClaimPublish } from './builderClaimPublish'
import type { BuilderTargets } from './builderTargets'
import { pageDraftFiles } from './pageDraft'
import { runDraftPublish, type PublishDraftDeps } from './publishDraft'

const NONE = { owner: '', repo: '' }

const TARGETS: BuilderTargets = {
  blueprint: { owner: 'krateo-blueprints', repo: '<chart>' },
  blueprintTemplate: NONE,
  kog: NONE,
  kogTemplate: NONE,
  page: { owner: 'acme', repo: 'portal' },
  pageTemplate: NONE,
}

const startedChart = (): Record<string, string> => {
  const started = startChart({ description: '', name: 'orders-api', version: '1.4.2' })
  if (!started.ok) { throw new Error('fixture chart refused') }
  return started.files
}

const depsHolding = (files: Record<string, string>, kind: 'blueprint' | 'page', host = 'github.com'): PublishDraftDeps => {
  const store = createBlueprintDraftStore()
  store.set(files, kind)
  return {
    blueprintGate: { evaluate: () => ({ allowed: true, reason: null }) },
    blueprintStore: store,
    builderTargets: TARGETS,
    config: { api: { AUTOPILOT_GIT_HOST: host } },
    origin: { prompt: null, sessionId: null },
  } as unknown as PublishDraftDeps
}

/** The Chart.yaml the n-th publish handed the claim. */
const committedChart = (call = 0): string => {
  const [args] = vi.mocked(buildClaimPublish).mock.calls[call]
  const chart = args.files.find((file) => file.path === 'Chart.yaml')
  expect(chart).toBeDefined()
  return chart!.content
}

const sourcesOf = (chartYaml: string): unknown => (load(chartYaml) as { sources?: unknown }).sources

beforeEach(() => { vi.mocked(buildClaimPublish).mockClear() })

describe('a publish writes the confirmed repository into Chart.yaml sources', () => {
  it('a blueprint: https://github.com/<owner>/<repo> of the destination, appended to the held bytes', async () => {
    const files = startedChart()
    await runDraftPublish(depsHolding(files, 'blueprint'), { verb: 'publishBlueprint' })
    // Headless, the confirmed destination is the prefill: the install's owner, and the chart's own repository.
    expect(vi.mocked(buildClaimPublish).mock.calls[0][0].dest).toMatchObject({ owner: 'krateo-blueprints', repo: 'orders-api' })
    expect(committedChart()).toBe(`${files['Chart.yaml']}sources:\n  - https://github.com/krateo-blueprints/orders-api\n`)
  })

  it('a page set: the same, for its own repository', async () => {
    const files = pageDraftFiles([{ apiVersion: 'widgets.templates.krateo.io/v1beta1', kind: 'Flex', metadata: { name: 'page-fleet-health', namespace: 'krateo-system' }, spec: { widgetData: { items: [] } } }])
    if (!files) { throw new Error('fixture page refused') }
    await runDraftPublish(depsHolding(files, 'page'), { verb: 'publishPage' })
    expect(sourcesOf(committedChart())).toEqual(['https://github.com/acme/fleet-health'])
  })

  it('names the repository on the install\'s git host', async () => {
    await runDraftPublish(depsHolding(startedChart(), 'blueprint', 'git.example.com'), { verb: 'publishBlueprint' })
    expect(sourcesOf(committedChart())).toEqual(['https://git.example.com/krateo-blueprints/orders-api'])
  })

  it('keeps the author\'s sources and adds the repository once', async () => {
    const files = startedChart()
    files['Chart.yaml'] = `${files['Chart.yaml']}# upstream it wraps\nsources:\n  - https://example.com/upstream\n`
    await runDraftPublish(depsHolding(files, 'blueprint'), { verb: 'publishBlueprint' })
    const committed = committedChart()
    expect(sourcesOf(committed)).toEqual(['https://example.com/upstream', 'https://github.com/krateo-blueprints/orders-api'])
    expect(committed).toContain('# upstream it wraps\n')
  })

  it('an author sources that already names the repository is committed unchanged', async () => {
    const files = startedChart()
    files['Chart.yaml'] = `${files['Chart.yaml']}sources:\n  - https://github.com/krateo-blueprints/orders-api\n`
    await runDraftPublish(depsHolding(files, 'blueprint'), { verb: 'publishBlueprint' })
    expect(committedChart()).toBe(files['Chart.yaml'])
  })

  it('publishing twice lists the repository once each time, and leaves the held draft as it was', async () => {
    const files = startedChart()
    const deps = depsHolding(files, 'blueprint')
    await runDraftPublish(deps, { verb: 'publishBlueprint' })
    await runDraftPublish(deps, { verb: 'publishBlueprint' })
    expect(sourcesOf(committedChart(0))).toEqual(['https://github.com/krateo-blueprints/orders-api'])
    expect(committedChart(1)).toBe(committedChart(0))
    expect(deps.blueprintStore.get()?.files['Chart.yaml']).toBe(files['Chart.yaml'])
  })
})

describe('a publish fills every other publishing field that is missing, and overwrites none', () => {
  /** Chart.yaml as the Blueprint Composer wrote it before keywords and the icon existed. */
  const OLD_CHART = 'apiVersion: v2\nname: orders-api\ntype: application\nversion: 1.4.2\n'

  it('an old-style draft with none of them gets the icon, its keyword and sources', async () => {
    await runDraftPublish(depsHolding({ ...startedChart(), 'Chart.yaml': OLD_CHART }, 'blueprint'), { verb: 'publishBlueprint' })
    const committed = committedChart()
    expect(committed.startsWith(OLD_CHART)).toBe(true)
    expect(load(committed)).toMatchObject({
      icon: 'https://raw.githubusercontent.com/krateo-platformops/.github/main/brand/logo.svg',
      keywords: ['blueprint'],
      sources: ['https://github.com/krateo-blueprints/orders-api'],
    })
  })

  it('a chart with the author\'s own keywords and icon, and nothing missing, is committed byte for byte', async () => {
    const authored = `${OLD_CHART}icon: https://example.com/orders.png\nkeywords:\n  - payments\nsources:\n  - https://github.com/krateo-blueprints/orders-api\n`
    await runDraftPublish(depsHolding({ ...startedChart(), 'Chart.yaml': authored }, 'blueprint'), { verb: 'publishBlueprint' })
    expect(committedChart()).toBe(authored)
  })
})
