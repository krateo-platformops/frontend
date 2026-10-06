/**
 * The visual-regression baselines are only comparable when the browser and its fonts are identical,
 * so the Playwright container in CI (.github/workflows/design-system.yaml) and the one
 * ui/visual/docker.sh runs locally must be the version @playwright/test is pinned to. docker.sh reads
 * package.json; the workflow cannot, so this keeps the two in step.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

const UI = join(__dirname, '..', '..')

describe('visual regression runs in one Playwright version', () => {
  it('the CI container image matches the pinned @playwright/test', () => {
    const pkg = JSON.parse(readFileSync(join(UI, 'package.json'), 'utf8')) as { devDependencies: Record<string, string> }
    const workflow = readFileSync(join(UI, '..', '.github', 'workflows', 'design-system.yaml'), 'utf8')
    const pinned = pkg.devDependencies['@playwright/test']
    expect(pinned, 'pin an exact version: a range lets the local container and CI drift apart').toMatch(/^\d+\.\d+\.\d+$/)
    expect(workflow).toContain(`mcr.microsoft.com/playwright:v${pinned}-`)
  })
})
