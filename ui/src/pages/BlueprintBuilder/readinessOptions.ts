/**
 * What the Ready when picker offers for a node, and what it says instead when it cannot. Pure.
 *
 * FROM THE CLUSTER, NOT FROM A GUESS (06:85-93). A custom resource offers the scalar fields its CRD
 * declares under `status`, and the Ready condition only when the CRD declares conditions (D3); the
 * one known-kind suggestion the palette already shows (paletteModel's `knownReadyField`) is
 * preselected when the CRD declares it. A composition offers its default — Ready and Synced — first,
 * then its status fields. A native kind the palette knows offers its kstatus meaning. Custom jq is not
 * offered: nothing compiles it into a gate (D2).
 *
 * WHICH CRD. A node carries apiVersion and kind, not its plural, and a cluster-scoped `/call` read
 * needs the name `<plural>.<group>`. The palette's RESTAction lists the plurals of what this person
 * may place — the same list a node was placed from — so the CRD is found there, never by pluralising
 * a Kind. A kind the palette does not list is said, in words.
 */
import type { ResourceNode } from './architecture'
import { apiGroup } from './architectureView'
import type { PaletteRead } from './blueprintPalette'
import type { CrdStatusFields } from './crdStatusFields'
import { knownReadyField } from './paletteModel'
import { conditionReadyWhen, defaultReadiness } from './readyWhen'

/** The CRD a node's status schema is read from — or null when it has none to read (a native kind). */
export type CrdOf = { name: string; version: string } | { missing: string } | { pending: true } | null

const versionOf = (apiVersion: string): string => apiVersion.slice(apiVersion.lastIndexOf('/') + 1)

export const crdOf = (node: Pick<ResourceNode, 'apiVersion' | 'class' | 'kind'>, palette: PaletteRead | null): CrdOf => {
  if (node.class === 'native') { return null }
  if (!palette) { return { pending: true } }
  const group = apiGroup(node.apiVersion)
  const custom = palette.custom.state === 'ok' ? palette.custom.items : []
  const compositions = palette.compositions.state === 'ok' ? palette.compositions.items : []
  const plural = node.class === 'custom'
    ? custom.find((kind) => kind.group === group && kind.kind === node.kind)?.plural
    : compositions.find((item) => item.apiVersion === node.apiVersion && item.kind === node.kind)?.plural
  return plural
    ? { name: `${plural}.${group}`, version: versionOf(node.apiVersion) }
    : { missing: `${node.kind} is not among the kinds this portal lists for you, so its CRD — and its status fields — cannot be read here.` }
}

/** The status read, as the picker sees it. */
export type StatusRead =
  | { state: 'none' }
  | { state: 'loading' }
  | { state: 'ok'; fields: CrdStatusFields }
  | { state: 'unavailable'; sentence: string }

/** A failed CRD read, in the words of the S4 spec (5.5). */
export const crdReadSentence = (crd: string, error: string): string => (/\b403\b/.test(error)
  ? `You may not read the CustomResourceDefinition ${crd}, so its status fields cannot be listed. Ask a platform admin for read access, or turn off Wait for readiness.`
  : `Could not read ${crd} — ${error}.`)

export interface ReadinessOption {
  /** The readyWhen this option writes — '' is the class default (no readyWhen). */
  value: string
  label: string
  hint: string
}

export interface ReadinessChoices {
  options: ReadinessOption[]
  /** What starts selected: the node's own readyWhen, else the suggestion, else the default — or null for nothing. */
  suggested: string | null
  /** Why there is nothing (or less) to pick, when that is so. */
  sentence: string | null
  /** The screen-6 note under a custom resource's fields (06:93). */
  note: string | null
}

export const CUSTOM_NOTE = 'A custom resource has no default. These are the fields the CRD declares under status; nothing is guessed.'

const fieldOption = (value: string): ReadinessOption => ({ hint: 'is set', label: value, value })

export const readinessOptions = (node: ResourceNode, read: StatusRead): ReadinessChoices => {
  const fields = read.state === 'ok' ? read.fields.fields.map(fieldOption) : []
  const conditions = read.state === 'ok' && read.fields.conditions && node.class === 'custom'
    ? [{ hint: '== True', label: '.status.conditions[type=Ready]', value: conditionReadyWhen('Ready') }]
    : []
  const fallback = defaultReadiness(node)
  const options = [...(fallback ? [{ hint: 'default', label: fallback, value: '' }] : []), ...fields, ...conditions]
  if (node.readyWhen && !options.some((option) => option.value === node.readyWhen)) {
    options.unshift({ hint: 'declared', label: node.readyWhen, value: node.readyWhen })
  }
  const top = read.state === 'ok' ? read.fields.fields.filter((path) => path.split('.').length === 3).map((path) => path.slice('.status.'.length)) : []
  const known = node.class === 'custom' ? knownReadyField(apiGroup(node.apiVersion), node.kind, top) : null
  let suggested: string | null = node.readyWhen ?? null
  if (suggested === null) { suggested = known ? `.status.${known}` : null }
  if (suggested === null && fallback) { suggested = '' }
  let sentence: string | null = null
  if (read.state === 'loading') {
    sentence = `Reading ${node.kind}'s status fields…`
  } else if (read.state === 'unavailable') {
    sentence = read.sentence
  } else if (node.class === 'custom' && read.state === 'ok' && !fields.length && !conditions.length) {
    sentence = `${node.kind}'s CRD declares no status fields, so there is nothing to wait on. Turn off Wait for readiness (it only has to exist).`
  } else if (node.class === 'native' && !fallback) {
    sentence = `${node.kind} has no readiness the composer knows. Turn off Wait for readiness (it only has to exist).`
  }
  return { note: node.class === 'custom' && read.state === 'ok' && fields.length ? CUSTOM_NOTE : null, options, sentence, suggested }
}
