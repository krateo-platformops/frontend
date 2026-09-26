import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { parseArchitecture, type ChartArchitecture, type ResourceNode } from './architecture'
import { applyGate, GATE_BEGIN, GATE_END, gateLineRanges, removeGate, renderGatePreamble, unmanagedLookups } from './gateGen'
import { placedNameExpression } from './naming'

const FIXTURE = join(__dirname, '__fixtures__', 'builder-publish')
const parsed = parseArchitecture(readFileSync(join(FIXTURE, 'expected.architecture.yaml'), 'utf8'))
if (!parsed.ok) { throw new Error('fixture descriptor must parse') }
const arch = parsed.architecture

const golden = (path: string): string => readFileSync(join(__dirname, '__fixtures__', path), 'utf8')

// The names are the descriptor's own — builder-publish's, as the extractor read them from its
// templates' metadata.name.
const node = (id: string, from: ChartArchitecture = arch): ResourceNode => {
  const found = from.resources.find((candidate) => candidate.id === id)
  if (!found) { throw new Error(`no fixture node ${id}`) }
  return found
}

const describeChart = (lines: string[]): ChartArchitecture => {
  const result = parseArchitecture(['apiVersion: architecture.krateo.io/v1alpha1', 'kind: ChartArchitecture', 'chart: x', 'resources:', ...lines].join('\n'))
  if (!result.ok) { throw new Error(JSON.stringify(result.problems)) }
  return result.architecture
}

const preambleOf = (id: string, from: ChartArchitecture = arch): string => {
  const result = renderGatePreamble(node(id, from), from)
  if (!result.ok) { throw new Error(result.reason) }
  return result.block
}

const applied = (template: string, preamble: string): string => {
  const result = applyGate(template, preamble)
  if (!result.ok) { throw new Error(result.reason) }
  return result.text
}

/** Screen 7: a placed Repository, and a placed LocalResource ranged over .Values.files that waits for its default branch. */
const SCREEN_07 = describeChart([
  `  - { id: repository, class: custom, apiVersion: github.krateo.io/v2022-11-28, kind: Repository, template: templates/repository.yaml, name: '${placedNameExpression('repository', false)}', readyWhen: .status.default_branch }`,
  `  - { id: localresource, class: custom, apiVersion: git.krateo.io/v1alpha1, kind: LocalResource, template: templates/localresource.yaml, name: '${placedNameExpression('localresource', true)}', forEach: .Values.files, dependsOn: [{ ref: repository, ready: true }] }`,
])

