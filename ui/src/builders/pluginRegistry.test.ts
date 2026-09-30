import { describe, expect, it } from 'vitest'

import { summarizeChart, summarizeDraft } from '../components/Autopilot/draftStructure'
import { architectureGraphCanvas, kindsPalette, nodeInspector } from '../pages/BlueprintComposer/blueprintSlots'
import { objectTreeInspector, pageGridCanvas, widgetsPalette } from '../pages/PageComposer/pageSlots'

import type { SlotPlugin } from './host/hostTypes'
import { checkNames, pendingPluginNames, pluginNames, resolveCheck, resolvePlugin, type PluginSlot } from './pluginRegistry'

describe('the plugin registry', () => {
  it('registers today\'s composer pieces under their names', () => {
    const expected: [PluginSlot, string, unknown][] = [
      ['palette', 'widgets', widgetsPalette],
      ['palette', 'kinds', kindsPalette],
      ['canvas', 'page-grid', pageGridCanvas],
      ['canvas', 'architecture-graph', architectureGraphCanvas],
      ['inspector', 'object-tree', objectTreeInspector],
      ['inspector', 'node', nodeInspector],
      ['summarizer', 'page-tree', summarizeDraft],
      ['summarizer', 'chart-files', summarizeChart],
    ]
    for (const [slot, name, implementation] of expected) {
      const resolved = resolvePlugin(slot, name)
      expect(resolved.ok, `${slot}/${name}`).toBe(true)
      if (resolved.ok) { expect(resolved.implementation).toBe(implementation) }
    }
  })

  it('gives each slot plugin the draft kind it draws, and each canvas its frame', () => {
    const kinds = (['palette', 'canvas', 'inspector'] as const).flatMap((slot) => pluginNames(slot).map((name: string) => {
      const resolved = resolvePlugin(slot, name)
      return resolved.ok ? `${slot}/${name}:${(resolved.implementation as SlotPlugin).kind}` : `${slot}/${name}:refused`
    }))
    expect(kinds.sort()).toEqual([
      'canvas/architecture-graph:blueprint', 'canvas/page-grid:page',
      'inspector/node:blueprint', 'inspector/object-tree:page',
      'palette/kinds:blueprint', 'palette/widgets:page',
    ])
    expect(architectureGraphCanvas.frame).toBe('panes')
    expect(pageGridCanvas.frame).toBe('split')
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

  it('the Controller Builder\'s plugins are PENDING: named, refused as not shipped yet, and only in their own slot', () => {
    expect(pendingPluginNames('palette')).toEqual(['openapi'])
    expect(pendingPluginNames('canvas')).toEqual(['restdef-graph'])
    expect(pendingPluginNames('inspector')).toEqual(['restdef-mapping'])
    for (const [slot, name] of [['palette', 'openapi'], ['canvas', 'restdef-graph'], ['inspector', 'restdef-mapping']] as const) {
      const resolved = resolvePlugin(slot, name)
      expect(resolved).toMatchObject({ name, ok: false, pending: true, slot })
      if (!resolved.ok) { expect(resolved.refusal).toMatch(/is not shipped in this frontend yet: it comes with the Controller Builder composer \(frontend#405, T8\)/) }
    }
    // Pending is not "registered": the names a slot SHIPS are unchanged, and another slot's pending
    // name is as unknown as any.
    expect(pluginNames('inspector')).toEqual(['node', 'object-tree'])
    expect(resolvePlugin('palette', 'restdef-mapping')).not.toHaveProperty('pending')
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
