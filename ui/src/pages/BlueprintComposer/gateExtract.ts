/**
 * Read a chart's `lookup` guards back into a descriptor — the migration direction.
 *
 * WHY THIS IS THE HYPOTHESIS TEST. The architecture file claims that a blueprint's ordering is a
 * graph of `dependsOn` + `readyWhen`. `builder-publish` is a real chart whose five states are
 * documented in its own comments. If reading its templates does not reproduce those states, the
 * model is wrong — and this is the cheapest place to find out, before any UI exists.
 *
 * SIX CLASSES OF LOOKUP, NOT ONE. Reading the fixture showed that "a lookup is a dependency" is
 * false often enough to matter:
 *   dependency  — `lookup` + `dig "status" …` deciding a `$gate`: the edge this file exists for
 *   preflight   — `lookup` followed by `fail`: validation of install-level objects, not sequencing
 *   capability  — a CustomResourceDefinition lookup that degrades instead of failing
 *   self        — a template reading its OWN live object to freeze an immutable field
 *   shim        — a lookup digging `spec` (a reference), not `status` (readiness): a lifecycle gate
 *   support     — Namespace/Secret reads that only disambiguate one of the above
 * Anything else is reported as UNCLASSIFIED, never guessed. The fixture test asserts zero.
 *
 * SCANNING, NOT PARSING. A Helm template is not YAML until it is rendered, so this walks lines and
 * tracks `if`/`range`/`with` … `end` nesting to know what encloses the manifest. It is deliberately
 * narrow — it recognises the idioms Krateo charts actually use — and honest about the rest.
 */
import type { ChartArchitecture, Dependency, ResourceClass, ResourceNode } from './architecture'
import { ARCHITECTURE_API_VERSION, ARCHITECTURE_KIND } from './architecture'

export type LookupClass = 'dependency' | 'preflight' | 'capability' | 'self' | 'shim' | 'support' | 'unclassified'

export interface LookupFinding {
  template: string
  line: number
  apiVersion: string
  kind: string
  class: LookupClass
  /** For a dependency: the status field the gate digs. */
  readyWhen?: string
}

export interface ExtractResult {
  architecture: ChartArchitecture
  findings: LookupFinding[]
}

interface Block {
  keyword: 'if' | 'range' | 'with'
  cond: string
  line: number
}

const NATIVE_GROUPS = new Set(['v1', 'apps/v1', 'batch/v1', 'networking.k8s.io/v1', 'rbac.authorization.k8s.io/v1', 'policy/v1'])

const classOf = (apiVersion: string): ResourceClass => {
  if (NATIVE_GROUPS.has(apiVersion)) { return 'native' }
  if (apiVersion.startsWith('composition.krateo.io/')) { return 'composition' }
  return 'custom'
}

// Helm block comments (double-brace slash-star … star-slash double-brace) may span lines and talk
// about ifs and ends in prose; they must go before any scanning. Each is replaced by the newlines
// it spanned, so every finding still reports the line a person will find in the file.
const stripComments = (text: string): string =>
  text.replace(/\{\{-?\s*\/\*[\s\S]*?\*\/\s*-?\}\}/g, (comment) => '\n'.repeat((comment.match(/\n/g) ?? []).length))

/** `$src := .Values.source | default dict` → `$src` = `.Values.source`. One level is all the idiom needs. */
const collectVars = (lines: string[]): Map<string, string> => {
  const vars = new Map<string, string>()
  for (const line of lines) {
    for (const found of line.matchAll(/\{\{-?\s*(\$\w+)\s*:=\s*([^}]+?)\s*-?\}\}/g)) {
      vars.set(found[1], found[2].replace(/\s*\|\s*default\s+dict\s*$/, '').trim())
    }
  }
  return vars
}

const resolveValuesPath = (cond: string, vars: Map<string, string>): string | null => {
  const found = /^(\$\w+|\.Values)((?:\.\w+)*)$/.exec(cond.trim())
  if (!found) { return null }
  const head = found[1] === '.Values' ? '.Values' : vars.get(found[1])
  if (!head || !head.startsWith('.Values')) { return null }
  return `${head}${found[2]}`
}

const ACTION = /\{\{-?\s*([\s\S]*?)\s*-?\}\}/g

/** Walk the file once, keeping the stack of open blocks at every line. */
const scanBlocks = (lines: string[]): Block[][] => {
  const stack: Block[] = []
  const open: Block[][] = []
  lines.forEach((line, idx) => {
    open.push([...stack])
    for (const action of line.matchAll(ACTION)) {
      const body = action[1].trim()
      const opener = /^(if|range|with)\b\s*([\s\S]*)$/.exec(body)
      if (opener) {
        stack.push({ cond: opener[2].trim(), keyword: opener[1] as Block['keyword'], line: idx + 1 })
      } else if (/^end\b/.test(body)) {
        stack.pop()
      }
    }
  })
  return open
}

