/**
 * The builder plugin registry — every piece of builder BEHAVIOUR a Builder CR may name, by name.
 *
 * WHY NAMES. A Builder CR (builderSpec.ts, docs/adr/0001-builders-as-crs.md) declares everything
 * about a builder that is configuration: its route, its start form, its RESTActions, its file
 * layout, where it publishes. What is behaviour — a drag-and-drop canvas, a graph, an inspector —
 * cannot be YAML, so the CR names it and this table maps the name to the code the frontend ships.
 * A builder that reuses registered plugins is pure YAML; only a new KIND of canvas, inspector or
 * parser is code, and it is a reusable plugin rather than a page.
 *
 * DENY BY DEFAULT. A name is resolved only if it is an own key of its slot's table — never a
 * prototype key, never a near match, never a fallback to some other plugin. An unknown name comes
 * back as a REFUSAL: a sentence naming the slot and the name, for the composer to show where the
 * plugin would have been. It never throws: a Builder is data from the cluster, and a CR written for a
 * newer frontend than this one is content to report, not a crash.
 *
 * REGISTRATION ONLY (T1, frontend#407). Nothing resolves through this table yet — PageComposer and
 * BlueprintComposer still mount these components directly. T2's engine will mount them from here,
 * and will give each slot the one props contract its plugins share; until then an implementation is
 * typed as exactly the component it is, which is what a registration can honestly promise.
 */
import type { ComponentType } from 'react'

import type { BlueprintDraftHeld } from '../components/Autopilot/blueprintDraftStore'
import { summarizeChart, summarizeDraft } from '../components/Autopilot/draftStructure'
import ArchitectureCanvas from '../pages/BlueprintComposer/ArchitectureCanvas'
import ArchitecturePalette from '../pages/BlueprintComposer/ArchitecturePalette'
import NodeInspector from '../pages/BlueprintComposer/NodeInspector'
import CanvasPanel from '../pages/PageComposer/CanvasPanel'
import ObjectTreePanel from '../pages/PageComposer/ObjectTreePanel'
import PalettePanel from '../pages/PageComposer/PalettePanel'

import type { BuilderSpec } from './builderSpec'

export type PluginSlot = 'palette' | 'canvas' | 'inspector' | 'parser' | 'summarizer'

/** An import parser: source text in, a held tree out — or a sentence saying why not. */
export type ParserPlugin = (source: string) => { files: Record<string, string> } | { refusal: string }

/** What Autopilot is told about the held draft, or undefined when there is nothing to say. */
export type SummarizerPlugin = (held: BlueprintDraftHeld | null) => object | undefined

interface PluginEntry<I> {
  /** One line: what the plugin is, for a refusal's list of what IS available and for the ADR. */
  description: string
  implementation: I
}

const PALETTES = {
  kinds: {
    description: 'the custom and native kinds a chart can hold, from a RESTAction run as the person (Blueprint Builder)',
    implementation: ArchitecturePalette,
  },
  widgets: {
    description: 'containers to create and the widgets this person may list, to place on a page (Portal Builder)',
    implementation: PalettePanel,
  },
} satisfies Record<string, PluginEntry<ComponentType<never>>>

const CANVASES = {
  'architecture-graph': {
    description: 'the chart\'s resources as a dependency graph, stepped through its derived states (Blueprint Builder)',
    implementation: ArchitectureCanvas,
  },
  'page-grid': {
    description: 'the page\'s widgets as nested drop frames (Portal Builder)',
    implementation: CanvasPanel,
  },
} satisfies Record<string, PluginEntry<ComponentType<never>>>

const INSPECTORS = {
  node: {
    description: 'the selected resource: what it waits for, when it is ready, and its create form (Blueprint Builder)',
    implementation: NodeInspector,
  },
  'object-tree': {
    description: 'the page draft as the containment tree it is, with its data sources (Portal Builder)',
    implementation: ObjectTreePanel,
  },
} satisfies Record<string, PluginEntry<ComponentType<never>>>

/** None yet: the first is the Controller Builder's OpenAPI import (T7). */
const PARSERS = {} satisfies Record<string, PluginEntry<ParserPlugin>>

const SUMMARIZERS = {
  'chart-files': {
    description: 'the held chart\'s files, in reading order, within a byte budget',
    implementation: summarizeChart,
  },
  'page-tree': {
    description: 'the held page\'s widget tree and the RESTActions behind it',
    implementation: summarizeDraft,
  },
} satisfies Record<string, PluginEntry<SummarizerPlugin>>

const REGISTRY = {
  canvas: CANVASES,
  inspector: INSPECTORS,
  palette: PALETTES,
  parser: PARSERS,
  summarizer: SUMMARIZERS,
} as const

type Registry = typeof REGISTRY

/** The names registered for a slot — a type, so a typo in code is a compile error. */
export type PluginName<S extends PluginSlot> = keyof Registry[S] & string

