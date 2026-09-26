/**
 * applyFiles — several files as ONE change, or none.
 *
 * The composer's gestures are multi-file (a placed node is its template AND the rewritten
 * descriptor), and a half-applied one is a draft nobody drew. So every refusal is checked before
 * anything is written and leaves the held tree byte for byte as it was, the cap is measured once
 * over the result, and an accepted change announces exactly once.
 */
import { describe, expect, it, vi } from 'vitest'

import { ARCHITECTURE_TEMPLATE_PATH, rewrapDescriptor, unwrapFromConfigMapTemplate, wrapAsConfigMapTemplate } from '../../pages/BlueprintComposer/architecture'
import { graphBlockIn } from '../../pages/BlueprintComposer/graphCompile'
import { startChart } from '../../pages/BlueprintComposer/startChart'

import { lintBlueprintDraft } from './blueprintDraft'
import { createBlueprintDraftStore, type FilesChange } from './blueprintDraftStore'

const chart = (): Record<string, string> => ({
  'Chart.yaml': 'apiVersion: v2\nname: orders\nversion: 0.1.0\n',
  'templates/architecture.yaml': 'kind: ConfigMap\n',
  'values.schema.json': '{"type":"object"}',
})

const held = (onChange = vi.fn()) => {
  const store = createBlueprintDraftStore(onChange)
  store.set(chart(), 'blueprint')
  onChange.mockClear()
  return { onChange, store }
}

