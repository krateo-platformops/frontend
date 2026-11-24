/**
 * WHICH CHART A CompositionDefinition REGISTERS, read from `spec.chart` the way core-provider's getter reads
 * it (plumbing helm/getter: getterFor, ociGetter, tgzGetter, repoGetter). core-provider's chart gate imports
 * this file, so the Builder and the gate have ONE matcher. It imports nothing.
 *
 *   oci://…            the url, then `/` and repo when repo is set: the last path segment, without its tag
 *                      and its digest. repo may carry a path of its own (`team/web`).
 *   http(s)://….tgz    an archive (.tar.gz too): `<name>-<semver>` in its file name. repo is ignored.
 *   http(s)://…        a Helm repository: repo is the chart's name in its index.
 *
 * `unknown` is not "some other chart". It is the caller's to judge: the gate, which sees the final render,
 * refuses it; a draft's half-typed value can look like it, so the Builder does not.
 */
type Json = Record<string, unknown>

/** The charts the reference may be (two only for an archive or a query that reads both ways), or why no one can tell. */
export type ChartReference = { names: string[] } | { unknown: string }

const ARCHIVE = /\.(?:tgz|tar\.gz)$/
const CHART_NAME = /^[a-z0-9][a-z0-9._-]*$/i
const OCI_COMPONENT = /^[a-z0-9]+(?:[._-]+[a-z0-9]+)*$/i
/** semver 2.0.0, with the leading `v` Helm accepts. */
const SEMVER = /^v?(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9a-z-]+(?:\.[0-9a-z-]+)*)?(?:\+[0-9a-z-]+(?:\.[0-9a-z-]+)*)?$/i

const asRecord = (value: unknown): Json | null =>
  (value && typeof value === 'object' && !Array.isArray(value) ? value as Json : null)

const stripSlashes = (text: string): string => text.replace(/\/+$/, '')

const ociReference = (url: string, repo: string): ChartReference => {
  const base = url.slice('oci://'.length)
  const ref = repo ? `${stripSlashes(base)}/${repo}` : base
  const [host, ...path] = stripSlashes(stripSlashes(ref).replace(/@.*$/, '')).split('/')
  // The tag is the last segment's alone: a `:` before it is the registry's port.
  const name = (path.pop() ?? '').replace(/:.*$/, '')
  if (!host || !name) { return { unknown: `spec.chart.url ${JSON.stringify(url)} names a registry, not a chart in it` } }
  return [...path, name].every((component) => OCI_COMPONENT.test(component))
    ? { names: [name] }
    : { unknown: `spec.chart ${JSON.stringify(`oci://${ref}`)} is not an OCI chart reference` }
}

const archiveReference = (pathname: string): ChartReference => {
  let file: string
  try {
    file = decodeURIComponent(pathname.slice(pathname.lastIndexOf('/') + 1))
  } catch {
    return { unknown: `the file name in ${JSON.stringify(pathname)} is not readable` }
  }
  const stem = file.replace(ARCHIVE, '')
  // Every `-` may be the one between name and version: `web-1.0.0-2.0.0` is web at a pre-release, or
  // web-1.0.0 at 2.0.0. So every reading is kept, never one dash chosen.
  const names = [...stem.matchAll(/-/g)].map(({ index }) => index)
    .filter((at) => CHART_NAME.test(stem.slice(0, at)) && SEMVER.test(stem.slice(at + 1)))
    .map((at) => stem.slice(0, at))
  return names.length
    ? { names }
    : { unknown: `the archive ${JSON.stringify(file)} is not named <chart>-<version>.tgz, so its name does not say which chart it holds` }
}

const repositoryReference = (url: string, repo: string): ChartReference => {
  if (!repo) { return { unknown: `spec.chart.url ${JSON.stringify(url)} is a Helm repository and spec.chart.repo does not say which of its charts` } }
  return CHART_NAME.test(repo) ? { names: [repo] } : { unknown: `spec.chart.repo ${JSON.stringify(repo)} is not a chart name` }
}

const httpReference = (url: string, repo: string): ChartReference => {
  let pathname: string
  try {
    ({ pathname } = new URL(url))
  } catch {
    return { unknown: `spec.chart.url ${JSON.stringify(url)} is not a URL` }
  }
  const endsInArchive = ARCHIVE.test(url)
  if (!ARCHIVE.test(pathname)) {
    return endsInArchive
      ? { unknown: `spec.chart.url ${JSON.stringify(url)} is an archive with no file name` }
      : repositoryReference(url, repo)
  }
  const archive = archiveReference(pathname)
  // With a query or a fragment the url no longer ENDS in .tgz, and the getter then reads it as a
  // repository: with a repo set, either of the two may be the chart.
  if (endsInArchive || !repo || 'unknown' in archive) { return archive }
  const repository = repositoryReference(url, repo)
  return 'unknown' in repository ? repository : { names: [...repository.names, ...archive.names] }
}

/** What a definition's `spec.chart` names. */
export const chartReference = (chart: unknown): ChartReference => {
  const fields = asRecord(chart)
  if (!fields) { return { unknown: 'it has no spec.chart' } }
  const { url } = fields
  const repo = fields.repo ?? ''
  if (typeof url !== 'string' || !url) { return { unknown: 'it has no spec.chart.url' } }
  if (typeof repo !== 'string') { return { unknown: 'spec.chart.repo is not a string' } }
  if (url.startsWith('oci://')) { return ociReference(url, repo) }
  return /^https?:\/\//.test(url)
    ? httpReference(url, repo)
    : { unknown: `spec.chart.url ${JSON.stringify(url)} is neither oci:// nor http(s)://` }
}

/**
 * Names are compared WITHOUT case: core-provider generates the same Kind from `Hello-Web` and `hello-web`,
 * so a definition of either collides with this chart's.
 */
export const registersChart = (reference: ChartReference, chart: string): boolean =>
  'names' in reference && reference.names.some((name) => name.toLowerCase() === chart.toLowerCase())

const GROUP = 'core.krateo.io'
const KIND = 'CompositionDefinition'

export interface FoundDefinition { name: string; reference: ChartReference }

/**
 * Every CompositionDefinition in a rendered object, at any version of the group: the object itself, and
 * whatever its `items` hold. helm and kubectl install the items of ANY object that has them, not only of a
 * `kind: List`, and an item with neither apiVersion nor kind takes them from its list.
 */
export const definitionsIn = (body: Json, apiVersion: string, kind: string): FoundDefinition[] => {
  const ours = apiVersion.split('/')[0] === GROUP
  const name = asRecord(body.metadata)?.name
  const found: FoundDefinition[] = ours && kind === KIND
    ? [{ name: typeof name === 'string' ? name : '', reference: chartReference(asRecord(body.spec)?.chart) }]
    : []
  const unreadable = (reason: string): FoundDefinition[] =>
    (ours && kind === `${KIND}List` ? [{ name: '', reference: { unknown: reason } }] : [])
  if (!Array.isArray(body.items)) { return [...found, ...unreadable(`it is a ${kind} with no items list`)] }
  const text = (value: unknown): string => (typeof value === 'string' ? value : '')
  return [...found, ...body.items.flatMap((item: unknown) => {
    const record = asRecord(item)
    if (!record) { return unreadable(`an item of its ${kind} is not an object`) }
    const inherits = !record.apiVersion && !record.kind
    return definitionsIn(record, inherits ? apiVersion : text(record.apiVersion), inherits ? kind.replace(/List$/, '') : text(record.kind))
  })]
}
