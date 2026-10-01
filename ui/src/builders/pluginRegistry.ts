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
 * MOUNTED FROM HERE (T4, frontend#410). ComposerHost resolves a Builder's palette, canvas and
 * inspector through this table and renders them. Every one of those takes the one props contract its
 * slot shares (host/hostTypes.ts `SlotProps`: the workbench of the Builder's draft kind), names the
 * draft kind it draws, and a canvas also names the frame it sits in (host/frames.ts).
 */
import type { BlueprintDraftHeld } from '../components/Autopilot/blueprintDraftStore'
import { type HeldDraftState, summarizeChart, summarizeController, summarizeDraft } from '../components/Autopilot/draftStructure'
import { architectureGraphCanvas, kindsPalette, nodeInspector } from '../pages/BlueprintComposer/blueprintSlots'
import { openapiPalette, restdefGraphCanvas, restdefMappingInspector } from '../pages/ControllerComposer/controllerSlots'
import { objectTreeInspector, pageGridCanvas, widgetsPalette } from '../pages/PageComposer/pageSlots'

import type { BuilderSpec } from './builderSpec'
import type { CanvasPlugin, SlotPlugin } from './host/hostTypes'

export type PluginSlot = 'palette' | 'canvas' | 'inspector' | 'parser' | 'summarizer'

/** An import parser: source text in, a held tree out — or a sentence saying why not. */
export type ParserPlugin = (source: string) => { files: Record<string, string> } | { refusal: string }

/** What Autopilot is told about the held draft, or undefined when there is nothing to say. `state` is
 *  what the provider knows that the files do not say — whether the held draft's preview stands. */
export type SummarizerPlugin = (held: BlueprintDraftHeld | null, state?: HeldDraftState) => object | undefined

interface PluginEntry<I> {
  /** One line: what the plugin is, for a refusal's list of what IS available and for the ADR. */
  description: string
  implementation: I
}

const PALETTES = {
  kinds: {
    description: 'the custom and native kinds a chart can hold, from a RESTAction run as the person (Blueprint Builder)',
    implementation: kindsPalette,
  },
  openapi: {
    description: 'the held OpenAPI document\'s operations, grouped by resource path (Controller Builder)',
    implementation: openapiPalette,
  },
  widgets: {
    description: 'containers to create and the widgets this person may list, to place on a page (Portal Builder)',
    implementation: widgetsPalette,
  },
} satisfies Record<string, PluginEntry<SlotPlugin>>

const CANVASES = {
  'architecture-graph': {
    description: 'the chart\'s resources as a dependency graph, stepped through its derived states (Blueprint Builder)',
    implementation: architectureGraphCanvas,
  },
  'page-grid': {
    description: 'the page\'s widgets as nested drop frames (Portal Builder)',
    implementation: pageGridCanvas,
  },
  'restdef-graph': {
    description: 'the controller\'s Kinds and the Configuration they authenticate through (Controller Builder)',
    implementation: restdefGraphCanvas,
  },
} satisfies Record<string, PluginEntry<CanvasPlugin>>

const INSPECTORS = {
  node: {
    description: 'the selected resource: what it waits for, when it is ready, and its create form (Blueprint Builder)',
    implementation: nodeInspector,
  },
  'object-tree': {
    description: 'the page draft as the containment tree it is, with its data sources (Portal Builder)',
    implementation: objectTreeInspector,
  },
  'restdef-mapping': {
    description: 'the selected Kind: its verbs, identifiers and auth, mapped to the OpenAPI document (Controller Builder)',
    implementation: restdefMappingInspector,
  },
} satisfies Record<string, PluginEntry<SlotPlugin>>

/** None yet: the first is the Controller Builder's OpenAPI import (T7). */
const PARSERS = {} satisfies Record<string, PluginEntry<ParserPlugin>>

const SUMMARIZERS = {
  'chart-files': {
    description: 'the held chart\'s files, in reading order, within a byte budget',
    implementation: summarizeChart,
  },
  'controller-model': {
    description: 'the held controller: its document\'s resource groups, each Kind\'s verbs and unsettled conflicts, its identifiers and status fields, the publish lint and the preview state (Controller Builder)',
    implementation: summarizeController,
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
  | { ok: false; slot: S; name: string; refusal: string; pending?: true }

/**
 * NAMED, NOT SHIPPED — a plugin a Builder may already name whose code comes in a later release. Such
 * a name is still a REFUSAL, worded as "not shipped yet" rather than "unknown", so the composer says
 * what is coming instead of suggesting the Builder is wrong — and a Builder whose palette, canvas and
 * inspector are ALL pending gets no route (builderRoutes.tsx). Empty today: the Controller Builder's
 * three (openapi, restdef-graph, restdef-mapping) were the first to wait here, and shipped in T8
 * (frontend#412). A plugin moves from here into its slot's table above when its code ships.
 */
const PENDING: Record<PluginSlot, Readonly<Record<string, string>>> = {
  canvas: {},
  inspector: {},
  palette: {},
  parser: {},
  summarizer: {},
}

const own = (table: object, name: string): boolean => Object.prototype.hasOwnProperty.call(table, name)

const listed = (names: readonly string[]): string => (names.length ? names.join(', ') : 'none')

/** The names a Builder may already declare for a slot whose code is not shipped yet, sorted. */
export const pendingPluginNames = (slot: PluginSlot): string[] => Object.keys(PENDING[slot]).sort()

/** The registered names for a slot, sorted — what a refusal offers instead. */
export const pluginNames = <S extends PluginSlot>(slot: S): PluginName<S>[] =>
  Object.keys(REGISTRY[slot]).sort() as PluginName<S>[]

/**
 * The implementation a Builder names for a slot, or a refusal naming the slot and the name. Never
 * throws, whatever `name` is.
 */
export const resolvePlugin = <S extends PluginSlot>(slot: S, name: string): PluginResolution<S> => {
  const table: Record<string, PluginEntry<unknown>> = REGISTRY[slot]
  if (typeof name === 'string' && !own(table, name) && own(PENDING[slot], name)) {
    return {
      name,
      ok: false,
      pending: true,
      refusal: `The ${slot} plugin "${name}" — ${PENDING[slot][name]} — is not shipped in this frontend yet, so the builder's ${slot} cannot be shown.`,
      slot,
    }
  }
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
    'restdef-validate': 'controllerChart.lintControllerDraft: the OpenAPI document reads, no verb conflict or ambiguous path id is left unsettled, the served version is v1alpha1 (or, once published, the version it was published under), and every RestDefinition passes the oasgen 0.25 shape and the OAS cross-check',
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
