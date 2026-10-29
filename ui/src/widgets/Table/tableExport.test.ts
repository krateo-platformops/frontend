/**
 * `buildExportRequest` — the two 400s snowplow has, and the cases it deliberately allows.
 *
 * These pin snowplow's contract as of #980/1.12.62, confirmed with that session rather than read
 * off a docs page. The two refusals are the only ones, so everything else here asserts that a
 * shape which LOOKS suspicious is sent anyway.
 */
import { describe, expect, it } from 'vitest'

import { buildExportRequest, EXPORT_PATH, exportFilename } from './tableExport'

const column = (valueKey: string, title = valueKey) => ({ title, valueKey })
const paramsOf = (query: string) => new URLSearchParams(query)

describe('the two shapes snowplow answers 400 to are never sent', () => {
  it('sends header and fields TOGETHER, with equal counts', () => {
    const request = buildExportRequest([column('name'), column('phase')], 'csv')!
    const params = paramsOf(request.params)
    expect(params.getAll('header')).toHaveLength(params.get('fields')!.split(',').length)
    expect(params.get('fields')).toBe('name,phase')
    expect(params.getAll('header')).toEqual(['name', 'phase'])
  })

  it('still sends a header for a column with an EMPTY title, so the counts stay equal', () => {
    // Dropping the empty one would make 2 fields and 1 header: a 400 for the whole request.
    const request = buildExportRequest([column('name'), { title: '', valueKey: 'phase' }], 'csv')!
    const params = paramsOf(request.params)
    expect(params.get('fields')).toBe('name,phase')
    expect(params.getAll('header')).toEqual(['name', ''])
  })

  it('returns null rather than a header-less request when no column names a cell', () => {
    expect(buildExportRequest([], 'csv')).toBeNull()
    expect(buildExportRequest(undefined, 'csv')).toBeNull()
    expect(buildExportRequest([{ title: 'Decorative' } as never], 'csv')).toBeNull()
  })

  it('skips a column with no valueKey but keeps the rest aligned', () => {
    const request = buildExportRequest([column('name'), { title: 'Spacer' } as never, column('phase')], 'csv')!
    const params = paramsOf(request.params)
    expect(params.get('fields')).toBe('name,phase')
    expect(params.getAll('header')).toEqual(['name', 'phase'])
  })
})

describe('what it sends ANYWAY, because snowplow allows it', () => {
  it('sends DUPLICATE titles — two columns may legitimately share a label', () => {
    const request = buildExportRequest([column('created', 'Age'), column('createdRaw', 'Age')], 'csv')!
    expect(paramsOf(request.params).getAll('header')).toEqual(['Age', 'Age'])
  })

  it('sends a REPEATED valueKey — a raw and a formatted view of one cell are two columns', () => {
    const request = buildExportRequest([column('created', 'Age'), column('created', 'Created at')], 'csv')!
    const params = paramsOf(request.params)
    expect(params.get('fields')).toBe('created,created')
    expect(params.getAll('header')).toEqual(['Age', 'Created at'])
  })
})

describe('format-specific parameters', () => {
  it('sends title ONLY for pdf, where it is the only format that reads it', () => {
    expect(paramsOf(buildExportRequest([column('name')], 'pdf', 'Pods')!.params).get('title')).toBe('Pods')
    expect(paramsOf(buildExportRequest([column('name')], 'csv', 'Pods')!.params).get('title')).toBeNull()
    expect(paramsOf(buildExportRequest([column('name')], 'json', 'Pods')!.params).get('title')).toBeNull()
  })

  it('sends no title for pdf when there is none, rather than an empty one', () => {
    expect(paramsOf(buildExportRequest([column('name')], 'pdf')!.params).get('title')).toBeNull()
  })

  it('always names the format and the path', () => {
    const params = paramsOf(buildExportRequest([column('name')], 'json')!.params)
    expect(params.get('format')).toBe('json')
    expect(params.get('path')).toBe(EXPORT_PATH)
  })
})

describe('the jq path matches the dataSource cell contract', () => {
  it('selects by valueKey, not by position — a column\'s index is not a cell\'s index', () => {
    expect(EXPORT_PATH).toContain('(.valueKey)')
    expect(EXPORT_PATH).not.toMatch(/\.\[\d\]/)
  })
})

describe('exportFilename', () => {
  it('uses the format as the extension', () => {
    expect(exportFilename('csv')).toBe('export.csv')
    expect(exportFilename('pdf', 'Pod sizing')).toBe('Pod-sizing.pdf')
  })

  it('never produces a path or a hidden file from a widget-supplied name', () => {
    expect(exportFilename('csv', '../../etc/passwd')).toBe('etc-passwd.csv')
    expect(exportFilename('csv', '...')).toBe('export.csv')
    expect(exportFilename('csv', '')).toBe('export.csv')
  })
})