const LOOKUP = /lookup\s+"([^"]+)"\s+"([^"]+)"/g
const FILES_RANGE = /^\$\w+,\s*\$\w+\s*:=\s*\(include\s+"([^"]+)"/

const rangedFiles = (blocks: Block[]): string | undefined => {
  const range = blocks.find((block) => block.keyword === 'range' && FILES_RANGE.test(block.cond))
  return range ? FILES_RANGE.exec(range.cond)?.[1] : undefined
}

const innermostValuesCond = (blocks: Block[], vars: Map<string, string>): string | undefined => {
  for (let idx = blocks.length - 1; idx >= 0; idx -= 1) {
    if (blocks[idx].keyword !== 'if') { continue }
    const path = resolveValuesPath(blocks[idx].cond, vars)
    if (path) { return path }
  }
  return undefined
}

interface RawLookup extends LookupFinding {
  all: boolean
  when?: string
  digsSpec: boolean
  window: string
}

interface Scanned {
  template: string
  id: string
  apiVersion?: string
  kind?: string
  when?: string
  forEach?: string
  lookups: RawLookup[]
}

const scanTemplate = (path: string, text: string): Scanned => {
  const lines = stripComments(text).split('\n')
  const vars = collectVars(lines)
  const open = scanBlocks(lines)
  const id = path.replace(/^templates\//, '').replace(/\.ya?ml$/, '')
  const out: Scanned = { id, lookups: [], template: path }
  lines.forEach((line, idx) => {
    if (out.kind === undefined) {
      const kindMatch = /^kind:\s*(\S+)/.exec(line)
      if (kindMatch) {
        out.kind = kindMatch[1]
        const ifs = open[idx].filter((block) => block.keyword === 'if')
        const when = ifs.map((block) => resolveValuesPath(block.cond, vars)).find((resolved): resolved is string => !!resolved)
        if (when) { out.when = when }
        out.forEach = rangedFiles(open[idx])
      }
      const apiMatch = /^apiVersion:\s*(\S+)/.exec(line)
      if (apiMatch && out.apiVersion === undefined) { out.apiVersion = apiMatch[1] }
    }
    for (const found of line.matchAll(LOOKUP)) {
      const window = lines.slice(idx, idx + 4).join('\n')
      const dig = /dig\s+"status"\s+"([^"]+)"/.exec(window)
      out.lookups.push({
        all: rangedFiles(open[idx]) !== undefined,
        apiVersion: found[1],
        class: 'unclassified',
        digsSpec: /dig\s+"spec"/.test(window),
        kind: found[2],
        line: idx + 1,
        readyWhen: dig ? `.status.${dig[1]}` : undefined,
        template: path,
        when: innermostValuesCond(open[idx], vars),
        window,
      })
    }
  })
  return out
}

type Rendered = Scanned & { apiVersion: string; kind: string }

const classify = (scan: Rendered, found: RawLookup): LookupClass => {
  if (/\bfail\b/.test(found.window)) { return 'preflight' }
  if (found.kind === 'CustomResourceDefinition') { return 'capability' }
  if (`${found.apiVersion}/${found.kind}` === `${scan.apiVersion}/${scan.kind}`) { return 'self' }
  if (found.all && found.digsSpec) { return 'shim' }
  if (found.readyWhen && /\$\w+\s*=\s*(true|false)/.test(found.window)) { return 'dependency' }
  if (found.kind === 'Namespace' || found.kind === 'Secret') { return 'support' }
  return 'unclassified'
}

interface Ledger {
  byKind: Map<string, Rendered>
  readiness: Map<string, string>
  deps: Map<string, Dependency[]>
}

/** A dependency lookup becomes an edge from the scanning template to the template that renders the looked-up kind. */
const recordEdge = (ledger: Ledger, scan: Rendered, found: RawLookup): void => {
  const target = ledger.byKind.get(`${found.apiVersion}/${found.kind}`)
  if (!target || !found.readyWhen) { return }
  ledger.readiness.set(target.id, found.readyWhen)
  const edge: Dependency = { ready: true, ref: target.id }
  if (found.all) { edge.all = true }
  if (found.when && found.when !== scan.when) { edge.when = found.when }
  const list = ledger.deps.get(scan.id) ?? []
  if (!list.some((existing) => existing.ref === edge.ref)) { list.push(edge) }
  ledger.deps.set(scan.id, list)
}

/**
 * Classify every lookup, then build the descriptor from the dependency class alone. `readyWhen`
 * on a node is what OTHER templates dig on it — the chart's own definition of "ready", read
 * rather than invented.
 */
export const extractArchitecture = (chart: string, templates: Record<string, string>): ExtractResult => {
  const scanned = Object.entries(templates)
    .filter(([path]) => /\.ya?ml$/.test(path) && !/\/_/.test(path))
    .map(([path, text]) => scanTemplate(path, text))
    .filter((scan): scan is Rendered => !!scan.apiVersion && !!scan.kind)
  const ledger: Ledger = { byKind: new Map(scanned.map((scan) => [`${scan.apiVersion}/${scan.kind}`, scan])), deps: new Map(), readiness: new Map() }
  const findings: LookupFinding[] = []
  const shimmed = new Set<string>()

  for (const scan of scanned) {
    for (const found of scan.lookups) {
      const cls = classify(scan, found)
      findings.push({ apiVersion: found.apiVersion, class: cls, kind: found.kind, line: found.line, readyWhen: cls === 'dependency' ? found.readyWhen : undefined, template: found.template })
      if (cls === 'dependency') { recordEdge(ledger, scan, found) }
      if (cls === 'shim') { shimmed.add(scan.id) }
    }
  }

  const resources: ResourceNode[] = scanned.map((scan) => {
    const node: ResourceNode = { apiVersion: scan.apiVersion, class: classOf(scan.apiVersion), id: scan.id, kind: scan.kind, template: scan.template }
    if (scan.when) { node.when = scan.when }
    if (scan.forEach) { node.forEach = scan.forEach }
    const edges = ledger.deps.get(scan.id)
    if (edges?.length) { node.dependsOn = edges }
    const ready = ledger.readiness.get(scan.id)
    if (ready) { node.readyWhen = ready }
    if (shimmed.has(scan.id)) { node.lifecycle = 'shim' }
    return node
  })

  return { architecture: { apiVersion: ARCHITECTURE_API_VERSION, chart, kind: ARCHITECTURE_KIND, resources }, findings }
}
