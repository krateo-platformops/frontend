/**
 * Every widget, from its own example CR, in both themes. See main.tsx for the harness and
 * playwright.config.ts for why this runs only in the Playwright container.
 *
 * A diff here is a visual change. If it is intended, regenerate with `npm run visual:update` and
 * commit the PNGs; the reviewer then sees the before/after in the PR's file diff.
 */
import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { expect, test } from '@playwright/test'

/**
 * Widgets screenshotted, and which documents of their example file. The first document is often
 * an edge case (an empty array, a missing action) that only shows an error state; these indices
 * pick the representative ones. Edge cases are what the unit tests are for.
 */
const CASES: Record<string, number[]> = {
  Alert: [0, 1],
  Badge: [0, 1],
  Breadcrumb: [0],
  Button: [1, 2, 3, 34],
  Card: [2, 4, 16],
  Checkbox: [0],
  Collapse: [0],
  DatePicker: [0],
  Descriptions: [0],
  Divider: [0, 1],
  Input: [0],
  InputNumber: [0],
  List: [0],
  Markdown: [5],
  Paragraph: [3, 6],
  Progress: [0, 1],
  QRCode: [0],
  Radio: [0],
  Result: [0, 1],
  // Every document: the default, icons with a disabled segment, icon-only round, and block width.
  Segmented: [0, 1, 2, 3],
  Select: [0],
  Slider: [0],
  Statistic: [0],
  Steps: [0, 1],
  Switch: [0],
  Table: [3],
  Tag: [0, 1],
  // Docs 0 and 1: the plain vertical rail, then colours + icons + a `loading` node. The loading
  // node is safe to pin because the config screenshots with `animations: 'disabled'`, so the
  // spinner is frozen rather than caught mid-rotation.
  //
  // NOT doc 2, and not because it is redundant: it is `mode: alternate` with an INLINE CHILD
  // WIDGET, and this spec mocks nothing (layout.spec.ts is the one that `page.route`s widget
  // refs). So the referenced markdown cannot resolve here and the node renders without it — the
  // picture would contradict the example's own stated expectation, "the second node shows the
  // referenced markdown widget under its text", and pin a half-rendered example as correct.
  // Screenshot it when this spec can serve a ref, not before.
  Timeline: [0, 1],
  // All three: nested and fully open; lines, palette icons, a selected node and an inert one; a
  // fixed height with a folded branch, a disabled root and an orphan drawn at the root.
  Tree: [0, 1, 2],
  YamlViewer: [3],
}

/** Widgets with an example that are NOT screenshotted, and why. A new example must land in one list. */
const EXCLUDED: Record<string, string> = {
  BarChart: 'chart: animated drawing, covered by its own unit tests',
  ButtonGroup: 'container: its buttons are child widgets fetched by reference',
  Col: 'container: renders child widgets fetched by reference',
  Filters: 'bound to a sibling widget fetched by reference',
  Flex: 'container: renders child widgets fetched by reference',
  FlowChart: 'graph layout is computed at runtime and is not pixel-stable',
  Form: 'renders a schema fetched from the cluster',
  Layout: 'container: renders child widgets fetched by reference',
  LineChart: 'chart: animated drawing, covered by its own unit tests',
  PieChart: 'chart: animated drawing, covered by its own unit tests',
  Row: 'container: renders child widgets fetched by reference',
  Tabs: 'container: each tab renders a child widget fetched by reference',
  Upload: 'its picture variants load images from the network',
}

const EXAMPLES = fileURLToPath(new URL('../src/examples/widgets', import.meta.url))
// Every example, screenshotted or not, is validated against its own kind's schema by
// src/test/widgetExamples.test.ts, so a picture here is never of a CR the apiserver would reject.

test('every widget with an example is screenshotted or excluded with a reason', () => {
  const kinds = readdirSync(EXAMPLES, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name)
  const unaccounted = kinds.filter((kind) => !(kind in CASES) && !(kind in EXCLUDED))
  expect(unaccounted, 'add it to CASES, or to EXCLUDED with the reason').toEqual([])
})

/**
 * AND THE REASON HAS TO BE TRUE, wherever it is checkable.
 *
 * REQUIRING A REASON AND VERIFYING A REASON ARE DIFFERENT THINGS, and the first reads exactly like
 * the second. The test above stops a widget being dropped from the pixel suite silently, which is
 * worth having — but it proves only that someone TYPED a justification, while a reviewer seeing a
 * populated `EXCLUDED` entry naturally infers that someone CHECKED one.
 *
 * That gap was live here, not hypothetical. All three charts are excluded as "covered by its own
 * unit tests", and LineChart and PieChart had no test file at all — so the pixel gate was
 * delegating to a gate that did not exist, and both looked closed because each was assumed to be
 * the other's cover. A reason that names another gate is the most dangerous kind precisely because
 * it IS machine-checkable, which is why nobody thought to check it.
 *
 * So: an exclusion that delegates to unit tests must have unit tests to delegate to.
 */
const WIDGETS = fileURLToPath(new URL('../src/widgets', import.meta.url))

test('an EXCLUDED reason that delegates to unit tests has unit tests to delegate to', () => {
  const delegating = Object.entries(EXCLUDED).filter(([, reason]) => reason.includes('unit tests')).map(([kind]) => kind)

  // Vacuity guard, same reasoning as the rest of this file: this check keys on the reason WORDING,
  // so rewording an exclusion would empty the list and leave the assertion below passing over
  // nothing. A check that has stopped looking is worse than no check.
  expect(delegating.length, 'no EXCLUDED reason mentions "unit tests" any more — reword this check to match, do not delete it').toBeGreaterThan(0)

  const uncovered = delegating.filter((kind) => !readdirSync(join(WIDGETS, kind)).some((file) => file.includes('.test.')))
  expect(uncovered, 'excluded from the pixel suite as covered by its unit tests, but no *.test.* file exists in its widget directory').toEqual([])
})

// Every example renders against one fixed "now". The dates design writes a time relative to now
// ("13 Jun, 09:30" this year, "13 Jun 2026, 09:30" from next year on, "52 minutes ago"), so with the
// real clock a baseline would change on its own: every new year, or every minute for an ago.
const FIXED_NOW = new Date('2026-11-25T21:00:00Z')

for (const [kind, docs] of Object.entries(CASES)) {
  for (const doc of docs) {
    for (const mode of ['light', 'dark'] as const) {
      test(`${kind} #${doc} · ${mode}`, async ({ page }) => {
        const errors: string[] = []
        page.on('pageerror', (error) => errors.push(error.message))

        await page.clock.setFixedTime(FIXED_NOW)
        await page.goto(`/visual/index.html?example=${kind}&doc=${doc}&mode=${mode}`)
        const shot = page.getByTestId('case')
        await expect(shot).toBeVisible()
        // The harness says so when it cannot find or resolve the example; never screenshot that.
        await expect(page.getByTestId('missing')).toHaveCount(0)
        await page.waitForLoadState('networkidle')
        await page.evaluate(() => document.fonts.ready)

        // A widget that throws while rendering its own example is a defect, not a picture.
        expect(errors).toEqual([])
        await expect(shot).toHaveScreenshot(`${kind}-${doc}-${mode}.png`)
      })
    }
  }
}
