/**
 * Every Chart.yaml in this repository is RELEASED.
 *
 * The release workflow (the org reusable behind .github/workflows/release-oci.yaml) packages and
 * pushes every Chart.yaml it finds, not only the ones under helm/. A test fixture carrying one was
 * packaged on the 1.6.57 tag, its push was denied, and the job died before it pushed the frontend's
 * own two charts: the image shipped and its charts did not. A chart anywhere else is either a
 * release this repo does not own or a fixture that must not look like a chart.
 */
import { readdirSync } from 'node:fs'
import { join, relative } from 'node:path'

import { describe, expect, it } from 'vitest'

const ROOT = join(__dirname, '..', '..')
const SKIP = new Set(['node_modules', '.git', '.claude', 'dist', 'coverage'])

const chartFiles = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
  if (entry.isDirectory()) {
    return SKIP.has(entry.name) ? [] : chartFiles(join(dir, entry.name))
  }
  return entry.name === 'Chart.yaml' ? [relative(ROOT, join(dir, entry.name))] : []
})

describe('released charts', () => {
  it('are exactly the two under helm/ — nothing else in the repo looks like a chart', () => {
    expect(chartFiles(ROOT).sort()).toEqual(['helm/frontend-crds/Chart.yaml', 'helm/frontend/Chart.yaml'])
  })
})
