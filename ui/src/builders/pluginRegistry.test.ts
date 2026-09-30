import { describe, expect, it } from 'vitest'

import { summarizeChart, summarizeDraft } from '../components/Autopilot/draftStructure'
import ArchitectureCanvas from '../pages/BlueprintComposer/ArchitectureCanvas'
import ArchitecturePalette from '../pages/BlueprintComposer/ArchitecturePalette'
import NodeInspector from '../pages/BlueprintComposer/NodeInspector'
import CanvasPanel from '../pages/PageComposer/CanvasPanel'
import ObjectTreePanel from '../pages/PageComposer/ObjectTreePanel'
import PalettePanel from '../pages/PageComposer/PalettePanel'

import { checkNames, pluginNames, resolveCheck, resolvePlugin, type PluginSlot } from './pluginRegistry'

describe('the plugin registry', () => {
  it('registers today\'s composer pieces under their names', () => {
    const expected: [PluginSlot, string, unknown][] = [
      ['palette', 'widgets', PalettePanel],
      ['palette', 'kinds', ArchitecturePalette],
      ['canvas', 'page-grid', CanvasPanel],
      ['canvas', 'architecture-graph', ArchitectureCanvas],
      ['inspector', 'object-tree', ObjectTreePanel],
      ['inspector', 'node', NodeInspector],
      ['summarizer', 'page-tree', summarizeDraft],
      ['summarizer', 'chart-files', summarizeChart],
    ]
    for (const [slot, name, implementation] of expected) {
      const resolved = resolvePlugin(slot, name)
      expect(resolved.ok, `${slot}/${name}`).toBe(true)
      if (resolved.ok) { expect(resolved.implementation).toBe(implementation) }
    }
  })

  it('ships no parser yet, and says so', () => {
    expect(pluginNames('parser')).toEqual([])
    const resolved = resolvePlugin('parser', 'openapi')
    expect(resolved.ok).toBe(false)
    if (!resolved.ok) { expect(resolved.refusal).toMatch(/the parser plugins it does ship are: none\.$/) }
  })

  it('refuses an unknown name with a sentence naming the slot and the name', () => {
    const resolved = resolvePlugin('canvas', 'restdef-mapping')
    expect(resolved).toEqual({
      name: 'restdef-mapping',
      ok: false,
      refusal: 'This frontend has no canvas plugin named "restdef-mapping", so the builder\'s canvas cannot be shown. The Builder names a plugin this build does not ship; the canvas plugins it does ship are: architecture-graph, page-grid.',
      slot: 'canvas',
    })
  })

  it('is deny-by-default: no prototype key, no other slot\'s name, no near match resolves', () => {
    for (const name of ['toString', 'constructor', '__proto__', 'hasOwnProperty', 'page-grid', 'Widgets', 'widgets ', '']) {
      expect(resolvePlugin('palette', name).ok, JSON.stringify(name)).toBe(false)
    }
  })

  it('never throws, even on a non-string name from untyped data', () => {
    for (const name of [undefined, null, 7, {}] as unknown as string[]) {
      expect(() => resolvePlugin('inspector', name)).not.toThrow()
      expect(resolvePlugin('inspector', name).ok).toBe(false)
    }
  })
})

describe('the check names', () => {
  it('knows the lints and gates the composers run today', () => {
    expect(checkNames('lint')).toEqual(['chart-lint', 'gate-drift'])
    expect(checkNames('gate')).toEqual(['preview-before-publish', 'publish-name'])
  })

  it('refuses an unknown check rather than skipping it', () => {
    const resolved = resolveCheck('gate', 'kog-validate')
    expect(resolved.ok).toBe(false)
    if (!resolved.ok) { expect(resolved.refusal).toMatch(/^This frontend has no gate named "kog-validate"/) }
    expect(resolveCheck('lint', 'toString').ok).toBe(false)
  })
})
