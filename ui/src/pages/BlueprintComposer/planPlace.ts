/**
 * Placing a node, and ranging one — the kernels behind the palette and the inspector's "One per
 * item of". Pure: each takes the held files and answers with the batch that makes the change, or
 * the sentence that says why it will not. Nothing here writes; the composer emits the plan on the
 * batch bus, and the provider writes all of it or none (previewFilesBatch).
 *
 * A PLACEMENT IS A NODE AND A FILE, at once — the descriptor entry and `templates/<id>.yaml` — and
 * one without the other is a draft nobody drew: a node that renders nothing, or a template the
 * machine does not know. So the plan is always both, in one batch.
 *
 * THE DESCRIPTOR IS REWRITTEN, THE FILE IS NOT. The new entry is appended and the descriptor is
 * re-serialised (the one format `serializeArchitecture` writes), then put back into the template the
 * chart already holds with `rewrapDescriptor` — so a label or a comment the author added around the
 * block survives. `readyWhen` is never written: a known kind's suggestion is offered where an edge's
 * readiness is picked (S4b), not stored as if the person had chosen it.
 *
 * `expect` pins the bytes the plan was made from. A write that landed in between — the agent's, a
 * hand edit in Chart files — makes the provider refuse the batch instead of losing that write.
 */
import { CHART_YAML_PATH, chartYamlName } from '../../components/Autopilot/blueprintDraft'
import type { CrdSpecExtract } from '../../components/Autopilot/describeResource'

import { ARCHITECTURE_TEMPLATE_PATH, parseArchitecture, rewrapDescriptor, serializeArchitecture, unwrapFromConfigMapTemplate, type ChartArchitecture } from './architecture'
import { compositionKind } from './chartIdentity'
import { placedNameExpression, placedNodeId } from './naming'
import { PLACED_MARKER, placedTemplate, rangeLine } from './templateGen'

/** One palette row, activated. */
export type PalettePick =
  | { cls: 'native'; kind: string; apiVersion: string }
  | { cls: 'custom'; kind: string; apiVersion: string; plural: string; group: string }
  | { cls: 'composition'; kind: string; apiVersion: string; plural: string; blueprint: string }

export type PlacePlan =
  | { ok: true; id: string; add: Record<string, string>; edit: Record<string, string>; expect: Record<string, string> }
  | { ok: false; reason: string }

export const NO_DESCRIPTOR = `Add ${ARCHITECTURE_TEMPLATE_PATH} first — the canvas has the button.`
export const DESCRIPTOR_REFUSED = 'The architecture file has problems — fix them in Chart files before placing.'

/** Own keys only: a template path named `constructor` is not a file the chart holds. */
const holds = (files: Readonly<Record<string, string>>, path: string): boolean => Object.prototype.hasOwnProperty.call(files, path)

/** The version part of an apiVersion: `composition.krateo.io/v1-8-40` → `v1-8-40`. */
const versionOf = (apiVersion: string): string => apiVersion.slice(apiVersion.lastIndexOf('/') + 1)

/**
 * The CRD a pick's spec comes from, and the version to read it at — or null for a native kind,
 * which has no CRD. The version is the pick's own: for a composition, the compdef's served
 * `apiVersion`, never the CRD's storage version (38 of 46 composition CRDs on krateo-057 store a
 * version they do not serve).
 */
export const placementCrd = (pick: PalettePick): { name: string; version: string } | null => {
  if (pick.cls === 'native') { return null }
  const group = pick.cls === 'custom' ? pick.group : pick.apiVersion.slice(0, pick.apiVersion.lastIndexOf('/'))
  return { name: `${pick.plural}.${group}`, version: versionOf(pick.apiVersion) }
}

type Read = { ok: true; architecture: ChartArchitecture; template: string } | { ok: false; reason: string }

/** The held descriptor, readable, or the sentence that refuses the change. */
const readDescriptor = (files: Readonly<Record<string, string>>): Read => {
  if (!holds(files, ARCHITECTURE_TEMPLATE_PATH)) {
    return { ok: false, reason: NO_DESCRIPTOR }
  }
  const template = files[ARCHITECTURE_TEMPLATE_PATH]
  const descriptor = unwrapFromConfigMapTemplate(template)
  if (descriptor === null) {
    return { ok: false, reason: DESCRIPTOR_REFUSED }
  }
  try {
    const parsed = parseArchitecture(descriptor)
    return parsed.ok ? { architecture: parsed.architecture, ok: true, template } : { ok: false, reason: DESCRIPTOR_REFUSED }
  } catch {
    return { ok: false, reason: DESCRIPTOR_REFUSED }
  }
}

/**
 * Every id a placement must not take: the descriptor's, and the one every `templates/<id>.yaml`
 * implies — held, or declared by a node whose file is not written yet. A node may name a template
 * the chart does not hold (the inspector says so); placing a kind must not then write that file, or
 * two nodes would share one template and the chart would render one object for both.
 */
const takenIds = (files: Readonly<Record<string, string>>, arch: ChartArchitecture): Set<string> => {
  const taken = new Set(arch.resources.map((node) => node.id))
  for (const path of [...Object.keys(files), ...arch.resources.map((node) => node.template)]) {
    const found = /^templates\/([^/]+)\.ya?ml$/.exec(path)
    if (found) { taken.add(found[1]) }
  }
  return taken
}

