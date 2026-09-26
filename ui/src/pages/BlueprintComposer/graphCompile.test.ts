/**
 * THE GOLDEN. `__fixtures__/builder-publish/expected.architecture-template.yaml` is the
 * templates/architecture.yaml the portal ships in helm/builder-publish, copied from here byte for
 * byte (S11c). Rendered with `helm template` against the values of the live builder-publish
 * compositions, it names the ConfigMap `<composition>-architecture` (the release name with no
 * `global`), and for publish-pod-sizing-demo its 13 node names equal the composition's
 * `status.managed` exactly. So this suite pins the compiler to a file whose output is known to be
 * right, rather than to a snapshot of whatever the compiler did last.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { lintBlueprintDraft } from '../../components/Autopilot/blueprintDraft'

import {
  ARCHITECTURE_API_VERSION,
  ARCHITECTURE_KIND,
  ARCHITECTURE_TEMPLATE_PATH,
  parseArchitecture,
  serializeArchitecture,
  unwrapFromConfigMapTemplate,
  wrapAsConfigMapTemplate,
  type ResourceNode,
} from './architecture'
import { GRAPH_BEGIN, GRAPH_END, graphBlockIn } from './graphCompile'

const FIXTURE = join(__dirname, '__fixtures__', 'builder-publish')
const GOLDEN = readFileSync(join(FIXTURE, 'expected.architecture-template.yaml'), 'utf8')

const rewrap = (template: string, chart: string): string => {
  const descriptor = unwrapFromConfigMapTemplate(template)
  if (descriptor === null) { throw new Error('not an architecture template') }
  return wrapAsConfigMapTemplate(descriptor, chart)
}

const descriptorOf = (resources: ResourceNode[], states?: { name: string }[]): string =>
  serializeArchitecture({ apiVersion: ARCHITECTURE_API_VERSION, chart: 'demo', kind: ARCHITECTURE_KIND, resources, states })

/** The block's lines, markers excluded. */
const blockLines = (template: string): string[] => (graphBlockIn(template) ?? '').split('\n').slice(1, -1)

describe('the builder-publish golden — what the portal copies byte for byte', () => {
  it('compiles byte-equal from its own descriptor', () => {
    expect(rewrap(GOLDEN, 'builder-publish')).toBe(GOLDEN)
  })

  it('its descriptor is the one the extractor reads out of the chart, in the chart\'s order with its states', () => {
    const golden = parseArchitecture(unwrapFromConfigMapTemplate(GOLDEN)!)
    const extracted = parseArchitecture(readFileSync(join(FIXTURE, 'expected.architecture.yaml'), 'utf8'))
    if (!golden.ok || !extracted.ok) { throw new Error('both descriptors must parse') }
    expect(golden.architecture.resources.map((node) => node.id)).toEqual(['repository', 'repo', 'localresources', 'pullrequest', 'username-secret'])
    expect(golden.architecture.states?.map((state) => state.name)).toEqual(['repository-only', 'seeding', 'committing', 'change-request-open'])
    for (const node of golden.architecture.resources) {
      const read = extracted.architecture.resources.find((candidate) => candidate.id === node.id)
      // A shim's name is optional, and the golden leaves it out: nothing on the page joins on a shim.
      expect(node).toEqual(node.lifecycle ? { ...read, name: undefined } : read)
    }
    expect(serializeArchitecture(golden.architecture)).toBe(unwrapFromConfigMapTemplate(GOLDEN))
  })

  it('passes the lint a chart is held to, with the templates it names (L1–L5 on a real chart)', () => {
    const dir = join(FIXTURE, 'templates')
    const files: Record<string, string> = {
      [ARCHITECTURE_TEMPLATE_PATH]: GOLDEN,
      'Chart.yaml': 'apiVersion: v2\nname: builder-publish\nversion: 1.8.40\n',
      'values.schema.json': JSON.stringify({ properties: { name: { type: 'string' } }, type: 'object' }),
      'values.yaml': readFileSync(join(FIXTURE, 'values.yaml'), 'utf8'),
    }
    for (const file of readdirSync(dir)) {
      files[`templates/${file}`] = readFileSync(join(dir, file), 'utf8')
    }
    expect(lintBlueprintDraft(files, 'blueprint')).toEqual([])
  })
})

