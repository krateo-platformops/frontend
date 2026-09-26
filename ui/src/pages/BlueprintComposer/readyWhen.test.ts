/**
 * The readiness grammar (two forms both Helm and jq compile) and the guard each form — and each class
 * default — compiles to. A `ready` edge with nothing to compile is refused, never weakened to existence.
 */
import { describe, expect, it } from 'vitest'

import type { ResourceNode } from './architecture'
import { NATIVE_KINDS } from './nativeKinds'
import { conditionReadyWhen, defaultReadiness, existenceGuard, parseReadyWhen, readinessGuard, readinessShort, readyWhenLabel } from './readyWhen'

const node = (over: Partial<ResourceNode>): ResourceNode => ({ apiVersion: 'x.io/v1', class: 'custom', id: 'dep', kind: 'Thing', template: 'templates/dep.yaml', ...over })

const guard = (target: ResourceNode): string[] => {
  const result = readinessGuard(target, 3, 'NAME')
  if (!result.ok) { throw new Error(result.reason) }
  return result.lines
}

describe('parseReadyWhen — a status field, or a True condition, and nothing else', () => {
  it('a field and a nested field', () => {
    expect(parseReadyWhen('.status.default_branch')).toEqual({ form: { kind: 'field', path: ['status', 'default_branch'] }, ok: true })
    expect(parseReadyWhen('.status.atProvider.id')).toEqual({ form: { kind: 'field', path: ['status', 'atProvider', 'id'] }, ok: true })
  })

  it('a condition — and conditionReadyWhen writes exactly the form it reads', () => {
    expect(parseReadyWhen(conditionReadyWhen('Ready'))).toEqual({ form: { kind: 'condition', type: 'Ready' }, ok: true })
    expect(conditionReadyWhen('Synced')).toBe('.status.conditions[] | select(.type == "Synced") | .status == "True"')
  })

  it.each([
    ['a pipe', '.status.a | not'],
    ['an index', '.status.conditions[0].status'],
    ['== on a field', '.status.phase == "Bound"'],
    ['a dash (jq reads a - b)', '.status.a-b'],
    ['a leading digit', '.status.0'],
    ['not under status', '.spec.ready'],
    ['status alone', '.status'],
    ['a False condition', '.status.conditions[] | select(.type == "Ready") | .status == "False"'],
    ['a Helm action', '{{ .status.ready }}'],
  ])('refuses %s', (_label, text) => {
    const parsed = parseReadyWhen(text)
    expect(parsed.ok).toBe(false)
    if (parsed.ok) { return }
    expect(parsed.reason).toBe(`${JSON.stringify(text)} is not a status field (.status.ready) or a True condition (.status.conditions[] | select(.type == "Ready") | .status == "True")`)
  })

  it('reads as its meaning: "is set", or the condition — the mockup label (06:90)', () => {
    expect(readyWhenLabel('.status.default_branch')).toBe('.status.default_branch is set')
    expect(readyWhenLabel(conditionReadyWhen('Ready'))).toBe('.status.conditions[type=Ready] == True')
    expect(readyWhenLabel('.status.a | b')).toBe('.status.a | b')
  })
})

describe('class defaults', () => {
  it('a composition waits for Ready and Synced; a known native kind for its kstatus meaning; a custom kind for nothing', () => {
    expect(defaultReadiness({ apiVersion: 'composition.krateo.io/v0-1-2', class: 'composition', kind: 'Mongodb' })).toBe('Ready=True and Synced=True')
    expect(defaultReadiness({ apiVersion: 'apps/v1', class: 'native', kind: 'Deployment' })).toBe('kstatus · available')
    expect(defaultReadiness({ apiVersion: 'v1', class: 'native', kind: 'ServiceAccount' })).toBeNull()
    expect(defaultReadiness({ apiVersion: 'x.io/v1', class: 'custom', kind: 'Thing' })).toBeNull()
  })

  it('the short form a legal target shows (06:72)', () => {
    expect(readinessShort(node({ class: 'composition' }))).toBe('Ready+Synced')
    expect(readinessShort(node({ readyWhen: '.status.default_branch' }))).toBe('default_branch')
    expect(readinessShort(node({ readyWhen: conditionReadyWhen('Ready') }))).toBe('Ready=True')
    expect(readinessShort(node({ apiVersion: 'v1', class: 'native', kind: 'PersistentVolumeClaim' }))).toBe('bound')
    expect(readinessShort(node({}))).toBe('no readyWhen')
  })
})

