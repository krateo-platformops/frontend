/**
 * The held chart's graph block follows its descriptor on EVERY write.
 *
 * The canvas tells a person to add a resource by editing templates/architecture.yaml in Chart files,
 * and the lint refuses Preview — and so Publish — while the `krateo:graph` block disagrees with
 * data.architecture. Nothing rewrote the block after Start, so that one documented edit left the chart
 * unpreviewable for good: the only ways out were Undo, or copying the compiled block by hand. The
 * store now regenerates it as part of each write, so the edit a person makes is the edit that previews.
 */
import { describe, expect, it } from 'vitest'

import { ARCHITECTURE_TEMPLATE_PATH, unwrapFromConfigMapTemplate, wrapAsConfigMapTemplate } from '../../pages/BlueprintComposer/architecture'
import { graphBlockIn } from '../../pages/BlueprintComposer/graphCompile'
import { startChart } from '../../pages/BlueprintComposer/startChart'

import { lintBlueprintDraft } from './blueprintDraft'
import { createBlueprintDraftStore } from './blueprintDraftStore'

const started = (): Record<string, string> => {
  const chart = startChart({ description: '', name: 'probe-chart', version: '0.1.0' })
  if (!chart.ok) { throw new Error('fixture chart refused') }
  return chart.files
}

const SETTINGS = 'apiVersion: v1\nkind: ConfigMap\nmetadata:\n  name: {{ printf "%s-settings" .Release.Name }}\ndata: {}\n'

const SETTINGS_NODE = [
  '- id: settings',
  '  class: native',
  '  apiVersion: v1',
  '  kind: ConfigMap',
  '  template: templates/settings.yaml',
  '  name: printf "%s-settings" .Release.Name',
].map((line) => `      ${line}`).join('\n')

/** The architecture file as a person edits it in Chart files: one node added, the block left as it was. */
const withSettingsNode = (file: string): string => file.replace('    resources: []\n', `    resources:\n${SETTINGS_NODE}\n`)

const held = (store: ReturnType<typeof createBlueprintDraftStore>): Record<string, string> => store.get()?.files ?? {}

describe('the held chart\'s graph block is regenerated on every write', () => {
  it('an edit of data.architecture in Chart files is held with the block it compiles to — and lints clean', () => {
    const store = createBlueprintDraftStore()
    store.set(started(), 'blueprint')
    expect(lintBlueprintDraft(held(store), 'blueprint')).toEqual([])
    expect(store.addFile('templates/settings.yaml', SETTINGS).ok).toBe(true)

    const typed = withSettingsNode(held(store)[ARCHITECTURE_TEMPLATE_PATH])
    // The bytes as typed: the descriptor has the node, the block does not.
    expect(lintBlueprintDraft({ ...held(store), [ARCHITECTURE_TEMPLATE_PATH]: typed }, 'blueprint').join('\n')).toContain('no longer matches data.architecture')

    const result = store.updateFile(ARCHITECTURE_TEMPLATE_PATH, typed)
    expect(result.ok).toBe(true)
    const file = held(store)[ARCHITECTURE_TEMPLATE_PATH]
    expect(unwrapFromConfigMapTemplate(file)).toBe(unwrapFromConfigMapTemplate(typed))
    expect(graphBlockIn(file)).toContain('"id" "settings"')
    // The answer carries what is held, so the surface can show the bytes that publish.
    expect(result.content).toBe(file)
    expect(lintBlueprintDraft(held(store), 'blueprint')).toEqual([])
  })

  it('a chart renamed in Chart.yaml, then in the descriptor\'s chart — each save regenerates, and the chart lints clean', () => {
    const store = createBlueprintDraftStore()
    store.set(started(), 'blueprint')
    store.updateFile('Chart.yaml', held(store)['Chart.yaml'].replace('name: probe-chart', 'name: probe-renamed'))
    // Only what the author must say is left: the descriptor's own `chart`.
    const afterRename = lintBlueprintDraft(held(store), 'blueprint')
    expect(afterRename).toEqual([expect.stringContaining('chart — "probe-chart" is not this chart: Chart.yaml names it "probe-renamed"')])
    expect(held(store)[ARCHITECTURE_TEMPLATE_PATH]).toContain('krateo.io/architecture: "probe-renamed"')

    store.updateFile(ARCHITECTURE_TEMPLATE_PATH, held(store)[ARCHITECTURE_TEMPLATE_PATH].replace('    chart: probe-chart', '    chart: probe-renamed'))
    expect(lintBlueprintDraft(held(store), 'blueprint')).toEqual([])
  })

  it('the wrapper from before the block is upgraded when it is held, and stays clean through the next edit', () => {
    const chart = started()
    const fresh = withSettingsNode(chart[ARCHITECTURE_TEMPLATE_PATH])
    const descriptor = unwrapFromConfigMapTemplate(fresh) ?? ''
    const before = wrapAsConfigMapTemplate(descriptor, 'probe-chart')
      .replace(graphBlockIn(wrapAsConfigMapTemplate(descriptor, 'probe-chart')) ?? '', '')
      .replace('{{- $g := .Values.global | default dict }}\n', '')
      .replace('($g.compositionName | default .Release.Name)', '.Release.Name | trunc 63 | trimSuffix "-"')
    expect(lintBlueprintDraft({ ...chart, [ARCHITECTURE_TEMPLATE_PATH]: before }, 'blueprint').join('\n')).toContain('has no krateo:graph block')

    const store = createBlueprintDraftStore()
    store.set({ ...chart, [ARCHITECTURE_TEMPLATE_PATH]: before }, 'blueprint')
    expect(held(store)[ARCHITECTURE_TEMPLATE_PATH]).toBe(wrapAsConfigMapTemplate(descriptor, 'probe-chart'))
    store.updateFile('values.yaml', '{}\n')
    expect(lintBlueprintDraft(held(store), 'blueprint')).toEqual([])
  })

  it('a file the composer adds, and a removal, are writes too', () => {
    const chart = started()
    const store = createBlueprintDraftStore()
    const { [ARCHITECTURE_TEMPLATE_PATH]: file, ...rest } = chart
    store.set(rest, 'blueprint')
    store.addFile(ARCHITECTURE_TEMPLATE_PATH, withSettingsNode(file))
    expect(graphBlockIn(held(store)[ARCHITECTURE_TEMPLATE_PATH])).toContain('"id" "settings"')

    // The block compiles with Chart.yaml's name; with Chart.yaml gone, with the descriptor's own
    // `chart`, as the lint does.
    store.updateFile('Chart.yaml', held(store)['Chart.yaml'].replace('name: probe-chart', 'name: probe-other'))
    expect(held(store)[ARCHITECTURE_TEMPLATE_PATH]).toContain('"chart" "probe-other"')
    store.removeFile('Chart.yaml')
    expect(held(store)[ARCHITECTURE_TEMPLATE_PATH]).toContain('"chart" "probe-chart"')
  })

  it('a PAGE set is held exactly as given — it has no architecture file of the composer\'s to keep', () => {
    const typed = withSettingsNode(started()[ARCHITECTURE_TEMPLATE_PATH])
    const store = createBlueprintDraftStore()
    store.set({ [ARCHITECTURE_TEMPLATE_PATH]: typed, 'Chart.yaml': 'apiVersion: v2\nname: page-x\nversion: CHART_VERSION\n' }, 'page')
    expect(held(store)[ARCHITECTURE_TEMPLATE_PATH]).toBe(typed)
  })
})
