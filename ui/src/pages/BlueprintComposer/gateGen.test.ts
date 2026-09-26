import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { parseArchitecture, type ResourceNode } from './architecture'
import { applyGate, GATE_BEGIN, GATE_END, renderGatePreamble, unmanagedLookups } from './gateGen'

const FIXTURE = join(__dirname, '__fixtures__', 'builder-publish')
const parsed = parseArchitecture(readFileSync(join(FIXTURE, 'expected.architecture.yaml'), 'utf8'))
if (!parsed.ok) { throw new Error('fixture descriptor must parse') }
const arch = parsed.architecture

// The names are the descriptor's own now — builder-publish's, as the extractor read them from its
// templates' metadata.name.
const node = (id: string): ResourceNode => {
  const found = arch.resources.find((candidate) => candidate.id === id)
  if (!found) { throw new Error(`no fixture node ${id}`) }
  return found
}

describe('renderGatePreamble — the edge compiled to the lookup the chart writes by hand', () => {
  it('a ready edge becomes a lookup of the node\'s own name, guarded on the target readyWhen, inside a nil-safe edge when', () => {
    const result = renderGatePreamble(node('localresources'), arch)
    expect(result.ok).toBe(true)
    if (!result.ok) { return }
    expect(result.block.startsWith(GATE_BEGIN)).toBe(true)
    // `if .Values.repository.create` fails the render when `repository` is absent; dig does not.
    expect(result.block).toContain('{{- if not (empty (dig "repository" "create" "" (.Values.AsMap))) -}}')
    expect(result.block).not.toContain('{{- if .Values.')
    expect(result.block).toContain('lookup "github.krateo.io/v2022-11-28" "Repository" .Release.Namespace (printf "%s-repo" .Values.name | trunc 63 | trimSuffix "-")')
    expect(result.block).toContain('dig "status" "default_branch" "" $dep0')
    expect(result.block).toContain('{{- if not (empty (dig "source" "url" "" (.Values.AsMap))) -}}')
    expect(result.block).toContain('dig "status" "targetCommitId" "" $dep1')
    expect(result.block.endsWith('{{- if $gate }}')).toBe(true)
  })

  it('all: true over a helper forEach ranges the files, as pullrequest.yaml:87-93 does — the lookup inside `with $`', () => {
    const result = renderGatePreamble(node('pullrequest'), arch)
    expect(result.ok).toBe(true)
    if (!result.ok) { return }
    expect(result.block).toContain('{{- range $i, $f := (include "builder-publish.files" $ | fromYamlArray) -}}\n{{- with $ -}}\n')
    expect(result.block).toContain('lookup "git.krateo.io/v1alpha1" "LocalResource" .Release.Namespace (printf "%s-%03d" $.Values.name (int $i) | trunc 63 | trimSuffix "-")')
    expect(result.block).toContain('dig "status" "targetCommitId"')
    expect(result.block).toContain('{{- end -}}\n{{- end -}}')
  })

  it('all: true over a Values-path forEach ranges the values, nil-safe — not an include of a helper that does not exist', () => {
    const paths = parseArchitecture([
      'apiVersion: architecture.krateo.io/v1alpha1',
      'kind: ChartArchitecture',
      'chart: paths',
      'resources:',
      '  - { id: part, class: native, apiVersion: v1, kind: ConfigMap, template: t/p.yaml, forEach: .Values.parts.list, name: printf "p-%d" $i }',
      '  - { id: after, class: native, apiVersion: v1, kind: ConfigMap, template: t/a.yaml, name: \'"after"\', dependsOn: [{ ref: part, all: true }] }',
    ].join('\n'))
    if (!paths.ok) { throw new Error(JSON.stringify(paths.problems)) }
    const result = renderGatePreamble(paths.architecture.resources[1], paths.architecture)
    expect(result.ok).toBe(true)
    if (!result.ok) { return }
    expect(result.block).toContain('{{- range $i, $f := (dig "parts" "list" (list) (.Values.AsMap)) -}}')
    expect(result.block).not.toContain('include')
    expect(result.block).toContain('lookup "v1" "ConfigMap" .Release.Namespace (printf "p-%d" $i)')
  })

  it('a node with nothing to wait on has no gate', () => {
    expect(renderGatePreamble(node('repository'), arch)).toEqual({ ok: false, reason: '"repository" has no dependsOn — nothing to gate' })
  })

  it('a target without a name is a refusal, not a template with a hole in it', () => {
    const unnamed = { ...arch, resources: arch.resources.map((resource) => (resource.id === 'repository' ? { ...resource, name: undefined } : resource)) }
    expect(renderGatePreamble(node('repo'), unnamed))
      .toEqual({ ok: false, reason: '"repository" has no name — the gate looks its object up by the name its template gives it' })
  })

  it('an id that is an Object.prototype name is named by its own field, never by the prototype', () => {
    // `constructor` is a legal id (a DNS label). An index keyed by id used to find Object's own
    // constructor for it: truthy, so the gate rendered `lookup … (function Object() { [native code] })`.
    const proto = (named: boolean) => parseArchitecture([
      'apiVersion: architecture.krateo.io/v1alpha1',
      'kind: ChartArchitecture',
      'chart: proto',
      'resources:',
      `  - { id: constructor, class: native, apiVersion: v1, kind: ConfigMap, template: templates/a.yaml${named ? ', name: \'"cm-a"\'' : ''} }`,
      '  - { id: after, class: native, apiVersion: v1, kind: ConfigMap, template: templates/b.yaml, dependsOn: [{ ref: constructor }] }',
    ].join('\n'))
    const bare = proto(false)
    const named = proto(true)
    if (!bare.ok || !named.ok) { throw new Error('fixture must parse') }
    expect(renderGatePreamble(bare.architecture.resources[1], bare.architecture))
      .toEqual({ ok: false, reason: '"constructor" has no name — the gate looks its object up by the name its template gives it' })
    const result = renderGatePreamble(named.architecture.resources[1], named.architecture)
    expect(result.ok).toBe(true)
    if (!result.ok) { return }
    expect(result.block).toContain('lookup "v1" "ConfigMap" .Release.Namespace ("cm-a")')
  })
})

