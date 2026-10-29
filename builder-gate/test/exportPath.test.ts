/**
 * The Table export's jq `path`, EVALUATED — not pattern-matched (frontend#541).
 *
 * WHY THIS LIVES HERE. The expression ships from `ui/src/widgets/Table/tableExport.ts`, but the ui
 * test suite has no jq, so its guard asserted the STRING: that it contained `(.valueKey)` and
 * matched no `.[N]`. That guard passed while the expression was wrong in two ways snowplow caught
 * on review — it read the `/call` body as a bare array when it is the resolved widget object, and
 * its `//` chain treated a boolean `false` as absent. A wrong root satisfies both string
 * assertions perfectly.
 *
 * builder-gate has `jqcheck`, built against the same gojq fork snowplow's go.mod replaces gojq
 * with, so here the expression can be RUN against a realistic body and judged by what it produces.
 */
import { EXPORT_PATH } from '@frontend/widgets/Table/tableExport'
import { describe, expect, it } from 'vitest'

import { join } from 'node:path'

import { jqcheckEngine } from '../src/jq'

const jq = jqcheckEngine(process.env.JQCHECK_BIN ?? join(__dirname, '..', 'bin', 'jqcheck'))

/** A `/call` answer: the resolved widget object, which is what the export's read actually returns. */
const body = (rows: unknown[][]) => ({
  apiVersion: 'widgets.templates.krateo.io/v1beta1',
  kind: 'Table',
  status: { widgetData: { columns: [{ title: 'Name', valueKey: 'name' }], dataSource: rows } },
})

const cell = (valueKey: string, field: string, value: unknown) => ({ kind: 'jsonSchemaType', valueKey, [field]: value })

const run = async (rows: unknown[][]) => {
  const result = await jq.eval(EXPORT_PATH, body(rows))
  expect(result.ok, result.ok ? '' : `jq failed: ${'error' in result ? result.error : ''}`).toBe(true)
  return (result as { value: unknown }).value
}

describe('it reads the real /call envelope', () => {
  it('finds the rows under .status.widgetData.dataSource', async () => {
    // The bug that shipped: a leading `.[]` read the widget OBJECT as an array and produced
    // nothing at all, so every export would have been empty.
    await expect(run([[cell('name', 'stringValue', 'alpha')]])).resolves.toEqual([{ name: 'alpha' }])
  })

  it('yields an empty array for a table with no rows, not an error', async () => {
    await expect(run([])).resolves.toEqual([])
  })

  it('keeps one object per row, in row order', async () => {
    await expect(run([
      [cell('name', 'stringValue', 'alpha')],
      [cell('name', 'stringValue', 'beta')],
    ])).resolves.toEqual([{ name: 'alpha' }, { name: 'beta' }])
  })
})

describe('it picks a cell\'s one populated field, including the falsy ones', () => {
  it('keeps a boolean FALSE — the bug the `//` chain had', async () => {
    // `//` treats false as absent, so this exported as null and a column of booleans lost every
    // `false` in it. The exported file was valid and quietly wrong, which is the worst shape.
    await expect(run([[cell('ready', 'booleanValue', false)]])).resolves.toEqual([{ ready: false }])
  })

  it('keeps a numeric ZERO and an EMPTY STRING, for the same reason', async () => {
    await expect(run([[cell('count', 'numberValue', 0)]])).resolves.toEqual([{ count: 0 }])
    await expect(run([[cell('note', 'stringValue', '')]])).resolves.toEqual([{ note: '' }])
  })

  it('keeps a boolean TRUE and ordinary values', async () => {
    await expect(run([[cell('ready', 'booleanValue', true)]])).resolves.toEqual([{ ready: true }])
    await expect(run([[cell('cpu', 'decimalValue', '1.5')]])).resolves.toEqual([{ cpu: '1.5' }])
  })

  it('keeps arrayValue as an ARRAY, which csv JSON-encodes losslessly', async () => {
    await expect(run([[cell('ips', 'arrayValue', ['10.0.0.1', '10.0.0.2'])]])).resolves.toEqual([{ ips: ['10.0.0.1', '10.0.0.2'] }])
  })

  it('gives a value-less cell a null, and KEEPS its key — what labelled json promises', async () => {
    // snowplow's contract: rows keep every field, so a consumer must not read null as absent.
    await expect(run([[{ kind: 'jsonSchemaType', valueKey: 'blank' }]])).resolves.toEqual([{ blank: null }])
  })
})

describe('it selects by valueKey rather than by position', () => {
  it('keys each cell by its own valueKey, whatever order the cells arrive in', async () => {
    const rows = [[cell('phase', 'stringValue', 'Running'), cell('name', 'stringValue', 'alpha')]]
    await expect(run(rows)).resolves.toEqual([{ name: 'alpha', phase: 'Running' }])
  })

  it('carries every cell a row has, including one no column declared', async () => {
    // `fields` is what narrows the output; the path's job is only to make the cells addressable.
    const rows = [[cell('name', 'stringValue', 'alpha'), cell('ns', 'stringValue', 'team-a')]]
    await expect(run(rows)).resolves.toEqual([{ name: 'alpha', ns: 'team-a' }])
  })
})
