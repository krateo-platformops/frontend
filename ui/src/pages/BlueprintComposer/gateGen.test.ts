import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { parseArchitecture, type ResourceNode } from './architecture'
import { applyGate, GATE_BEGIN, GATE_END, renderGatePreamble, unmanagedLookups, type NameExpressions } from './gateGen'

const FIXTURE = join(__dirname, '__fixtures__', 'builder-publish')
const parsed = parseArchitecture(readFileSync(join(FIXTURE, 'expected.architecture.yaml'), 'utf8'))
if (!parsed.ok) { throw new Error('fixture descriptor must parse') }
const arch = parsed.architecture

// The descriptor does not carry names; the chart does. These are builder-publish's own.
const NAMES: NameExpressions = {
  localresources: 'printf "%s-%03d" $.Values.name (int $i) | trunc 63 | trimSuffix "-"',
  repo: 'printf "%s-source" .Values.name | trunc 63 | trimSuffix "-"',
  repository: 'printf "%s-repo" .Values.name | trunc 63 | trimSuffix "-"',
}

const node = (id: string): ResourceNode => {
  const found = arch.resources.find((candidate) => candidate.id === id)
  if (!found) { throw new Error(`no fixture node ${id}`) }
  return found
}

describe('renderGatePreamble — the edge compiled to the lookup the chart writes by hand', () => {
  it('a ready edge becomes a lookup guarded on the target readyWhen, inside the edge when', () => {
    const result = renderGatePreamble(node('localresources'), arch, NAMES)
    expect(result.ok).toBe(true)
    if (!result.ok) { return }
    expect(result.block.startsWith(GATE_BEGIN)).toBe(true)
    expect(result.block).toContain('{{- if .Values.repository.create -}}')
    expect(result.block).toContain('lookup "github.krateo.io/v2022-11-28" "Repository" .Release.Namespace (printf "%s-repo" .Values.name | trunc 63 | trimSuffix "-")')
    expect(result.block).toContain('dig "status" "default_branch" "" $dep0')
    expect(result.block).toContain('{{- if .Values.source.url -}}')
    expect(result.block).toContain('dig "status" "targetCommitId" "" $dep1')
    expect(result.block.endsWith('{{- if $gate }}')).toBe(true)
  })

  it('all: true over a forEach target ranges the files, as pullrequest.yaml:87-93 does', () => {
    const result = renderGatePreamble(node('pullrequest'), arch, NAMES)
    expect(result.ok).toBe(true)
    if (!result.ok) { return }
    expect(result.block).toContain('{{- range $i, $f := (include "builder-publish.files" $ | fromYamlArray) -}}')
    expect(result.block).toContain('lookup "git.krateo.io/v1alpha1" "LocalResource" .Release.Namespace (printf "%s-%03d" $.Values.name (int $i) | trunc 63 | trimSuffix "-")')
    expect(result.block).toContain('dig "status" "targetCommitId"')
  })

  it('a node with nothing to wait on has no gate', () => {
    expect(renderGatePreamble(node('repository'), arch, NAMES)).toEqual({ ok: false, reason: '"repository" has no dependsOn — nothing to gate' })
  })

  it('a missing name expression is a refusal, not a template with a hole in it', () => {
    expect(renderGatePreamble(node('repo'), arch, {})).toEqual({ ok: false, reason: 'no name expression for "repository"' })
  })

  it('an id that is an Object.prototype name is not "named" by the prototype — still a refusal', () => {
    // `constructor` is a legal id (a DNS label), and names['constructor'] used to find Object's own
    // constructor: truthy, so the gate rendered `lookup … (function Object() { [native code] })`.
    const proto = parseArchitecture([
      'apiVersion: architecture.krateo.io/v1alpha1',
      'kind: ChartArchitecture',
      'chart: proto',
      'resources:',
      '  - { id: constructor, class: native, apiVersion: v1, kind: ConfigMap, template: templates/a.yaml }',
      '  - { id: after, class: native, apiVersion: v1, kind: ConfigMap, template: templates/b.yaml, dependsOn: [{ ref: constructor }] }',
    ].join('\n'))
    if (!proto.ok) { throw new Error(JSON.stringify(proto.problems)) }
    const [, after] = proto.architecture.resources
    expect(renderGatePreamble(after, proto.architecture, {})).toEqual({ ok: false, reason: 'no name expression for "constructor"' })
    expect(renderGatePreamble(after, proto.architecture, { constructor: '"cm-a"' }).ok).toBe(true)
  })
})

describe('applyGate — owned block, never a hand-written one', () => {
  const template = '# a fresh template\n---\napiVersion: v1\nkind: ConfigMap\nmetadata:\n  name: x\n'
  const preamble = renderGatePreamble(node('repo'), arch, NAMES)
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
