/**
 * Where a template's manifest is — the span a gate wraps. A head that opens a `range` keeps it OUTSIDE
 * the gate, and the `end` that closes it too; prose in comments never counts as a block.
 */
import { describe, expect, it } from 'vitest'

import { manifestSpan, scanBlocks, stripComments } from './helmBlocks'

const joined = (span: ReturnType<typeof manifestSpan>): string => (span.ok ? `${span.head}${span.body}${span.tail}` : '')

describe('manifestSpan', () => {
  it("stops before an `else` of a block the head opened — the gate must never own the author's else", () => {
    const template = [
      '{{- if .Values.enabled }}',
      'apiVersion: v1',
      'kind: ConfigMap',
      'metadata:',
      '  name: a',
      '{{- else }}',
      'apiVersion: v1',
      'kind: Secret',
      'metadata:',
      '  name: b',
      '{{- end }}',
      '',
    ].join('\n')
    const span = manifestSpan(template)
    expect(span.ok).toBe(true)
    if (!span.ok) { return }
    expect(span.body).toBe('apiVersion: v1\nkind: ConfigMap\nmetadata:\n  name: a\n')
    expect(span.tail.startsWith('{{- else }}')).toBe(true)
    expect(joined(span)).toBe(template)
  })

  it('keeps an `else` that belongs to a block opened INSIDE the manifest', () => {
    const template = '{{- range .Values.xs }}\napiVersion: v1\nkind: ConfigMap\ndata:\n  {{- if .a }}\n  a: "1"\n  {{- else }}\n  b: "2"\n  {{- end }}\n{{- end }}\n'
    const span = manifestSpan(template)
    expect(span.ok && span.body.includes('{{- else }}')).toBe(true)
    expect(span.ok && span.tail).toBe('{{- end }}\n')
  })

  it('no open block: the head, then the body to the end', () => {
    const template = '{{- /* placed */}}\napiVersion: v1\nkind: ConfigMap\nmetadata:\n  name: x\n'
    expect(manifestSpan(template)).toEqual({ body: 'apiVersion: v1\nkind: ConfigMap\nmetadata:\n  name: x\n', head: '{{- /* placed */}}\n', ok: true, tail: '' })
  })

  it('an unclosed range in the head: the body ends at the end that closes it, which starts the tail', () => {
    const template = [
      '{{- /* placed */}}',
      '{{- range $i, $f := $.Values.files }}',
      '---',
      'apiVersion: v1',
      'kind: ConfigMap',
      '{{- if $f.labels }}',
      '  labels: {}',
      '{{- end }}',
      '{{- end }}',
      '# after',
      '',
    ].join('\n')
    const span = manifestSpan(template)
    expect(span).toEqual({
      body: '---\napiVersion: v1\nkind: ConfigMap\n{{- if $f.labels }}\n  labels: {}\n{{- end }}\n',
      head: '{{- /* placed */}}\n{{- range $i, $f := $.Values.files }}\n',
      ok: true,
      tail: '{{- end }}\n# after\n',
    })
    expect(joined(span)).toBe(template)
  })

  it('comments that talk about if, range and end — and one that mentions apiVersion: — change nothing', () => {
    const template = [
      '{{/*',
      'apiVersion: not this one',
      '  {{ if }} … {{ end }} {{ range }}',
      '*/}}',
      '{{- if .Values.enabled }}',
      '{{- /* the end of the story */}}',
      'apiVersion: v1',
      'kind: Secret',
      '{{- end }}',
      '',
    ].join('\n')
    const span = manifestSpan(template)
    expect(span.ok && span.head).toBe('{{/*\napiVersion: not this one\n  {{ if }} … {{ end }} {{ range }}\n*/}}\n{{- if .Values.enabled }}\n{{- /* the end of the story */}}\n')
    expect(span.ok && span.body).toBe('apiVersion: v1\nkind: Secret\n')
    expect(span.ok && span.tail).toBe('{{- end }}\n')
    expect(joined(span)).toBe(template)
  })

  it('refuses a template with no manifest, and one whose head never closes', () => {
    expect(manifestSpan('{{- define "x" }}{{- end }}\n')).toEqual({ ok: false, reason: 'no manifest found in the template' })
    expect(manifestSpan('{{- range .Values.x }}\napiVersion: v1\n')).toEqual({ ok: false, reason: 'the blocks the template opens before its manifest never close' })
  })
})

describe('stripComments + scanBlocks', () => {
  it('keeps line numbers, and tracks what is open before each line', () => {
    const lines = stripComments('{{/* a\nb */}}\n{{- if x }}\ny\n{{- end }}').split('\n')
    expect(lines).toEqual(['', '', '{{- if x }}', 'y', '{{- end }}'])
    expect(scanBlocks(lines).map((open) => open.map((block) => block.keyword))).toEqual([[], [], [], ['if'], ['if']])
  })
})
