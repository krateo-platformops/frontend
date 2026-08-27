/**
 * UI-NATIVE BUILDER IMPORT (item C) — coverage of the client-side ingestion helpers.
 *   - importFileKey strips the OS-prepended top-level folder from a directory pick (chart-root-relative);
 *   - validateImportedTree gates non-empty, under-512-KiB, every-file-parses-as-YAML.
 */
import { describe, expect, it } from 'vitest'

import { importFileKey, validateImportedTree } from './builderImport'

const fileWith = (name: string, relativePath?: string): File => {
  const file = new File(['x'], name)
  if (relativePath) {
    Object.defineProperty(file, 'webkitRelativePath', { value: relativePath })
  }
  return file
}

describe('importFileKey', () => {
  it('keys a flat pick by the bare file name', () => {
    expect(importFileKey(fileWith('Chart.yaml'))).toBe('Chart.yaml')
  })

  it('strips the top-level folder from a directory pick (chart-root-relative)', () => {
    expect(importFileKey(fileWith('deployment.yaml', 'my-chart/templates/deployment.yaml'))).toBe('templates/deployment.yaml')
    expect(importFileKey(fileWith('Chart.yaml', 'my-chart/Chart.yaml'))).toBe('Chart.yaml')
  })
})

describe('validateImportedTree', () => {
  it('accepts a non-empty tree of valid YAML and returns the byte total', () => {
    const res = validateImportedTree({ 'Chart.yaml': 'name: x\n', 'values.yaml': 'replicaCount: 1\n' })
    expect(res.ok).toBe(true)
    if (!res.ok) {
      throw new Error('expected ok')
    }
    expect(res.bytes).toBeGreaterThan(0)
  })

  it('rejects an empty tree', () => {
    expect(validateImportedTree({}).ok).toBe(false)
  })

  it('rejects a file that does not parse as YAML, naming the offending path', () => {
    const res = validateImportedTree({ 'bad.yaml': 'a: b\n  c: [unclosed' })
    expect(res.ok).toBe(false)
    if (res.ok) {
      throw new Error('expected denial')
    }
    expect(res.errors.join('\n')).toMatch(/bad\.yaml/)
  })

  it('rejects a tree over the 512 KiB cap', () => {
    const res = validateImportedTree({ 'values.yaml': `x: ${'y'.repeat(600 * 1024)}` })
    expect(res.ok).toBe(false)
    if (res.ok) {
      throw new Error('expected denial')
    }
    expect(res.errors.join('\n')).toMatch(/512 KiB/)
  })
})