describe('renderGatePreamble — the edge compiled to the lookup the chart writes by hand', () => {
  it('scoped to the root throughout: $.Release.Namespace, $.Values.AsMap, and the name rewritten to $.Values', () => {
    const block = preambleOf('localresources')
    expect(block.startsWith(GATE_BEGIN)).toBe(true)
    // `if .Values.repository.create` fails the render when `repository` is absent; dig does not.
    expect(block).toContain('{{- if not (empty (dig "repository" "create" "" ($.Values.AsMap))) -}}')
    expect(block).not.toContain('.Values.AsMap)) -}}\n{{- if .Values')
    expect(block).toContain('lookup "github.krateo.io/v2022-11-28" "Repository" $.Release.Namespace (printf "%s-repo" $.Values.name | trunc 63 | trimSuffix "-")')
    expect(block).toContain('dig "status" "default_branch" "" $dep0')
    expect(block).toContain('{{- if not (empty (dig "source" "url" "" ($.Values.AsMap))) -}}')
    expect(block).toContain('dig "status" "targetCommitId" "" $dep1')
    expect(block).not.toMatch(/[^$]\.Release\.Namespace/)
    expect(block).not.toMatch(/[^$]\.Values\.name/)
    expect(block.endsWith('{{- if $gate }}')).toBe(true)
  })

  it('all: true over a helper forEach ranges the files, as pullrequest.yaml:87-93 does — the lookup inside `with $`', () => {
    const block = preambleOf('pullrequest')
    expect(block).toContain('{{- range $i, $f := (include "builder-publish.files" $ | fromYamlArray) -}}\n{{- with $ -}}\n')
    expect(block).toContain('lookup "git.krateo.io/v1alpha1" "LocalResource" $.Release.Namespace (printf "%s-%03d" $.Values.name (int $i) | trunc 63 | trimSuffix "-")')
    expect(block).toContain('dig "status" "targetCommitId"')
    expect(block).toContain('{{- end -}}\n{{- end -}}')
  })

  it('all: true over a Values-path forEach ranges the values, nil-safe — not an include of a helper that does not exist', () => {
    const paths = describeChart([
      '  - { id: part, class: native, apiVersion: v1, kind: ConfigMap, template: t/p.yaml, forEach: .Values.parts.list, name: printf "p-%d" $i }',
      '  - { id: after, class: native, apiVersion: v1, kind: ConfigMap, template: t/a.yaml, name: \'"after"\', dependsOn: [{ ref: part, all: true }] }',
    ])
    const block = preambleOf('after', paths)
    expect(block).toContain('{{- range $i, $f := (dig "parts" "list" (list) ($.Values.AsMap)) -}}')
    expect(block).not.toContain('include')
    expect(block).toContain('lookup "v1" "ConfigMap" $.Release.Namespace (printf "p-%d" $i)')
  })

  it('a composition with no readyWhen waits for Ready AND Synced — the condition guards', () => {
    const nested = describeChart([
      '  - { id: mongodb, class: composition, apiVersion: composition.krateo.io/v0-1-2, kind: Mongodb, template: templates/mongodb.yaml, name: \'"db"\' }',
      '  - { id: app, class: native, apiVersion: apps/v1, kind: Deployment, template: templates/app.yaml, name: \'"app"\', dependsOn: [{ ref: mongodb, ready: true }] }',
    ])
    const block = preambleOf('app', nested)
    expect(block).toContain('{{- $dep0 := lookup "composition.krateo.io/v0-1-2" "Mongodb" $.Release.Namespace ("db") -}}')
    expect(block).toContain('(eq (toString .type) "Ready") (eq (toString .status) "True")')
    expect(block).toContain('(eq (toString .type) "Synced") (eq (toString .status) "True")')
    expect(block).toContain('{{- if not $ok0Ready -}}{{- $gate = false -}}{{- end -}}')
    expect(block).toContain('{{- if not $ok0Synced -}}{{- $gate = false -}}{{- end -}}')
  })

  it('an existence-only edge is a bare lookup', () => {
    const exists = describeChart([
      '  - { id: cfg, class: native, apiVersion: v1, kind: ConfigMap, template: t/c.yaml, name: \'"cfg"\' }',
      '  - { id: app, class: native, apiVersion: v1, kind: ConfigMap, template: t/a.yaml, name: \'"app"\', dependsOn: [{ ref: cfg }] }',
    ])
    expect(preambleOf('app', exists).split('\n').slice(2, 4)).toEqual([
      '{{- $dep0 := lookup "v1" "ConfigMap" $.Release.Namespace ("cfg") -}}',
      '{{- if not $dep0 -}}{{- $gate = false -}}{{- end -}}',
    ])
  })

  it('ready: true with nothing to compile is refused — never weakened to existence', () => {
    // The parser refuses a custom target with no readyWhen, so a native kind the table does not know stands in.
    const unknown = describeChart([
      '  - { id: sa, class: native, apiVersion: v1, kind: ServiceAccount, template: t/s.yaml, name: \'"sa"\' }',
      '  - { id: app, class: native, apiVersion: v1, kind: ConfigMap, template: t/a.yaml, name: \'"app"\', dependsOn: [{ ref: sa, ready: true }] }',
    ])
    expect(renderGatePreamble(node('app', unknown), unknown)).toEqual({
      code: 'needs-readyWhen',
      ok: false,
      reason: 'ready: true onto "sa" has nothing to wait for — ServiceAccount has no readiness the composer knows; declare its readyWhen, or wait only for it to exist',
    })
  })

  it('an edge onto a forEach target without all is refused — its name needs the item', () => {
    const partial = { ...arch, resources: arch.resources.map((resource) => (resource.id === 'pullrequest' ? { ...resource, dependsOn: [{ ready: true, ref: 'localresources' }] } : resource)) }
    expect(renderGatePreamble(node('pullrequest', partial), partial)).toEqual({
      code: 'shape',
      ok: false,
      reason: '"localresources" is one object per item of builder-publish.files, so an edge onto it waits for every item — all: true',
    })
  })

  it('a node with nothing to wait on has no gate', () => {
    expect(renderGatePreamble(node('repository'), arch)).toEqual({ code: 'shape', ok: false, reason: '"repository" has no dependsOn — nothing to gate' })
  })

  it('a target without a name is a refusal, not a template with a hole in it', () => {
    const unnamed = { ...arch, resources: arch.resources.map((resource) => (resource.id === 'repository' ? { ...resource, name: undefined } : resource)) }
    expect(renderGatePreamble(node('repo'), unnamed))
      .toEqual({ code: 'no-name', ok: false, reason: '"repository" has no name — the gate looks its object up by the name its template gives it' })
  })

  it('an id that is an Object.prototype name is named by its own field, never by the prototype', () => {
    // `constructor` is a legal id (a DNS label). An index keyed by id used to find Object's own
    // constructor for it: truthy, so the gate rendered `lookup … (function Object() { [native code] })`.
    const proto = (named: boolean) => describeChart([
      `  - { id: constructor, class: native, apiVersion: v1, kind: ConfigMap, template: templates/a.yaml${named ? ', name: \'"cm-a"\'' : ''} }`,
      '  - { id: after, class: native, apiVersion: v1, kind: ConfigMap, template: templates/b.yaml, dependsOn: [{ ref: constructor }] }',
    ])
    const bare = proto(false)
    const named = proto(true)
    expect(renderGatePreamble(bare.resources[1], bare))
      .toEqual({ code: 'no-name', ok: false, reason: '"constructor" has no name — the gate looks its object up by the name its template gives it' })
    expect(preambleOf('after', named)).toContain('lookup "v1" "ConfigMap" $.Release.Namespace ("cm-a")')
  })
})

