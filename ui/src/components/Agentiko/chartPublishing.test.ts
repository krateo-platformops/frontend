/**
 * The krateo-blueprints publishing standard's Chart.yaml fields (chartPublishing.ts), pinned for
 * each builder's freshly started chart, and the fill a publish runs (withPublishingFields): every
 * field still missing is added, and nothing an author wrote is overwritten.
 *
 * Keywords are Marketplace filter chips, so a fresh chart carries exactly ONE: its kind. A word true
 * of every chart (`krateo`, `helm`, `chart`) filters nothing, and is never seeded.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { load } from 'js-yaml'
import { describe, expect, it } from 'vitest'

import { startChart } from '../../pages/BlueprintBuilder/startChart'
import { startController } from '../../pages/ControllerBuilder/controllerStart'

import { CHART_ICON, KRATEO_KIND_ANNOTATION, withPublishingFields } from './chartPublishing'
import { pageDraftFiles } from './pageDraft'

interface ChartDoc { annotations?: Record<string, string>; icon?: unknown; keywords?: unknown; name?: unknown; sources?: unknown }

const chartOf = (files: Record<string, string>): ChartDoc => load(files['Chart.yaml']) as ChartDoc

const blueprint = (): Record<string, string> => {
  const result = startChart({ description: 'Orders', name: 'orders-api', version: '0.1.0' })
  if (!result.ok) { throw new Error(JSON.stringify(result.problems)) }
  return result.files
}

const controller = (): Record<string, string> => {
  const spec = readFileSync(join(__dirname, '..', '..', 'pages', 'ControllerBuilder', '__fixtures__', 'petstore-v3.openapi.json'), 'utf8')
  const result = startController({ apiGroup: 'petstore.example.io', baseUrl: 'https://petstore3.swagger.io/api/v3', name: 'petstore', paths: null, spec })
  if (!result.ok) { throw new Error(JSON.stringify(result.problems)) }
  return result.files
}

const pageSet = (): Record<string, string> => {
  const files = pageDraftFiles([{ apiVersion: 'widgets.templates.krateo.io/v1beta1', kind: 'Flex', metadata: { name: 'page-fleet-health', namespace: 'krateo-system' }, spec: { widgetData: { items: [] } } }])
  if (!files) { throw new Error('fixture page refused') }
  return files
}

describe.each([
  { builder: 'Blueprint Composer', keyword: 'blueprint', start: blueprint },
  { builder: 'Controller Builder', keyword: 'controller', start: controller },
  { builder: 'Portal Builder (page set)', keyword: 'page-set', start: pageSet },
])('a freshly started $builder chart', ({ keyword, start }) => {
  it(`seeds exactly one keyword, its kind: ${keyword}`, () => {
    expect(chartOf(start()).keywords).toEqual([keyword])
  })

  it('seeds none of the words true of every chart', () => {
    const keywords = chartOf(start()).keywords as string[]
    for (const generic of ['krateo', 'helm', 'chart']) {
      expect(keywords).not.toContain(generic)
    }
  })

  it('carries an https icon', () => {
    const { icon } = chartOf(start())
    expect(icon).toBe(CHART_ICON)
    expect(String(icon)).toMatch(/^https:\/\//)
  })

  it('carries no sources yet: the repository is confirmed at publish', () => {
    expect(chartOf(start()).sources).toBeUndefined()
  })
})

describe('the page set annotation', () => {
  it('a page set is annotated krateo.io/kind: page-set, which routes it to the pages channel', () => {
    expect(chartOf(pageSet()).annotations).toEqual({ [KRATEO_KIND_ANNOTATION]: 'page-set' })
  })

  it('a blueprint and a controller are not', () => {
    expect(chartOf(blueprint()).annotations?.[KRATEO_KIND_ANNOTATION]).toBeUndefined()
    expect(chartOf(controller()).annotations?.[KRATEO_KIND_ANNOTATION]).toBeUndefined()
  })
})

const REPO = 'https://github.com/acme/orders-api'

/** A Chart.yaml with every start-time field already present, so only `sources` can be missing. */
const COMPLETE = `apiVersion: v2\nname: x\nicon: ${CHART_ICON}\nversion: 1.0.0\nkeywords:\n  - blueprint\n`

