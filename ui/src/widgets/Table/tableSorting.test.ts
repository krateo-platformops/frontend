/**
 * tableSorting — inference-based client-side sorting (UX audit #13).
 *
 * Pure-logic coverage (no antd render) of the three pieces that make every
 * Table column sortable with ZERO schema/CRD changes:
 *   (1) the type SNIFFER (numeric / kubectl-age / ISO-date / string, from the
 *       raw dataSource values at the column's valueKey),
 *   (2) the RAW cell value extraction (tag label, bar percent, condition
 *       types — never the rendered node), and
 *   (3) the comparator (raw-value compare + missing-sorts-LAST in BOTH
 *       directions, exploiting antd's negate-on-descend + sortOrder arg).
 */

import { describe, expect, it } from 'vitest'

import type { TableCell, TableRow } from './tableSorting'
import { getCellSortValue, getColumnSortProps, parseAgeSeconds, sniffColumnType } from './tableSorting'

const numCell = (valueKey: string, numberValue?: number): TableCell => ({ kind: 'jsonSchemaType', numberValue, type: 'number', valueKey })
const strCell = (valueKey: string, stringValue?: string): TableCell => ({ kind: 'jsonSchemaType', stringValue, type: 'string', valueKey })
const tagCell = (valueKey: string, stringValue?: string): TableCell => ({ kind: 'tag', stringValue, valueKey })

describe('parseAgeSeconds — kubectl-style ages (the jq `def rel` format)', () => {
  it('parses every unit to seconds', () => {
    expect(parseAgeSeconds('45s')).toBe(45)
    expect(parseAgeSeconds('3m')).toBe(180)
    expect(parseAgeSeconds('8h')).toBe(28_800)
    expect(parseAgeSeconds('5d')).toBe(432_000)
    expect(parseAgeSeconds('1w')).toBe(604_800)
    expect(parseAgeSeconds('2mo')).toBe(5_184_000)
    expect(parseAgeSeconds('1y')).toBe(31_536_000)
  })

  it('parses "now" (formatRelativeTime emits it below 10s) as 0', () => {
    expect(parseAgeSeconds('now')).toBe(0)
  })

  it('rejects non-age strings', () => {
    expect(parseAgeSeconds('hello')).toBeUndefined()
    expect(parseAgeSeconds('8hx')).toBeUndefined()
    expect(parseAgeSeconds('mo')).toBeUndefined()
    expect(parseAgeSeconds('5 h')).toBeUndefined()
    expect(parseAgeSeconds('')).toBeUndefined()
  })
})

describe('sniffColumnType — column type inferred from raw values', () => {
  it('all-numeric values (numbers or numeric strings) → number', () => {
    expect(sniffColumnType([10, 2, 9])).toBe('number')
    expect(sniffColumnType(['10', '2', '-3.5'])).toBe('number')
    expect(sniffColumnType([10, '2'])).toBe('number')
  })

  it('placeholders ("-", "null", "n/a", "—") count as missing, so a numeric column stays numeric', () => {
    expect(sniffColumnType(['50', 'null', '1000', '-'])).toBe('number')
    expect(sniffColumnType(['8h', 'n/a', '5d', '—'])).toBe('age')
    expect(sniffColumnType(['-', 'null'])).toBe('string')
  })

  it('kubectl-style age strings → age', () => {
    expect(sniffColumnType(['8h', '5d', '1w', '45s', '2mo', '11h'])).toBe('age')
  })

  it('ISO-8601 date strings → date', () => {
    expect(sniffColumnType(['2026-07-01T10:15:00Z', '2026-06-30'])).toBe('date')
  })

  it('mixed or unparseable values → string', () => {
    expect(sniffColumnType(['8h', 'hello'])).toBe('string')
    expect(sniffColumnType([1, 'x1'])).toBe('string')
    expect(sniffColumnType(['2026-07-01', 'not-a-date'])).toBe('string')
    expect(sniffColumnType(['alpha', 'beta'])).toBe('string')
    expect(sniffColumnType([true, false])).toBe('string')
  })

  it('missing values (undefined / empty) are ignored; all-missing → string', () => {
    expect(sniffColumnType([undefined, '', '5'])).toBe('number')
    expect(sniffColumnType([undefined, '', undefined])).toBe('string')
    expect(sniffColumnType([])).toBe('string')
  })
})

