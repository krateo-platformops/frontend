/**
 * The SERVED API VERSION of a controller's Kinds, pinned (frontend#405 round 2). Pure: no React, no
 * network, and no import of the composer modules — the draft store calls `pinServedVersion` on every
 * write of a controller draft, and the store is below them.
 *
 * WHY IT IS PINNED. oasgen-provider derives the version it serves a Kind under from ONE place: the
 * OpenAPI document's `info.version` (render.TargetVersion → crdgen.NormalizeVersionName, so "1.0.27"
 * is served as v1-0-27). A vendor that bumps its spec — 1.0.27 → 1.0.28 — therefore makes the next
 * release serve a NEW version beside the old one, and oasgen prunes the previous non-stored version:
 * every manifest pinned to `<group>/v1-0-27` stops applying. The document's version describes the
 * vendor's API, not the Kind's, so the held document says `v1alpha1` and the Kinds are served as
 * `<group>/v1alpha1` whatever the vendor calls its release.
 *
 * ONE FUNCTION, EVERY WRITE. `pinServedVersion` is called from the draft store's `settle`, which every
 * write of a held controller passes through — the Start modal and the agent's controllerStart (store.set),
 * every inspector / canvas / palette gesture and every agent verb (store.applyFiles), a hand edit in
 * Chart files (store.updateFile), an Undo and a Resume. None of them can hold a document whose
 * info.version is anything else. The lint refuses one regardless (`servedVersionProblems`), in case
 * a tree is read that never went through the store.
 *
 * WHAT IS KEPT. The version the document came with goes into Chart.yaml as
 * `controller.builders.krateo.io/source-spec-version`, and the ConfigMap carries a comment saying
 * why its document says v1alpha1. Once published the served version is locked like the kind and the
 * group (controllerChart.ts lockedSnapshot).
 *
 * WHEN oasgen GROWS A FIELD FOR IT. oasgen may add `spec.resource.version` to the RestDefinition (the
 * version stated on the resource instead of read from the document). When it ships, switch HERE:
 * write `version: v1alpha1` on each RestDefinition (controllerChart.ts planPlaceGroup, beside
 * resourceGroup) and stop rewriting info.version — the document can then stay byte-for-byte the
 * vendor's. Until then the document is the only lever.
 */
import { dump, load } from 'js-yaml'

import { asRecord } from '../../components/Autopilot/kogRestDefSchema'

/** The version every Kind of a controller is served under. */
export const SERVED_VERSION = 'v1alpha1'

/** On Chart.yaml: the info.version the document had before it was pinned. */
export const SOURCE_SPEC_VERSION_ANNOTATION = 'controller.builders.krateo.io/source-spec-version'

/** The chart's Chart.yaml (blueprintDraft.ts CHART_YAML_PATH — not imported, to keep this module a leaf). */
const CHART_YAML = 'Chart.yaml'

/** templates/configmap-oas-<name>.yaml — the files that hold the document (controllerChart.ts CONFIGMAP_PATH). */
export const CONFIGMAP_PATH = /^templates\/configmap-oas-[a-z0-9-]+\.yaml$/

/**
 * `{{` in a document is text, not a template action — escaped the way Go templates spell a literal,
 * so Helm renders the document byte for byte. `}}` outside an action is already literal.
 */
export const HELM_LITERAL_OPEN = '{{`{{`}}'
export const escapeHelm = (text: string): string => text.split('{{').join(HELM_LITERAL_OPEN)
export const unescapeHelm = (text: string): string => text.split(HELM_LITERAL_OPEN).join('{{')

/** The comment a held OAS ConfigMap starts with — what a reader of the file needs to know about info.version. */
export const SERVED_VERSION_COMMENT = [
  `# info.version of the document below is pinned to ${SERVED_VERSION}: oasgen-provider serves each Kind`,
  '# under the version it reads there, and a vendor bump (1.0.27 -> 1.0.28) would serve a new version and',
  '# prune the old one, breaking every manifest pinned to it. The vendor\'s own version is kept in',
  `# Chart.yaml as ${SOURCE_SPEC_VERSION_ANNOTATION}. The Controller Builder rewrites it on every edit.`,
].join('\n')

const yaml = (value: unknown): string => dump(value, { lineWidth: -1, noRefs: true, sortKeys: false })

/** A document's info.version as text (an unquoted YAML `version: 1.0` is a number), or null. */
export const specInfoVersion = (doc: unknown): string | null => {
  const version = asRecord(asRecord(doc)?.info)?.version
  if (typeof version === 'number') { return String(version) }
  return typeof version === 'string' ? version : null
}

