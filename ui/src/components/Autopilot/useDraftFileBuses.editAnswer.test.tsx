// @vitest-environment jsdom
/**
 * The provider ANSWERS every per-file edit — written, or refused and why.
 *
 * A Files tab used to show an edit as applied the moment it emitted it. The provider could still say
 * no (over the 512 KiB tree cap, a path it does not hold, a preview of the other kind), and a refusal
 * left the held tree as it was — so the tab showed bytes that would not publish while Publish stayed
 * on for the ones that would. The bus is synchronous, so the answer comes back from `emitFileEdit`.
 */
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { createBlueprintDraftStore } from './blueprintDraftStore'
import { draftHistory } from './draftHistory'
import { emitDraftStart } from './previewDraftStart'
import { emitFileEdit, type FileEditOutcome } from './previewFileEdit'
import { useDraftFileBuses } from './useDraftFileBuses'

afterEach(() => {
  cleanup()
  draftHistory.clear()
})

const chart = { 'Chart.yaml': 'apiVersion: v2\nname: nginx-demo\nversion: 0.1.0\n', 'templates/cm.yaml': 'apiVersion: v1\nkind: ConfigMap\nmetadata:\n  name: x\n', 'values.schema.json': '{"type":"object"}' }

const host = (store: ReturnType<typeof createBlueprintDraftStore>, gate: { forget: () => void; recordPreview: () => void }) => {
  const Hosted = () => {
    useDraftFileBuses(store, gate, () => 'nginx-demo')
    return null
  }
  render(<Hosted />)
}

const edit = (content: string, path: string): FileEditOutcome | null => {
  let outcome: FileEditOutcome | null = null
  act(() => { outcome = emitFileEdit({ content, kind: 'blueprint', path }) })
  return outcome
}

describe('useDraftFileBuses — every edit is answered', () => {
  it('written: { ok: true }', () => {
    const store = createBlueprintDraftStore()
    store.set(chart, 'blueprint')
    host(store, { forget: vi.fn(), recordPreview: vi.fn() })
    expect(edit('apiVersion: v1\nkind: ConfigMap\nmetadata:\n  name: y\n', 'templates/cm.yaml')).toEqual({ ok: true })
    expect(store.get()?.files['templates/cm.yaml']).toContain('name: y')
  })

  it('over the byte cap: refused with the store\'s reason, and nothing changes — not the bytes, not the gate', () => {
    const store = createBlueprintDraftStore()
    store.set(chart, 'blueprint')
    const gate = { forget: vi.fn(), recordPreview: vi.fn() }
    host(store, gate)
    const outcome = edit(`# ${'x'.repeat(600 * 1024)}\n`, 'templates/cm.yaml')
    expect(outcome?.ok).toBe(false)
    expect(outcome && !outcome.ok ? outcome.error : '').toMatch(/over the 512 KiB cap/)
    expect(store.get()?.files['templates/cm.yaml']).toBe(chart['templates/cm.yaml'])
    expect(gate.forget).not.toHaveBeenCalled()
    expect(gate.recordPreview).not.toHaveBeenCalled()
  })

  it('made in a preview of the OTHER kind: refused, and says which draft is open', () => {
    const store = createBlueprintDraftStore()
    host(store, { forget: vi.fn(), recordPreview: vi.fn() })
    act(() => { emitDraftStart({ title: 'x', widgets: [{ apiVersion: 'widgets.templates.krateo.io/v1beta1', kind: 'Flex', metadata: { name: 'page-x' }, spec: { widgetData: {} } }] }) })
    expect(edit('apiVersion: v2\nname: aws-vpc\n', 'Chart.yaml')).toEqual({ error: 'the open draft is a portal page, not the one this preview shows', ok: false })
  })
})
