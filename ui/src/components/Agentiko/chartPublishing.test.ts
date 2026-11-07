/**
 * The krateo-blueprints publishing standard's Chart.yaml fields (chartPublishing.ts), pinned for
 * each builder's freshly started chart, and the `sources` merge a publish runs (withChartSource).
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

import { CHART_ICON, KRATEO_KIND_ANNOTATION, withChartSource } from './chartPublishing'
import { pageDraftFiles } from './pageDraft'

interface ChartDoc { annotations?: Record<string, string>; icon?: unknown; keywords?: unknown; sources?: unknown }

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

describe('withChartSource — the publishing repository, merged into the author\'s Chart.yaml', () => {
  it('appends sources to a chart without any, and changes nothing else', () => {
    for (const files of [blueprint(), controller(), pageSet()]) {
      expect(withChartSource(files['Chart.yaml'], REPO)).toBe(`${files['Chart.yaml']}sources:\n  - ${REPO}\n`)
    }
  })

  it('fills an empty sources key', () => {
    expect(withChartSource('name: x\nsources:\n', REPO)).toBe(`name: x\nsources:\n  - ${REPO}\n`)
  })

  it('keeps the author\'s sources, first, and adds the repository after them', () => {
    const authored = 'name: x\n# where it came from\nsources:\n  - https://example.com/upstream # vendor\nversion: 1.0.0\n'
    const merged = withChartSource(authored, REPO)
    expect((load(merged) as ChartDoc).sources).toEqual(['https://example.com/upstream', REPO])
    expect(merged).toContain('# where it came from\n')
    expect(merged).toContain('# vendor')
  })

  it('returns the bytes unchanged when sources already names the repository, however it is spelled', () => {
    for (const spelled of [REPO, `${REPO}/`, `${REPO}.git`, 'https://github.com/ACME/orders-api']) {
      const authored = `name: x\nsources:\n  - ${spelled}\n`
      expect(withChartSource(authored, REPO)).toBe(authored)
    }
  })

  it('is idempotent: a second publish of a published Chart.yaml lists the repository once', () => {
    const once = withChartSource(blueprint()['Chart.yaml'], REPO)
    const twice = withChartSource(once, REPO)
    expect(twice).toBe(once)
    expect((load(twice) as ChartDoc).sources).toEqual([REPO])
  })

  it('leaves a sources that is not a list, and a Chart.yaml that does not parse, as the author wrote them', () => {
    for (const authored of ['name: x\nsources: https://example.com/a\n', 'name: x\nsources:\n  a: b\n', 'name: [x\n', '- not a mapping\n']) {
      expect(withChartSource(authored, REPO)).toBe(authored)
    }
  })
})