/** Exactly the implementations registered for a slot (never, for a slot with none). */
export type PluginImplementation<S extends PluginSlot> = Registry[S][PluginName<S>] extends PluginEntry<infer I> ? I : never

export type PluginResolution<S extends PluginSlot> =
  | { ok: true; slot: S; name: PluginName<S>; description: string; implementation: PluginImplementation<S> }
  | { ok: false; slot: S; name: string; refusal: string }

const own = (table: object, name: string): boolean => Object.prototype.hasOwnProperty.call(table, name)

const listed = (names: readonly string[]): string => (names.length ? names.join(', ') : 'none')

/** The registered names for a slot, sorted — what a refusal offers instead. */
export const pluginNames = <S extends PluginSlot>(slot: S): PluginName<S>[] =>
  Object.keys(REGISTRY[slot]).sort() as PluginName<S>[]

/**
 * The implementation a Builder names for a slot, or a refusal naming the slot and the name. Never
 * throws, whatever `name` is.
 */
export const resolvePlugin = <S extends PluginSlot>(slot: S, name: string): PluginResolution<S> => {
  const table: Record<string, PluginEntry<unknown>> = REGISTRY[slot]
  if (typeof name !== 'string' || !own(table, name)) {
    return {
      name: String(name),
      ok: false,
      refusal: `This frontend has no ${slot} plugin named "${String(name)}", so the builder's ${slot} cannot be shown. The Builder names a plugin this build does not ship; the ${slot} plugins it does ship are: ${listed(pluginNames(slot))}.`,
      slot,
    }
  }
  const entry = table[name]
  return {
    description: entry.description,
    implementation: entry.implementation as PluginImplementation<S>,
    name: name as PluginName<S>,
    ok: true,
    slot,
  }
}

/**
 * The lints and publish gates a Builder may name. Each is code the composers already run (the
 * description says where); a Builder only chooses which apply. Same rule as the plugins: an unknown
 * name is refused, never skipped — a check silently not run would let a draft through that its
 * builder meant to stop.
 */
const CHECKS = {
  gate: {
    'preview-before-publish': 'blueprintGate: Publish arms only for the tree the last successful Preview rendered',
    'publish-name': 'chartIdentity.publishNameProblem: the claim named for the draft fits core-provider\'s name limit',
  },
  lint: {
    'chart-lint': 'blueprintDraft.lintBlueprintDraft: chart identity, values.schema.json defaults and root, the byte cap',
    'gate-drift': 'proposedChart.lintHeldDraft: each template\'s dependency gate matches templates/architecture.yaml',
  },
} as const

export type CheckKind = keyof typeof CHECKS
export type CheckName<K extends CheckKind> = keyof (typeof CHECKS)[K] & string

export type CheckResolution<K extends CheckKind> =
  | { ok: true; kind: K; name: CheckName<K>; description: string }
  | { ok: false; kind: K; name: string; refusal: string }

export const checkNames = <K extends CheckKind>(kind: K): CheckName<K>[] => Object.keys(CHECKS[kind]).sort() as CheckName<K>[]

export const resolveCheck = <K extends CheckKind>(kind: K, name: string): CheckResolution<K> => {
  const table: Record<string, string> = CHECKS[kind]
  if (typeof name !== 'string' || !own(table, name)) {
    return {
      kind,
      name: String(name),
      ok: false,
      refusal: `This frontend has no ${kind} named "${String(name)}", so a draft cannot be checked the way the Builder asks. The ${kind}s it does ship are: ${listed(checkNames(kind))}.`,
    }
  }
  return { description: table[name], kind, name: name as CheckName<K>, ok: true }
}

/**
 * Every refusal a parsed Builder would meet — each plugin and each check it names, resolved. Empty
 * means this frontend can mount the whole builder; otherwise one sentence per missing piece.
 */
export const builderRefusals = (spec: BuilderSpec): string[] => {
  const plugins: [PluginSlot, string | undefined][] = [
    ['palette', spec.palette.plugin],
    ['canvas', spec.canvas.plugin],
    ['inspector', spec.inspector.plugin],
    ['parser', spec.parser?.plugin],
    ['summarizer', spec.summarizer?.plugin],
  ]
  return [
    ...plugins.flatMap(([slot, name]) => {
      if (name === undefined) { return [] }
      const resolved = resolvePlugin(slot, name)
      return resolved.ok ? [] : [resolved.refusal]
    }),
    ...spec.lint.flatMap((name) => {
      const resolved = resolveCheck('lint', name)
      return resolved.ok ? [] : [resolved.refusal]
    }),
    ...spec.gates.flatMap((name) => {
      const resolved = resolveCheck('gate', name)
      return resolved.ok ? [] : [resolved.refusal]
    }),
  ]
}