export const planPlace = (
  files: Readonly<Record<string, string>>,
  pick: PalettePick,
  spec: CrdSpecExtract | null,
  /** Why the template's spec is empty, as a whole clause — see templateGen's header. */
  specNote?: string,
): PlacePlan => {
  const read = readDescriptor(files)
  if (!read.ok) {
    return read
  }
  const chart = chartYamlName(files[CHART_YAML_PATH])
  if (pick.cls === 'composition' && chart && pick.kind === compositionKind(chart)) {
    return { ok: false, reason: `Nesting ${chart} into ${chart} is refused as a cycle — a blueprint cannot contain itself.` }
  }
  const { architecture, template } = read
  const id = placedNodeId(pick.kind, takenIds(files, architecture))
  const path = `templates/${id}.yaml`
  const next: ChartArchitecture = {
    ...architecture,
    resources: [...architecture.resources, { apiVersion: pick.apiVersion, class: pick.cls, id, kind: pick.kind, template: path }],
  }
  const rewrapped = rewrapDescriptor(template, serializeArchitecture(next))
  if (rewrapped === null) {
    return { ok: false, reason: DESCRIPTOR_REFUSED }
  }
  const node = { apiVersion: pick.apiVersion, class: pick.cls, id, kind: pick.kind }
  return {
    add: { [path]: placedTemplate(node, { spec, specNote }) },
    edit: { [ARCHITECTURE_TEMPLATE_PATH]: rewrapped },
    expect: { [ARCHITECTURE_TEMPLATE_PATH]: template },
    id,
    ok: true,
  }
}

/** A `forEach` the descriptor and the range can both take: a bare path, or a named helper. */
const FOR_EACH = /^(?:\.[A-Za-z_][\w]*(?:\.[A-Za-z_][\w]*)*|[A-Za-z_][\w.-]*)$/

const reshaped = (path: string): string =>
  `${path} has changed shape since it was placed — set forEach in Chart files.`

/** A line that is nothing but one Helm comment — the placed header's lines. */
const COMMENT_LINE = /^\{\{-?\s*\/\*[\s\S]*?\*\/\s*-?\}\}$/

/**
 * The template split into its header and its one document, when it is still the shape placing
 * wrote — else null. The spec may have been filled in; the SHAPE may not have changed: one document,
 * no `if`, `range` or `with` of the author's, and the name line placing wrote.
 */
const pristineParts = (template: string, id: string, current: string | undefined): { header: string[]; body: string[]; nameAt: number } | null => {
  const lines = template.replace(/\n+$/, '').split('\n')
  let start = 0
  while (start < lines.length && COMMENT_LINE.test(lines[start])) { start += 1 }
  const header = lines.slice(0, start)
  if (!header.some((line) => line.includes(PLACED_MARKER))) { return null }
  let body = lines.slice(start)
  if (current) {
    if (body[0] !== rangeLine(current) || body[1] !== '---' || body[body.length - 1] !== '{{- end }}') { return null }
    body = body.slice(2, -1)
  }
  if (body.some((line) => line.startsWith('---') || /\{\{-?\s*(?:if|range|with|end)\b/.test(line))) { return null }
  const metadata = body.indexOf('metadata:')
  if (metadata < 0) { return null }
  let nameAt = -1
  for (let idx = metadata + 1; idx < body.length && body[idx].startsWith('  '); idx += 1) {
    if (body[idx].startsWith('  name:')) { nameAt = idx }
  }
  if (nameAt < 0 || body[nameAt] !== `  name: {{ ${placedNameExpression(id, !!current)} }}`) { return null }
  return { body, header, nameAt }
}

/**
 * Range a placed node over a list, or stop ranging it (`forEach: null`) — the descriptor's
 * `forEach` and the template's `range` and name, in one batch. Only on a template still in the shape
 * placing wrote: anything the author reshaped is theirs to change in Chart files.
 */
export const setForEach = (files: Readonly<Record<string, string>>, id: string, forEach: string | null): PlacePlan => {
  const read = readDescriptor(files)
  if (!read.ok) {
    return read
  }
  const { architecture, template } = read
  const node = architecture.resources.find((resource) => resource.id === id)
  if (!node) {
    return { ok: false, reason: `"${id}" is not a resource of this chart.` }
  }
  const wanted = forEach?.trim() || null
  if (wanted !== null && !FOR_EACH.test(wanted)) {
    return { ok: false, reason: 'One per item of takes a bare path (.Values.files) or a named helper (builder-publish.files).' }
  }
  if (wanted === (node.forEach ?? null)) {
    return { ok: false, reason: wanted ? `${id} is already one per item of ${wanted}.` : `${id} is not ranged over anything.` }
  }
  if (!holds(files, node.template)) {
    return { ok: false, reason: `${node.template} is not in the chart — there is nothing to range.` }
  }
  const parts = pristineParts(files[node.template], id, node.forEach)
  if (!parts) {
    return { ok: false, reason: reshaped(node.template) }
  }
  const body = [...parts.body]
  body[parts.nameAt] = `  name: {{ ${placedNameExpression(id, wanted !== null)} }}`
  const document = wanted ? [rangeLine(wanted), '---', ...body, '{{- end }}'] : body
  const next: ChartArchitecture = {
    ...architecture,
    resources: architecture.resources.map((resource) => {
      if (resource.id !== id) { return resource }
      const { forEach: _dropped, ...rest } = resource
      return wanted ? { ...rest, forEach: wanted } : rest
    }),
  }
  const rewrapped = rewrapDescriptor(template, serializeArchitecture(next))
  if (rewrapped === null) {
    return { ok: false, reason: DESCRIPTOR_REFUSED }
  }
  return {
    add: {},
    edit: { [ARCHITECTURE_TEMPLATE_PATH]: rewrapped, [node.template]: `${[...parts.header, ...document].join('\n')}\n` },
    expect: { [ARCHITECTURE_TEMPLATE_PATH]: template, [node.template]: files[node.template] },
    id,
    ok: true,
  }
}