describe('applyGate — owned block, never a hand-written one', () => {
  const template = '# a fresh template\n---\napiVersion: v1\nkind: ConfigMap\nmetadata:\n  name: x\n'
  const preamble = preambleOf('repo')

  it('wraps the manifest between the markers and regenerates in place', () => {
    const first = applied(template, preamble)
    expect(first).toContain(GATE_BEGIN)
    expect(first.trimEnd().endsWith(GATE_END)).toBe(true)
    expect(first).toContain('kind: ConfigMap')
    expect(unmanagedLookups(first)).toEqual([])
    const again = applied(first, preamble)
    expect(again).toBe(first)
    expect(again.match(/krateo:gate begin/g)).toHaveLength(1)
  })

  it('screen 7: the gate sits INSIDE the range, and the range\'s end survives two regenerations', () => {
    const placed = golden('placed/localresource.foreach-path.yaml')
    const gate = preambleOf('localresource', SCREEN_07)
    const first = applied(placed, gate)
    expect(first).toBe(golden('gated/localresource.yaml'))
    expect(first.indexOf('{{- range $i, $f := $.Values.files }}')).toBeLessThan(first.indexOf(GATE_BEGIN))
    expect(first.endsWith(`${GATE_END}\n{{- end }}\n`)).toBe(true)
    const twice = applied(applied(first, gate), gate)
    expect(twice).toBe(first)
    expect(twice.match(/^\{\{- end \}\}$/gm)).toHaveLength(2)
  })

  it('regeneration keeps every byte after the end marker — the tail is the author\'s', () => {
    const withTail = `${applied(template, preamble)}{{/* a note the author added */}}\n# trailing\n`
    const other = preambleOf('localresources')
    const regenerated = applied(withTail, other)
    expect(regenerated.endsWith(`${GATE_END}\n{{/* a note the author added */}}\n# trailing\n`)).toBe(true)
    expect(regenerated).toContain('$dep1 := lookup "git.krateo.io/v1alpha1" "Repo"')
  })

  it('refuses a template carrying a lookup outside a marked block', () => {
    const hand = '{{- $live := lookup "v1" "Secret" .Release.Namespace "x" -}}\n---\napiVersion: v1\nkind: ConfigMap\n'
    expect(applyGate(hand, preamble).ok).toBe(false)
    expect(unmanagedLookups(hand)).toEqual([1])
  })

  it('refuses a half-deleted block rather than guessing where it ends', () => {
    const broken = applied(template, preamble).replace(GATE_END, '')
    expect(applyGate(broken, preamble)).toEqual({ ok: false, reason: 'a krateo:gate block is present but malformed — regenerate it by hand once' })
    expect(removeGate(broken).ok).toBe(false)
  })

  it('the fixture chart is entirely unmanaged today — which is the migration this exists for', () => {
    const localresources = readFileSync(join(FIXTURE, 'templates', 'localresources.yaml'), 'utf8')
    expect(unmanagedLookups(localresources).length).toBeGreaterThan(0)
  })
})

describe('removeGate — exactly what applyGate added, and nothing else', () => {
  it.each([
    ['a single document', '# head\n---\napiVersion: v1\nkind: ConfigMap\nmetadata:\n  name: x\n'],
    ['a placed forEach template', golden('placed/localresource.foreach-path.yaml')],
    ['a placed helper forEach template', golden('placed/localresource.foreach-helper.yaml')],
    ['a document with a tail after its range', '{{- range .Values.xs }}\n---\napiVersion: v1\nkind: ConfigMap\n{{- end }}\n# after\n\n'],
  ])('round trip: %s', (_label, template) => {
    const gated = applied(template, preambleOf('repo'))
    expect(gated).not.toBe(template)
    expect(removeGate(gated)).toEqual({ ok: true, text: template })
  })

  it('a template with no block comes back as it is', () => {
    expect(removeGate('apiVersion: v1\n')).toEqual({ ok: true, text: 'apiVersion: v1\n' })
  })
})

describe('gateLineRanges — the generated lines, for the Chart files highlight', () => {
  it('the preamble, and the if-end with the end marker — 1-based and inclusive', () => {
    const gated = golden('gated/localresource.yaml')
    const lines = gated.split('\n')
    const ranges = gateLineRanges(gated)
    expect(ranges).toHaveLength(2)
    expect(lines[ranges[0].from - 1]).toBe(GATE_BEGIN)
    expect(lines[ranges[0].to - 1]).toBe('{{- if $gate }}')
    expect(lines.slice(ranges[1].from - 1, ranges[1].to)).toEqual(['{{- end }}', GATE_END])
    expect(lines[ranges[1].to]).toBe('{{- end }}')
  })

  it('none for a template with no block', () => {
    expect(gateLineRanges(golden('placed/repository.yaml'))).toEqual([])
  })
})