describe('applyGate — owned block, never a hand-written one', () => {
  const template = '# a fresh template\n---\napiVersion: v1\nkind: ConfigMap\nmetadata:\n  name: x\n'
  const preamble = renderGatePreamble(node('repo'), arch)
  if (!preamble.ok) { throw new Error('preamble must render') }

  it('wraps the manifest between the markers and regenerates in place', () => {
    const first = applyGate(template, preamble.block)
    expect(first.ok).toBe(true)
    if (!first.ok) { return }
    expect(first.text).toContain(GATE_BEGIN)
    expect(first.text.trimEnd().endsWith(GATE_END)).toBe(true)
    expect(first.text).toContain('kind: ConfigMap')
    expect(unmanagedLookups(first.text)).toEqual([])
    const again = applyGate(first.text, preamble.block)
    expect(again.ok).toBe(true)
    if (!again.ok) { return }
    expect(again.text).toBe(first.text)
    expect(again.text.match(/krateo:gate begin/g)).toHaveLength(1)
  })

  it('refuses a template carrying a lookup outside a marked block', () => {
    const hand = '{{- $live := lookup "v1" "Secret" .Release.Namespace "x" -}}\n---\napiVersion: v1\nkind: ConfigMap\n'
    expect(applyGate(hand, preamble.block).ok).toBe(false)
    expect(unmanagedLookups(hand)).toEqual([1])
  })

  it('the fixture chart is entirely unmanaged today — which is the migration this exists for', () => {
    const localresources = readFileSync(join(FIXTURE, 'templates', 'localresources.yaml'), 'utf8')
    expect(unmanagedLookups(localresources).length).toBeGreaterThan(0)
  })
})
