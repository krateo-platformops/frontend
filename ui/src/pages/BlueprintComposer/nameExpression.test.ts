/**
 * The name a gate looks a dependency up by — its template's own `metadata.name`, never a convention
 * (C9) — and that name scoped to the root, so it means the same thing inside a `range`.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { nameExpressionOf, scopeToRoot } from './nameExpression'
import { placedNameExpression } from './naming'
import { placedTemplate } from './templateGen'

const FIXTURE = join(__dirname, '__fixtures__', 'builder-publish', 'templates')
const at = { id: 'dep', path: 'templates/dep.yaml' }
const doc = (name: string, head: string[] = []) => [...head, '---', 'apiVersion: v1', 'kind: ConfigMap', 'metadata:', `  name: ${name}`, 'data: {}', ''].join('\n')

describe('nameExpressionOf — the template\'s own metadata.name', () => {
  it('a placed template: the placed convention, single and per item', () => {
    const single = placedTemplate({ apiVersion: 'v1', class: 'native', id: 'cfg', kind: 'ConfigMap' }, { spec: null })
    expect(nameExpressionOf(single, at)).toEqual({ expr: placedNameExpression('cfg', false), ok: true })
    const ranged = placedTemplate({ apiVersion: 'v1', class: 'native', forEach: '.Values.files', id: 'cfg', kind: 'ConfigMap' }, { spec: null })
    expect(nameExpressionOf(ranged, at)).toEqual({ expr: placedNameExpression('cfg', true), ok: true })
  })

  it('builder-publish names its objects its own way — read, not assumed', () => {
    const read = (file: string) => nameExpressionOf(readFileSync(join(FIXTURE, file), 'utf8'), at)
    expect(read('localresources.yaml')).toEqual({ expr: 'printf "%s-%03d" $.Values.name (int $i) | trunc 63 | trimSuffix "-"', ok: true })
    expect(read('repository.yaml')).toEqual({ expr: 'printf "%s-repo" .Values.name | trunc 63 | trimSuffix "-"', ok: true })
  })

  it('the template\'s own range variables become the $i and $f the gate binds', () => {
    const template = doc('{{ printf "%s-%d-%s" $.Release.Name $idx $file.name }}', ['{{- range $idx, $file := .Values.files }}'])
    expect(nameExpressionOf(`${template}{{- end }}\n`, at)).toEqual({ expr: 'printf "%s-%d-%s" $.Release.Name $i $f.name', ok: true })
  })

  it('reads through a gate block the composer wrote', () => {
    const gated = doc('{{ printf "%s-x" .Release.Name }}', ['{{- /* krateo:gate begin — generated */}}', '{{- $gate := true -}}', '{{- if $gate }}'])
    expect(nameExpressionOf(gated, at)).toEqual({ expr: 'printf "%s-x" .Release.Name', ok: true })
  })

  it('a literal is a quoted string', () => {
    expect(nameExpressionOf(doc('fixed-name'), at)).toEqual({ expr: '"fixed-name"', ok: true })
  })

  it('any other variable is refused — it is not in scope where the gate evaluates the name', () => {
    const template = doc('{{ printf "%s-%s" $t.prefix .Values.name }}', ['{{- $t := .Values.target -}}'])
    expect(nameExpressionOf(template, { id: 'repo', path: 'templates/repo.yaml' })).toEqual({
      ok: false,
      reason: 'The composer cannot tell what repo is named: templates/repo.yaml sets metadata.name with {{ printf "%s-%s" $t.prefix .Values.name }}. Name it with one expression over $.Release.Name or $.Values, and try again.',
    })
    expect(nameExpressionOf('apiVersion: v1\nkind: ConfigMap\n', at).ok).toBe(false)
  })
})

describe('scopeToRoot — the same name from anywhere in a template', () => {
  it.each([
    ['printf "%s-repo" .Values.name | trunc 63', 'printf "%s-repo" $.Values.name | trunc 63'],
    ['printf "%s-x" .Release.Name', 'printf "%s-x" $.Release.Name'],
    ['include "x.fullname" .', 'include "x.fullname" $'],
    ['(include "x" .) | trunc 63', '(include "x" $) | trunc 63'],
    ['printf "%s" .Chart.Name', 'printf "%s" $.Chart.Name'],
    ['printf "%s-%03d" $.Values.name (int $i)', 'printf "%s-%03d" $.Values.name (int $i)'],
    ['$f.Values.name', '$f.Values.name'],
    ['printf ".Values.x %s" .Values.y', 'printf ".Values.x %s" $.Values.y'],
    ['"literal"', '"literal"'],
  ])('%s → %s', (expr, scoped) => {
    expect(scopeToRoot(expr)).toBe(scoped)
  })
})
