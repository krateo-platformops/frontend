/**
 * The palette as the pane draws it — rows, groups, counts and the sentences in between. Pure.
 *
 * GROUPED BY API GROUP, because krateo-057 has 123 placeable custom kinds in 29 groups and a flat
 * list of that is unusable. An operator reads as one entry, labelled by what installed it: the
 * longest dash-bounded prefix its kinds' owners share, so forty KOG RestDefinitions named
 * `github-provider-kog-<thing>` read as `github-provider-kog`.
 *
 * NAMESPACED ONLY. A composition's resources live in its own namespace, so a cluster-scoped kind
 * cannot be one of them; the section counts what it left out, rather than leaving it out silently.
 *
 * THE FILTER matches a kind, its group, or a blueprint's name. A group whose NAME matches shows all
 * its kinds (the operator is what was asked for); otherwise only the kinds that match.
 *
 * READINESS, where the palette can say it. Native: the kind's kstatus meaning. Custom: a
 * four-entry table of kinds whose readiness is known — shown only when THIS cluster's CRD declares
 * that status field, so the hint is never a guess the schema contradicts. Composition: the count
 * of running instances, when it could be counted.
 */
import type { ResourceNode } from './architecture'
import type { ClassRead, CustomKind, InstalledBlueprint, PaletteRead } from './blueprintPalette'
import { compositionKind } from './chartIdentity'
import { NATIVE_KINDS } from './nativeKinds'
import type { PalettePick } from './planPlace'

export interface PaletteRow {
  key: string
  pick: PalettePick
  /** The kind (or a blueprint's name), mono. */
  primary: string
  /** The faint second line. */
  secondary: string
  /** How many nodes of this kind the chart already holds. */
  placed: number
  /** A composition that IS the chart being composed — placing it is refused as a cycle. */
  selfNesting?: boolean
}

export interface CustomGroup {
  group: string
  owner: string | null
  /** Every placeable kind in the group — what its pill counts. */
  total: number
  /** The rows the filter keeps. */
  rows: PaletteRow[]
}

export type SectionState = 'loading' | 'ok' | 'denied' | 'error'

export interface PaletteModel {
  native: PaletteRow[]
  custom: { state: SectionState; sentence: string | null; groups: CustomGroup[]; kinds: number; groupCount: number; clusterScoped: number }
  compositions: { state: SectionState; sentence: string | null; rows: PaletteRow[]; installed: number; selfNesting: string | null }
  /** The filter, trimmed — empty when there is none. */
  filter: string
  /** A filter is set and nothing in any section matches it. */
  nothingMatches: boolean
}

/**
 * The status field that means "ready" for a kind whose readiness is known. Only these four: the
 * git and github providers' own conventions, which builder-publish's gates already wait on.
 */
const KNOWN_READY_FIELDS: Record<string, string> = {
  'git.krateo.io/LocalResource': 'targetCommitId',
  'git.krateo.io/Repo': 'targetCommitId',
  'github.krateo.io/PullRequest': 'html_url',
  'github.krateo.io/Repository': 'default_branch',
}

/** The known readiness field for a kind — only when its CRD declares it under `status`. */
export const knownReadyField = (group: string, kind: string, statusFields: readonly string[]): string | null => {
  const key = `${group}/${kind}`
  const field = Object.prototype.hasOwnProperty.call(KNOWN_READY_FIELDS, key) ? KNOWN_READY_FIELDS[key] : null
  return field && statusFields.includes(field) ? field : null
}

/**
 * What installed a group, in a word: the longest dash-bounded prefix its owners share, after the
 * `<namespace>/` a RestDefinition owner carries. Null when there are no owners or they share nothing.
 */
export const groupOwnerLabel = (owners: readonly (string | null)[]): string | null => {
  const names = owners.filter((owner): owner is string => !!owner).map((owner) => owner.slice(owner.lastIndexOf('/') + 1))
  if (!names.length) { return null }
  let shared = names[0].split('-')
  for (const name of names.slice(1)) {
    const parts = name.split('-')
    let common = 0
    while (common < shared.length && common < parts.length && shared[common] === parts[common]) { common += 1 }
    shared = shared.slice(0, common)
  }
  return shared.join('-') || null
}

