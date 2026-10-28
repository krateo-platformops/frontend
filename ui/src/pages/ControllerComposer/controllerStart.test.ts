/**
 * What a started CONTROLLER chart carries, pinned.
 *
 * The Marketplace's blueprints index (krateo-blueprints/charts publish-chart.yaml) refuses a chart
 * without an https icon: its release logs "it needs an https icon in Chart.yaml" and the index job is
 * skipped, so the chart is released to GHCR and silently left out of the Marketplace — nobody can
 * Install it from there. #454 gave the BLUEPRINT composer that icon and pinned it in startChart.test.ts;
 * the controller composer wrote none, so no controller could ever be listed. This pins the controller's.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { startController } from './controllerStart'

const SPEC = readFileSync(join(__dirname, '__fixtures__', 'petstore-v3.openapi.json'), 'utf8')

const started = (): Record<string, string> => {
  const result = startController({ apiGroup: 'petstore.example.io', baseUrl: 'https://petstore3.swagger.io/api/v3', name: 'petstore', paths: null, spec: SPEC })
  if (!result.ok) { throw new Error(JSON.stringify(result.problems)) }
  return result.files
}

describe('startController — the seeded chart', () => {
  it('Chart.yaml carries the brand icon the Marketplace index requires', () => {
    expect(started()['Chart.yaml']).toContain('icon: https://raw.githubusercontent.com/krateo-platformops/.github/main/brand/logo.svg\n')
  })

  it('writes the icon after the description and before the type, as Helm files read', () => {
    const chart = started()['Chart.yaml']
    expect(chart.indexOf('description:')).toBeLessThan(chart.indexOf('icon:'))
    expect(chart.indexOf('icon:')).toBeLessThan(chart.indexOf('type: application'))
  })

  it('leaves the rest of Chart.yaml as it was: name, version and the two controller annotations', () => {
    const chart = started()['Chart.yaml']
    expect(chart).toContain('name: petstore\n')
    expect(chart).toContain('controller.builders.krateo.io/api-group: petstore.example.io')
    expect(chart).toContain('controller.builders.krateo.io/base-url: https://petstore3.swagger.io/api/v3')
  })
})