describe('compileGraphBlock — the compile rules', () => {
  it('is idempotent: regenerating a regenerated file changes nothing', () => {
    const once = wrapAsConfigMapTemplate(descriptorOf([
      { apiVersion: 'v1', class: 'native', id: 'cfg', kind: 'ConfigMap', name: '"cfg"', template: 't/cfg.yaml' },
      { apiVersion: 'apps/v1', class: 'native', dependsOn: [{ ref: 'cfg' }], id: 'web', kind: 'Deployment', name: 'printf "%s-web" .Release.Name', template: 't/web.yaml' },
    ]), 'demo')
    expect(rewrap(once, 'demo')).toBe(once)
    expect(rewrap(rewrap(once, 'demo'), 'demo')).toBe(once)
  })

  it('an empty descriptor compiles to no nodes and no states', () => {
    const template = wrapAsConfigMapTemplate(descriptorOf([]), 'demo')
    expect(blockLines(template)).toEqual([
      '{{- $v := .Values.AsMap }}',
      '{{- $nodes := list }}',
      '{{- $names := list }}',
      expect.stringMatching(/^ {2}graph: \{\{ dict "v" 1 "chart" "demo" "states" \(list\) "composition" \(dict .*\) "nodes" \$nodes \| toJson \| quote \}\}$/),
    ])
    expect(graphBlockIn(template)?.startsWith(GRAPH_BEGIN)).toBe(true)
    expect(graphBlockIn(template)?.endsWith(GRAPH_END)).toBe(true)
  })

  it('a node with no when is always present, and its names are not wrapped in an if', () => {
    const lines = blockLines(wrapAsConfigMapTemplate(descriptorOf([
      { apiVersion: 'v1', class: 'native', id: 'cfg', kind: 'ConfigMap', name: '"cfg"', template: 't/cfg.yaml' },
    ]), 'demo'))
    expect(lines).toContain('{{- $present := true }}')
    expect(lines).toContain('{{- $names = append $names ("cfg") }}')
  })

  it('a Values-path forEach ranges over the values map, nil-safe, inside its when', () => {
    const lines = blockLines(wrapAsConfigMapTemplate(descriptorOf([
      { apiVersion: 'v1', class: 'native', forEach: '.Values.parts.list', id: 'part', kind: 'ConfigMap', name: 'printf "%s-%d" $.Values.name $i', template: 't/p.yaml', when: '.Values.parts.enabled' },
    ]), 'demo'))
    expect(lines).toContain('{{- $present := not (empty (dig "parts" "enabled" "" $v)) }}')
    expect(lines).toContain('{{- if $present }}{{- range $i, $f := (dig "parts" "list" (list) $v) }}{{- with $ }}{{- $names = append $names (printf "%s-%d" $.Values.name $i) }}{{- end }}{{- end }}{{- end }}')
  })

  it('a sequenced node with no name yet names nothing — the lint asks for one', () => {
    const lines = blockLines(wrapAsConfigMapTemplate(descriptorOf([
      { apiVersion: 'v1', class: 'native', id: 'cfg', kind: 'ConfigMap', template: 't/cfg.yaml' },
    ]), 'demo'))
    expect(lines.some((line) => line.includes('append $names'))).toBe(false)
    expect(lines).toContain('{{- $nodes = append $nodes (dict "id" "cfg" "apiVersion" "v1" "kind" "ConfigMap" "class" "native" "level" 0 "forEach" false "present" $present "names" $names "dependsOn" (list)) }}')
  })

  it('a shim\'s when is answered inline — it has no level, no names and no place in the sequence', () => {
    const lines = blockLines(wrapAsConfigMapTemplate(descriptorOf([
      { apiVersion: 'v1', class: 'native', id: 'legacy', kind: 'Secret', lifecycle: 'shim', name: '"legacy"', template: 't/l.yaml', when: '.Values.legacy' },
    ]), 'demo'))
    expect(lines).toContain('{{- $nodes = append $nodes (dict "id" "legacy" "apiVersion" "v1" "kind" "Secret" "class" "native" "lifecycle" "shim" "forEach" false "present" (not (empty (dig "legacy" "" $v))) "names" (list) "dependsOn" (list)) }}')
    expect(lines.some((line) => line.includes('$present'))).toBe(false)
  })

  it('an edge carries its own when as `active`, and state names are quoted as Go strings', () => {
    const template = wrapAsConfigMapTemplate(descriptorOf([
      { apiVersion: 'v1', class: 'native', id: 'a', kind: 'ConfigMap', name: '"a"', template: 't/a.yaml' },
      { apiVersion: 'v1', class: 'native', dependsOn: [{ all: true, ref: 'a', when: '.Values.x' }], id: 'b', kind: 'ConfigMap', name: '"b"', template: 't/b.yaml' },
    ], [{ name: 'say "hi"' }]), 'demo')
    expect(template).toContain('"dependsOn" (list (dict "ref" "a" "ready" false "all" true "active" (not (empty (dig "x" "" $v))))))')
    expect(template).toContain('"states" (list "say \\"hi\\"" "level-1")')
  })

  it('a descriptor with a cycle has no levels to compile, so no block', () => {
    const template = wrapAsConfigMapTemplate(descriptorOf([
      { apiVersion: 'v1', class: 'native', dependsOn: [{ ref: 'b' }], id: 'a', kind: 'ConfigMap', name: '"a"', template: 't/a.yaml' },
      { apiVersion: 'v1', class: 'native', dependsOn: [{ ref: 'a' }], id: 'b', kind: 'ConfigMap', name: '"b"', template: 't/b.yaml' },
    ]), 'demo')
    expect(graphBlockIn(template)).toBeNull()
  })
})