describe('withPublishingFields — sources: the publishing repository, merged into the author\'s Chart.yaml', () => {
  it('appends only sources to a freshly started chart of each builder, and changes nothing else', () => {
    for (const [kind, files] of [['blueprint', blueprint()], ['controller', controller()], ['page', pageSet()]] as const) {
      expect(withPublishingFields(files['Chart.yaml'], kind, REPO)).toBe(`${files['Chart.yaml']}sources:\n  - ${REPO}\n`)
    }
  })

  it('fills an empty sources key', () => {
    expect(withPublishingFields(`${COMPLETE}sources:\n`, 'blueprint', REPO)).toBe(`${COMPLETE}sources:\n  - ${REPO}\n`)
  })

  it('keeps the author\'s sources, first, and adds the repository after them', () => {
    const authored = `${COMPLETE}# where it came from\nsources:\n  - https://example.com/upstream # vendor\n`
    const merged = withPublishingFields(authored, 'blueprint', REPO)
    expect((load(merged) as ChartDoc).sources).toEqual(['https://example.com/upstream', REPO])
    expect(merged).toContain('# where it came from\n')
    expect(merged).toContain('# vendor')
  })

  it('returns the bytes unchanged when sources already names the repository, however it is spelled', () => {
    for (const spelled of [REPO, `${REPO}/`, `${REPO}.git`, 'https://github.com/ACME/orders-api']) {
      const authored = `${COMPLETE}sources:\n  - ${spelled}\n`
      expect(withPublishingFields(authored, 'blueprint', REPO)).toBe(authored)
    }
  })

  it('is idempotent: a second publish of a published Chart.yaml lists the repository once', () => {
    const once = withPublishingFields(blueprint()['Chart.yaml'], 'blueprint', REPO)
    const twice = withPublishingFields(once, 'blueprint', REPO)
    expect(twice).toBe(once)
    expect((load(twice) as ChartDoc).sources).toEqual([REPO])
  })

  it('leaves a sources that is not a list, and a Chart.yaml that does not parse, as the author wrote them', () => {
    for (const authored of [`${COMPLETE}sources: https://example.com/a\n`, `${COMPLETE}sources:\n  a: b\n`, 'name: [x\n', '- not a mapping\n']) {
      expect(withPublishingFields(authored, 'blueprint', REPO)).toBe(authored)
    }
  })
})

/** Chart.yaml as each builder wrote it BEFORE the start-time fields existed. */
const OLD_BLUEPRINT = 'apiVersion: v2\nname: orders-api\n# the team that owns it\ndescription: Orders\ntype: application\nversion: 0.1.0\n'
const OLD_CONTROLLER = 'apiVersion: v2\nname: petstore\ndescription: Krateo controller, served in petstore.example.io.\ntype: application\nversion: 0.1.0\nannotations:\n  controller.builders.krateo.io/api-group: petstore.example.io\n'
const OLD_PAGE_SET = 'apiVersion: v2\nappVersion: CHART_VERSION\ndescription: Krateo Composable Portal pages — fleet-health.\nname: fleet-health\ntype: application\nversion: CHART_VERSION\n'

describe('withPublishingFields — a draft started before the start-time fields gets every missing one', () => {
  it('a blueprint: icon, its keyword and sources, appended after the author\'s bytes', () => {
    expect(withPublishingFields(OLD_BLUEPRINT, 'blueprint', REPO))
      .toBe(`${OLD_BLUEPRINT}icon: ${CHART_ICON}\nkeywords:\n  - blueprint\nsources:\n  - ${REPO}\n`)
  })

  it('a controller: the same, its own annotations kept and no page-set kind added', () => {
    const chart = load(withPublishingFields(OLD_CONTROLLER, 'controller', REPO)) as ChartDoc
    expect(chart).toMatchObject({ icon: CHART_ICON, keywords: ['controller'], sources: [REPO] })
    expect(chart.annotations).toEqual({ 'controller.builders.krateo.io/api-group': 'petstore.example.io' })
  })

  it('a page set: icon, keyword, sources and krateo.io/kind: page-set', () => {
    const chart = load(withPublishingFields(OLD_PAGE_SET, 'page', REPO)) as ChartDoc
    expect(chart).toMatchObject({ annotations: { [KRATEO_KIND_ANNOTATION]: 'page-set' }, icon: CHART_ICON, keywords: ['page-set'], sources: [REPO] })
  })

  it('a page set whose annotations lack the kind gets it beside the author\'s own', () => {
    const chart = load(withPublishingFields(`${OLD_PAGE_SET}annotations:\n  team: fleet\n`, 'page', REPO)) as ChartDoc
    expect(chart.annotations).toEqual({ [KRATEO_KIND_ANNOTATION]: 'page-set', team: 'fleet' })
  })

  it('an empty keyword list and an empty icon count as missing', () => {
    const chart = load(withPublishingFields('apiVersion: v2\nname: x\nicon: ""\nversion: 1.0.0\nkeywords: []\n', 'blueprint', REPO)) as ChartDoc
    expect(chart).toMatchObject({ icon: CHART_ICON, keywords: ['blueprint'] })
  })
})

describe('withPublishingFields — an author\'s values are never overwritten', () => {
  const AUTHORED_PAGE_SET = `apiVersion: v2\nname: fleet-health\nicon: https://example.com/fleet.png # ours\nversion: CHART_VERSION\nkeywords:\n  - observability\nannotations:\n  ${KRATEO_KIND_ANNOTATION}: dashboards\nsources:\n  - ${REPO}\n`

  it('with nothing missing, the Chart.yaml is committed byte for byte', () => {
    expect(withPublishingFields(AUTHORED_PAGE_SET, 'page', REPO)).toBe(AUTHORED_PAGE_SET)
  })

  it('a non-empty keyword list without the kind, an author\'s icon and an author\'s kind stay when sources is filled', () => {
    const authored = AUTHORED_PAGE_SET.replace(`sources:\n  - ${REPO}\n`, '')
    expect(withPublishingFields(authored, 'page', REPO)).toBe(`${authored}sources:\n  - ${REPO}\n`)
  })
})