/** The document with info.version set to the served version (info created when absent). */
export const pinDocVersion = <T extends Record<string, unknown>>(doc: T): T => ({
  ...doc,
  info: { ...(asRecord(doc.info) ?? {}), version: SERVED_VERSION },
})

/** Parse a document text the way it was written: JSON when it opens with `{`, YAML otherwise. */
const parseDocument = (text: string): { doc: Record<string, unknown>; json: boolean } | null => {
  const json = text.trimStart().startsWith('{')
  try {
    const doc = asRecord(json ? JSON.parse(text) : load(text))
    return doc ? { doc, json } : null
  } catch {
    return null
  }
}

/** A ConfigMap's text with the comment at its head, once. */
const withComment = (text: string): string => (text.startsWith(SERVED_VERSION_COMMENT) ? text : `${SERVED_VERSION_COMMENT}\n${text}`)

/** One ConfigMap pinned: its new text and the versions it carried, or null when nothing needed pinning. */
const pinConfigMap = (text: string): { text: string; sources: string[] } | null => {
  let configMap: Record<string, unknown> | null
  try {
    configMap = asRecord(load(text))
  } catch {
    return null
  }
  const data = asRecord(configMap?.data)
  if (!configMap || !data) { return null }
  const sources: string[] = []
  const nextData: Record<string, unknown> = { ...data }
  for (const [key, value] of Object.entries(data)) {
    if (typeof value !== 'string') { continue }
    const parsed = parseDocument(unescapeHelm(value))
    // Only an OpenAPI document is touched — any other key the ConfigMap carries is left alone.
    if (!parsed || (parsed.doc.openapi === undefined && parsed.doc.swagger === undefined)) { continue }
    const version = specInfoVersion(parsed.doc)
    if (version === SERVED_VERSION) { continue }
    sources.push(version ?? '')
    const pinned = pinDocVersion(parsed.doc)
    nextData[key] = escapeHelm(parsed.json ? `${JSON.stringify(pinned, null, 2)}\n` : yaml(pinned))
  }
  if (!sources.length) { return null }
  return { sources, text: withComment(yaml({ ...configMap, data: nextData })) }
}

/** Chart.yaml with the source-version annotation set (unchanged text when it already says so, or does not read). */
const annotateChart = (text: string, source: string): string => {
  let chart: Record<string, unknown> | null
  try {
    chart = asRecord(load(text))
  } catch {
    return text
  }
  if (!chart) { return text }
  const annotations = { ...(asRecord(chart.annotations) ?? {}) }
  if (annotations[SOURCE_SPEC_VERSION_ANNOTATION] === source) { return text }
  annotations[SOURCE_SPEC_VERSION_ANNOTATION] = source
  return yaml({ ...chart, annotations })
}

/**
 * THE one function: every held OAS ConfigMap's document says info.version v1alpha1, and the version it
 * said before is kept on Chart.yaml. A tree that needs nothing is returned as the same object, byte for
 * byte; a ConfigMap that does not read is left for the lint to name.
 */
export const pinServedVersion = (files: Record<string, string>): Record<string, string> => {
  let next: Record<string, string> | null = null
  let source: string | null = null
  for (const path of Object.keys(files).filter((entry) => CONFIGMAP_PATH.test(entry)).sort()) {
    const pinned = pinConfigMap(files[path])
    if (!pinned) { continue }
    next = { ...(next ?? files), [path]: pinned.text }
    source = source ?? pinned.sources.find((entry) => entry !== '') ?? null
  }
  if (!next) { return files }
  if (source !== null && typeof next[CHART_YAML] === 'string') {
    next[CHART_YAML] = annotateChart(next[CHART_YAML], source)
  }
  return next
}

/** The source version Chart.yaml records, or null. */
export const sourceSpecVersion = (chartText: string | undefined): string | null => {
  try {
    const value = asRecord(asRecord(load(chartText ?? ''))?.annotations)?.[SOURCE_SPEC_VERSION_ANNOTATION]
    return typeof value === 'string' && value ? value : null
  } catch {
    return null
  }
}

/** The lint's half: each held document whose info.version is not the served version. */
export const servedVersionProblems = (path: string, doc: Record<string, unknown>): string[] => {
  const version = specInfoVersion(doc)
  return version === SERVED_VERSION
    ? []
    : [`${path}: the document's info.version is ${version === null ? 'unset' : JSON.stringify(version)}, not ${SERVED_VERSION} — oasgen-provider serves every Kind under the version it reads there, so a vendor's version would move the served API with every spec bump. Set it to ${SERVED_VERSION} (the vendor's version belongs in Chart.yaml's ${SOURCE_SPEC_VERSION_ANNOTATION}).`]
}