/** How many nodes of each apiVersion and kind the descriptor holds. */
export const placedCounts = (resources: readonly Pick<ResourceNode, 'apiVersion' | 'kind'>[]): Map<string, number> => {
  const counts = new Map<string, number>()
  for (const node of resources) {
    const key = `${node.apiVersion}|${node.kind}`
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  return counts
}

/** The version part of an apiVersion: `composition.krateo.io/v1-8-40` → `v1-8-40`. */
const versionOf = (apiVersion: string): string => apiVersion.slice(apiVersion.lastIndexOf('/') + 1)

const includes = (query: string, ...texts: string[]): boolean => !query || texts.some((text) => text.toLowerCase().includes(query))

const byText = (left: string, right: string): number => left.localeCompare(right)

const stateOf = <T, >(read: ClassRead<T> | null): { state: SectionState; sentence: string | null; items: T[] } => {
  if (!read) { return { items: [], sentence: null, state: 'loading' } }
  return read.state === 'ok' ? { items: read.items, sentence: null, state: 'ok' } : { items: [], sentence: read.sentence, state: read.state }
}

const nativeRows = (query: string, counts: Map<string, number>): PaletteRow[] => NATIVE_KINDS
  .filter((entry) => includes(query, entry.kind, entry.apiVersion, entry.display))
  .map((entry) => ({
    key: `native:${entry.apiVersion}/${entry.kind}`,
    pick: { apiVersion: entry.apiVersion, cls: 'native', kind: entry.kind },
    placed: counts.get(`${entry.apiVersion}|${entry.kind}`) ?? 0,
    primary: entry.kind,
    secondary: `${entry.display} · ${entry.label}`,
  }))

const customRow = (entry: CustomKind, counts: Map<string, number>): PaletteRow => {
  const apiVersion = `${entry.group}/${entry.version}`
  const ready = knownReadyField(entry.group, entry.kind, entry.statusFields)
  return {
    key: `custom:${entry.group}/${entry.kind}`,
    pick: { apiVersion, cls: 'custom', group: entry.group, kind: entry.kind, plural: entry.plural },
    placed: counts.get(`${apiVersion}|${entry.kind}`) ?? 0,
    primary: entry.kind,
    secondary: ready ? `${entry.version} · ${ready}` : entry.version,
  }
}

const customGroups = (kinds: readonly CustomKind[], query: string, counts: Map<string, number>): CustomGroup[] => {
  const byGroup = new Map<string, CustomKind[]>()
  for (const entry of kinds) {
    byGroup.set(entry.group, [...(byGroup.get(entry.group) ?? []), entry])
  }
  return [...byGroup.entries()].sort(([left], [right]) => byText(left, right)).flatMap(([group, members]) => {
    const sorted = [...members].sort((left, right) => byText(left.kind, right.kind))
    const shown = includes(query, group) ? sorted : sorted.filter((entry) => includes(query, entry.kind))
    return shown.length
      ? [{ group, owner: groupOwnerLabel(members.map((entry) => entry.owner)), rows: shown.map((entry) => customRow(entry, counts)), total: members.length }]
      : []
  })
}

const compositionRows = (items: readonly InstalledBlueprint[], query: string, counts: Map<string, number>, selfKind: string | null): PaletteRow[] => [...items]
  .sort((left, right) => byText(left.name, right.name))
  .filter((item) => includes(query, item.name, item.kind))
  .map((item) => ({
    key: `composition:${item.namespace}/${item.name}`,
    pick: { apiVersion: item.apiVersion, blueprint: item.name, cls: 'composition', kind: item.kind, plural: item.plural },
    placed: counts.get(`${item.apiVersion}|${item.kind}`) ?? 0,
    primary: item.name,
    secondary: `→ ${item.kind} · ${versionOf(item.apiVersion)}${item.running === null ? '' : ` · ${item.running} running`}`,
    ...(item.kind === selfKind ? { selfNesting: true } : {}),
  }))

/** The accessible name of a row: everything it shows, in reading order. */
export const rowLabel = (row: PaletteRow): string => {
  const shown = row.key.startsWith('composition:') ? `${row.primary} ${row.secondary}` : `${row.primary} · ${row.secondary}`
  return row.placed ? `${shown} · placed` : shown
}

export const paletteModel = (
  read: PaletteRead | null,
  filter: string,
  resources: readonly Pick<ResourceNode, 'apiVersion' | 'kind'>[],
  chart: string | null,
): PaletteModel => {
  const query = filter.trim().toLowerCase()
  const counts = placedCounts(resources)
  const custom = stateOf(read?.custom ?? null)
  const namespaced = custom.items.filter((entry) => entry.scope === 'Namespaced')
  const groups = customGroups(namespaced, query, counts)
  const compositions = stateOf(read?.compositions ?? null)
  const selfKind = chart ? compositionKind(chart) : null
  const rows = compositionRows(compositions.items, query, counts, selfKind)
  const native = nativeRows(query, counts)
  return {
    compositions: {
      installed: compositions.items.length,
      rows,
      selfNesting: chart && compositions.items.some((item) => item.kind === selfKind) ? chart : null,
      sentence: compositions.sentence,
      state: compositions.state,
    },
    custom: {
      clusterScoped: custom.items.length - namespaced.length,
      groupCount: new Set(namespaced.map((entry) => entry.group)).size,
      groups,
      kinds: namespaced.length,
      sentence: custom.sentence,
      state: custom.state,
    },
    filter: filter.trim(),
    native,
    // Not while a class is still listing: "nothing matches" would be a claim about kinds not yet read.
    nothingMatches: !!query && custom.state !== 'loading' && compositions.state !== 'loading' && !native.length && !groups.length && !rows.length,
  }
}