describe('readinessGuard — the Helm the gate waits with', () => {
  const lookup = '{{- $dep3 := lookup "x.io/v1" "Thing" $.Release.Namespace (NAME) -}}'

  it('a field is set', () => {
    expect(guard(node({ readyWhen: '.status.atProvider.id' }))).toEqual([
      lookup,
      '{{- if not (and $dep3 (dig "status" "atProvider" "id" "" $dep3)) -}}{{- $gate = false -}}{{- end -}}',
    ])
  })

  it('a condition is True — a flag over the object\'s conditions', () => {
    expect(guard(node({ readyWhen: conditionReadyWhen('Ready') }))).toEqual([
      lookup,
      '{{- $ok3 := false -}}',
      '{{- range (dig "status" "conditions" (list) $dep3) -}}{{- if and (eq (toString .type) "Ready") (eq (toString .status) "True") -}}{{- $ok3 = true -}}{{- end -}}{{- end -}}',
      '{{- if not $ok3 -}}{{- $gate = false -}}{{- end -}}',
    ])
  })

  it('a composition with no readyWhen: Ready AND Synced', () => {
    const lines = guard(node({ apiVersion: 'composition.krateo.io/v0-1-2', class: 'composition', kind: 'Mongodb' }))
    expect(lines[0]).toBe('{{- $dep3 := lookup "composition.krateo.io/v0-1-2" "Mongodb" $.Release.Namespace (NAME) -}}')
    expect(lines.filter((line) => line.includes('(eq (toString .type) "Ready")'))).toHaveLength(1)
    expect(lines.filter((line) => line.includes('(eq (toString .type) "Synced")'))).toHaveLength(1)
    expect(lines).toContain('{{- if not $ok3Ready -}}{{- $gate = false -}}{{- end -}}')
    expect(lines).toContain('{{- if not $ok3Synced -}}{{- $gate = false -}}{{- end -}}')
  })

  // One golden per native readiness tag.
  const NATIVE_GOLDENS: Record<string, string[]> = {
    ConfigMap: ['{{- if not $dep3 -}}{{- $gate = false -}}{{- end -}}'],
    CronJob: ['{{- if not $dep3 -}}{{- $gate = false -}}{{- end -}}'],
    Deployment: [
      '{{- $ok3Available := false -}}',
      '{{- range (dig "status" "conditions" (list) $dep3) -}}{{- if and (eq (toString .type) "Available") (eq (toString .status) "True") -}}{{- $ok3Available = true -}}{{- end -}}{{- end -}}',
      '{{- if not $ok3Available -}}{{- $gate = false -}}{{- end -}}',
    ],
    Ingress: ['{{- if not (and $dep3 (dig "status" "loadBalancer" "ingress" (list) $dep3)) -}}{{- $gate = false -}}{{- end -}}'],
    Job: [
      '{{- $ok3Complete := false -}}',
      '{{- range (dig "status" "conditions" (list) $dep3) -}}{{- if and (eq (toString .type) "Complete") (eq (toString .status) "True") -}}{{- $ok3Complete = true -}}{{- end -}}{{- end -}}',
      '{{- if not $ok3Complete -}}{{- $gate = false -}}{{- end -}}',
    ],
    PersistentVolumeClaim: ['{{- if not (and $dep3 (eq (toString (dig "status" "phase" "" $dep3)) "Bound")) -}}{{- $gate = false -}}{{- end -}}'],
    Secret: ['{{- if not $dep3 -}}{{- $gate = false -}}{{- end -}}'],
    Service: [
      '{{- $ep3 := lookup "v1" "Endpoints" $.Release.Namespace (NAME) -}}',
      '{{- if not (and $dep3 $ep3 (dig "subsets" (list) $ep3)) -}}{{- $gate = false -}}{{- end -}}',
    ],
    StatefulSet: ['{{- if not (and $dep3 (ge (int (dig "status" "readyReplicas" 0 $dep3)) (int (dig "spec" "replicas" 1 $dep3)))) -}}{{- $gate = false -}}{{- end -}}'],
  }

  it.each(NATIVE_KINDS.map((kind) => [kind.kind, kind] as const))('native %s — its kstatus tag', (_kind, kind) => {
    const lines = guard(node({ apiVersion: kind.apiVersion, class: 'native', kind: kind.kind }))
    expect(lines[0]).toBe(`{{- $dep3 := lookup "${kind.apiVersion}" "${kind.kind}" $.Release.Namespace (NAME) -}}`)
    expect(lines.slice(1)).toEqual(NATIVE_GOLDENS[kind.kind])
  })

  it('a native readyWhen wins over the kind\'s default', () => {
    expect(guard(node({ apiVersion: 'apps/v1', class: 'native', kind: 'Deployment', readyWhen: '.status.readyReplicas' }))[1])
      .toBe('{{- if not (and $dep3 (dig "status" "readyReplicas" "" $dep3)) -}}{{- $gate = false -}}{{- end -}}')
  })

  it('ready with nothing to compile is REFUSED — never weakened to existence', () => {
    expect(readinessGuard(node({}), 0, 'N')).toEqual({ ok: false, reason: 'ready: true onto "dep" has nothing to wait for — a custom resource has no default; declare its readyWhen, or wait only for it to exist' })
    expect(readinessGuard(node({ apiVersion: 'v1', class: 'native', kind: 'ServiceAccount' }), 0, 'N'))
      .toEqual({ ok: false, reason: 'ready: true onto "dep" has nothing to wait for — ServiceAccount has no readiness the composer knows; declare its readyWhen, or wait only for it to exist' })
    expect(readinessGuard(node({ readyWhen: '.status.a | b' }), 0, 'N').ok).toBe(false)
  })

  it('an existence edge is the lookup and nothing more', () => {
    expect(existenceGuard(node({}), 1, 'N')).toEqual([
      '{{- $dep1 := lookup "x.io/v1" "Thing" $.Release.Namespace (N) -}}',
      '{{- if not $dep1 -}}{{- $gate = false -}}{{- end -}}',
    ])
  })
})