describe('blueprintDraftStore.applyFiles', () => {
  it('adds, edits and removes together, announces ONCE, and keeps the kind', () => {
    const { onChange, store } = held()
    const result = store.applyFiles({
      add: { 'templates/repository.yaml': 'kind: Repository\n' },
      edit: { 'templates/architecture.yaml': 'kind: ConfigMap\ndata: {}\n' },
      remove: ['values.schema.json'],
    })
    expect(result.ok).toBe(true)
    expect(store.get()?.files).toEqual({
      'Chart.yaml': chart()['Chart.yaml'],
      'templates/architecture.yaml': 'kind: ConfigMap\ndata: {}\n',
      'templates/repository.yaml': 'kind: Repository\n',
    })
    expect(store.get()?.kind).toBe('blueprint')
    expect(onChange).toHaveBeenCalledTimes(1)
  })

  const refusals: [string, FilesChange, RegExp][] = [
    ['an empty change', {}, /empty/],
    ['an add of a held path', { add: { 'Chart.yaml': 'x' } }, /already in the draft/],
    ['an add with no path', { add: { '': 'x' } }, /needs a path/],
    ['an edit of a path not held', { edit: { 'templates/nowhere.yaml': 'x' } }, /not a held file/],
    ['a remove of a path not held', { remove: ['templates/nowhere.yaml'] }, /not in the draft/],
    ['a path in two lists', { edit: { 'Chart.yaml': 'x' }, remove: ['Chart.yaml'] }, /more than once/],
    ['a path removed twice', { remove: ['Chart.yaml', 'Chart.yaml'] }, /more than once/],
    ['an edit of an inherited name', { edit: { constructor: 'x' } }, /not a held file/],
    ['a valid add beside a bad edit', { add: { 'templates/a.yaml': 'a' }, edit: { 'templates/nowhere.yaml': 'x' } }, /not a held file/],
  ]
  for (const [name, change, reason] of refusals) {
    it(`refuses ${name} — the tree byte-identical, nothing announced`, () => {
      const { onChange, store } = held()
      const before = JSON.stringify(store.get())
      const result = store.applyFiles(change)
      expect(result.ok).toBe(false)
      expect(result.error).toMatch(reason)
      expect(JSON.stringify(store.get())).toBe(before)
      expect(onChange).not.toHaveBeenCalled()
    })
  }

  it('names the path a refusal is about', () => {
    const { store } = held()
    expect(store.applyFiles({ remove: ['templates/gone.yaml'] }).path).toBe('templates/gone.yaml')
  })

  it('over the 512 KiB cap: refused whole, the tree exactly as it was', () => {
    const { onChange, store } = held()
    const before = JSON.stringify(store.get())
    const result = store.applyFiles({ add: { 'templates/big.yaml': `# ${'x'.repeat(600 * 1024)}\n` }, edit: { 'Chart.yaml': 'apiVersion: v2\nname: orders\nversion: 0.2.0\n' } })
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/over the 512 KiB cap/)
    expect(JSON.stringify(store.get())).toBe(before)
    expect(onChange).not.toHaveBeenCalled()
  })

  describe('a chart\'s change is SETTLED, as every write to a held chart is', () => {
    const started = (): Record<string, string> => {
      const seeded = startChart({ description: '', name: 'orders', version: '0.1.0' })
      if (!seeded.ok) { throw new Error('fixture chart refused') }
      return seeded.files
    }
    const NODE = ['- id: settings', '  class: native', '  apiVersion: v1', '  kind: ConfigMap', '  template: templates/settings.yaml', '  name: printf "%s-settings" $.Release.Name']
    const SETTINGS = 'apiVersion: v1\nkind: ConfigMap\nmetadata:\n  name: {{ printf "%s-settings" $.Release.Name }}\ndata: {}\n'
    /** The descriptor with one node, put back by rewrap alone — the block left as it was, as placing leaves it. */
    const rewrapped = (file: string): string =>
      rewrapDescriptor(file, (unwrapFromConfigMapTemplate(file) ?? '').replace('resources: []\n', `resources:\n${NODE.map((line) => `  ${line}`).join('\n')}\n`)) ?? ''

    it('a template added with a descriptor rewritten in place: held with the graph block compiled from it, and clean', () => {
      const files = started()
      const typed = rewrapped(files[ARCHITECTURE_TEMPLATE_PATH])
      expect(graphBlockIn(typed)).toBe(graphBlockIn(files[ARCHITECTURE_TEMPLATE_PATH]))
      const store = createBlueprintDraftStore()
      store.set(files, 'blueprint')
      expect(store.applyFiles({ add: { 'templates/settings.yaml': SETTINGS }, edit: { [ARCHITECTURE_TEMPLATE_PATH]: typed } }).ok).toBe(true)
      const held = store.get()?.files ?? {}
      expect(held[ARCHITECTURE_TEMPLATE_PATH]).toBe(wrapAsConfigMapTemplate(unwrapFromConfigMapTemplate(typed) ?? '', 'orders'))
      expect(graphBlockIn(held[ARCHITECTURE_TEMPLATE_PATH])).toContain('"id" "settings"')
      expect(lintBlueprintDraft(held, 'blueprint')).toEqual([])
    })

    it('the cap measures the settled bytes — the ones held, not the ones sent', () => {
      const measure = (tree: Record<string, string>): number => Object.values(tree).reduce((sum, text) => sum + new TextEncoder().encode(text).length, 0)
      const files = started()
      const change = { add: { 'templates/settings.yaml': SETTINGS }, edit: { [ARCHITECTURE_TEMPLATE_PATH]: rewrapped(files[ARCHITECTURE_TEMPLATE_PATH]) } }
      const store = createBlueprintDraftStore()
      store.set(files, 'blueprint')
      const result = store.applyFiles(change)
      expect(result.bytes).toBe(measure(store.get()?.files ?? {}))
      // The regenerated block carries the new node, so what is held outweighs what was sent.
      expect(result.bytes).toBeGreaterThan(measure({ ...files, ...change.add, ...change.edit }))
    })

    it('a PAGE change is held exactly as given', () => {
      const typed = rewrapped(started()[ARCHITECTURE_TEMPLATE_PATH])
      const store = createBlueprintDraftStore()
      store.set({ [ARCHITECTURE_TEMPLATE_PATH]: 'kind: ConfigMap\n', 'Chart.yaml': 'apiVersion: v2\nname: page-x\nversion: CHART_VERSION\n' }, 'page')
      expect(store.applyFiles({ edit: { [ARCHITECTURE_TEMPLATE_PATH]: typed } }).ok).toBe(true)
      expect(store.get()?.files[ARCHITECTURE_TEMPLATE_PATH]).toBe(typed)
    })
  })

  it('refuses when nothing is held', () => {
    expect(createBlueprintDraftStore().applyFiles({ add: { a: 'b' } })).toMatchObject({ error: 'no draft is held', ok: false })
  })
})