describe('getCellSortValue — RAW dataSource value, never the rendered node', () => {
  it('a tag cell sorts by its label text', () => {
    expect(getCellSortValue(tagCell('status', 'Healthy'))).toBe('Healthy')
  })

  it('a bar cell sorts by its percent', () => {
    expect(getCellSortValue({ kind: 'bar', stringValue: '75', valueKey: 'sync' })).toBe(75)
    expect(getCellSortValue({ kind: 'bar', valueKey: 'sync' })).toBeUndefined()
  })

  it('a conditions cell sorts by its condition-type labels', () => {
    const cell: TableCell = {
      kind: 'conditions',
      stringValue: '[{"status":"True","type":"Ready"},{"status":"True","type":"Synced"}]',
      valueKey: 'conditions',
    }
    expect(getCellSortValue(cell)).toBe('Ready, Synced')
    expect(getCellSortValue({ kind: 'conditions', stringValue: 'not-json', valueKey: 'conditions' })).toBeUndefined()
  })

  it('jsonSchemaType cells sort by their typed raw value', () => {
    expect(getCellSortValue(numCell('replicas', 4))).toBe(4)
    expect(getCellSortValue(strCell('name', 'alpha'))).toBe('alpha')
    expect(getCellSortValue({ decimalValue: '3.14', kind: 'jsonSchemaType', type: 'decimal', valueKey: 'load' })).toBe(3.14)
    expect(getCellSortValue({ booleanValue: true, kind: 'jsonSchemaType', type: 'boolean', valueKey: 'ok' })).toBe(true)
    expect(getCellSortValue({ arrayValue: ['x1', 'x2'], kind: 'jsonSchemaType', type: 'array', valueKey: 'tags' })).toBe('x1, x2')
  })

  it('widget cells and missing cells have no comparable value', () => {
    expect(getCellSortValue({ kind: 'widget', resourceRefId: 'ref-1', valueKey: 'chart' })).toBeUndefined()
    expect(getCellSortValue(undefined)).toBeUndefined()
  })
})

describe('getColumnSortProps — sorter + numeric right-alignment', () => {
  const rowsOf = (cells: TableCell[]): TableRow[] => cells.map((cell) => [cell])

  it('a numeric column compares numerically (not lexicographically) and right-aligns', () => {
    const rows = rowsOf([numCell('replicas', 10), numCell('replicas', 2), numCell('replicas', 9)])
    const { align, sorter } = getColumnSortProps(rows, 'replicas')
    expect(align).toBe('right')
    const sorted = [...rows].sort((ra, rb) => sorter(ra, rb, 'ascend'))
    expect(sorted.map((row) => row[0].numberValue)).toEqual([2, 9, 10])
  })

  it('an age column compares by parsed seconds and right-aligns', () => {
    const rows = rowsOf([strCell('age', '8h'), strCell('age', '2d'), strCell('age', '30m')])
    const { align, sorter } = getColumnSortProps(rows, 'age')
    expect(align).toBe('right')
    const sorted = [...rows].sort((ra, rb) => sorter(ra, rb, 'ascend'))
    // lexicographic would give 2d, 30m, 8h — parsed seconds give 30m, 8h, 2d
    expect(sorted.map((row) => row[0].stringValue)).toEqual(['30m', '8h', '2d'])
  })

  it('an ISO-date column compares by Date, left-aligned', () => {
    const rows = rowsOf([
      strCell('created', '2026-07-02T09:00:00Z'),
      strCell('created', '2026-07-01T10:15:00Z'),
    ])
    const { align, sorter } = getColumnSortProps(rows, 'created')
    expect(align).toBeUndefined()
    expect(sorter(rows[0], rows[1], 'ascend')).toBeGreaterThan(0)
  })

  it('a string column falls back to localeCompare, left-aligned', () => {
    const rows = rowsOf([strCell('name', 'beta'), strCell('name', 'alpha')])
    const { align, sorter } = getColumnSortProps(rows, 'name')
    expect(align).toBeUndefined()
    expect(sorter(rows[0], rows[1], 'ascend')).toBeGreaterThan(0)
    expect(sorter(rows[1], rows[0], 'ascend')).toBeLessThan(0)
  })

  it('missing values sort LAST in BOTH directions (pre-negated for antd descend)', () => {
    const [missing, present] = rowsOf([numCell('replicas', undefined), numCell('replicas', 5)])
    const { sorter } = getColumnSortProps([missing, present], 'replicas')
    // ascend: positive → missing after present
    expect(sorter(missing, present, 'ascend')).toBeGreaterThan(0)
    // descend: antd NEGATES the result, so a negative here still lands missing last
    expect(sorter(missing, present, 'descend')).toBeLessThan(0)
    expect(sorter(missing, missing, 'ascend')).toBe(0)
  })
})
