/**
 * Every widget, from its own example CR, in both themes. See main.tsx for the harness and
 * playwright.config.ts for why this runs only in the Playwright container.
 *
 * A diff here is a visual change. If it is intended, regenerate with `npm run visual:update` and
 * commit the PNGs; the reviewer then sees the before/after in the PR's file diff.
 */
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { expect, test } from '@playwright/test'
import Ajv from 'ajv'
import { loadAll } from 'js-yaml'

/**
 * Widgets screenshotted, and which documents of their example file. The first document is often
 * an edge case (an empty array, a missing action) that only shows an error state; these indices
 * pick the representative ones. Edge cases are what the unit tests are for.
 */
const CASES: Record<string, number[]> = {
  Alert: [0, 1],
  Badge: [0, 1],
  Breadcrumb: [0],
  Button: [1, 2, 3],
  Card: [2, 4],
  Checkbox: [0],
  DatePicker: [0],
  Descriptions: [0],
  Divider: [0, 1],
  Input: [0],
  InputNumber: [0],
  List: [0],
  Markdown: [5],
  Paragraph: [3],
  Progress: [0, 1],
  QRCode: [0],
  Radio: [0],
  Result: [0, 1],
  Select: [0],
  Slider: [0],
  Statistic: [0],
  Steps: [0, 1],
  Switch: [0],
  Table: [3],
  Tag: [0, 1],
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
const WIDGETS = fileURLToPath(new URL('../src/widgets', import.meta.url))

test('every screenshotted example is valid against its own widget schema', () => {
  // A screenshot of an example the CRD would reject pins down an API that does not exist. This is
  // not hypothetical: when this suite was written, 46 of 166 example documents failed their schema,
  // and every Table example used `data`, which the widget no longer reads, so they rendered empty.
  const ajv = new Ajv({ allErrors: true, strict: false })
  const invalid = Object.entries(CASES).flatMap(([folder, docs]) => {
    // The schema file is named for the CRD kind, which is not always the folder (List holds Listy).
    const schemaFile = readdirSync(`${WIDGETS}/${folder}`).find((name) => name.endsWith('.schema.json'))
    const schema = JSON.parse(readFileSync(`${WIDGETS}/${folder}/${schemaFile}`, 'utf8')) as { properties: { spec: { properties: { widgetData: object } } } }
    const examples = (loadAll(readFileSync(`${EXAMPLES}/${folder}/${folder}.example.yaml`, 'utf8')) as Array<{ spec: { widgetData: unknown } } | null>).filter(Boolean)
    return docs.filter((doc) => !ajv.validate(schema.properties.spec.properties.widgetData, examples[doc]?.spec.widgetData ?? {}))
      .map((doc) => `${folder} #${doc}: ${ajv.errorsText()}`)
  })
  expect(invalid).toEqual([])
})

test('every widget with an example is screenshotted or excluded with a reason', () => {
  const kinds = readdirSync(EXAMPLES, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name)
  const unaccounted = kinds.filter((kind) => !(kind in CASES) && !(kind in EXCLUDED))
  expect(unaccounted, 'add it to CASES, or to EXCLUDED with the reason').toEqual([])
})

for (const [kind, docs] of Object.entries(CASES)) {
  for (const doc of docs) {
    for (const mode of ['light', 'dark'] as const) {
      test(`${kind} #${doc} · ${mode}`, async ({ page }) => {
        const errors: string[] = []
        page.on('pageerror', (error) => errors.push(error.message))

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
