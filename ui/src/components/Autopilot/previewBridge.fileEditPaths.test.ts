/**
 * A chart's files are judged by what they are. A TEMPLATE is Go-template text — `{{- if … }}` at the
 * top of a file is not a YAML document, so parsing it as one refused every real gated template (all
 * six of builder-publish's, and the architecture.yaml wrapper). Only the render can judge a template.
 */
import { describe, expect, it } from 'vitest'

import { FILE_EDIT_JSON_ERROR, FILE_EDIT_SHAPE_ERROR, parseFileEdit } from './previewBridge'
describe('parseFileEdit — a CHART file is judged by what it is (path-aware)', () => {
  const gated = '{{- if .Values.enabled }}\napiVersion: v1\nkind: ConfigMap\nmetadata:\n  name: {{ .Release.Name }}\n{{- end }}\n'

  it('accepts a Go-template chart template verbatim — `{{-` at the top is not YAML, and never was meant to be', () => {
    // Every real gated template starts this way; parsing it as YAML refused all of them.
    expect(parseFileEdit(gated, false)).toMatchObject({ ok: false })
    expect(parseFileEdit(gated, false, 'templates/configmap.yaml')).toEqual({ content: gated, ok: true, problems: [] })
    expect(parseFileEdit(gated, false, 'charts/sub/templates/cm.yaml').ok).toBe(true)
    expect(parseFileEdit('{{- define "x" }}{{ end }}', false, 'templates/_helpers.tpl').ok).toBe(true)
    expect(parseFileEdit('Installed {{ .Release.Name }}', false, 'templates/NOTES.txt').ok).toBe(true)
  })

  it('values.schema.json must be JSON', () => {
    expect(parseFileEdit('{"type":"object"}', false, 'values.schema.json')).toEqual({ content: '{"type":"object"}', ok: true, problems: [] })
    expect(parseFileEdit('{"type": object}', false, 'values.schema.json')).toEqual({ ok: false, problems: [FILE_EDIT_JSON_ERROR] })
  })

  it('Chart.yaml and values.yaml are still parsed as YAML', () => {
    expect(parseFileEdit('name: [unclosed', false, 'Chart.yaml').ok).toBe(false)
    expect(parseFileEdit('enabled: true\n  replicas: [1', false, 'values.yaml').ok).toBe(false)
    expect(parseFileEdit('enabled: true\n', false, 'values.yaml').ok).toBe(true)
  })

  it('a PAGE widget file keeps the CR-shape check, path or no path — templates/ does not exempt it', () => {
    expect(parseFileEdit(gated, true, 'templates/flex.page-home.yaml').ok).toBe(false)
    expect(parseFileEdit('kind: Flex\n', true, 'templates/flex.page-home.yaml').problems).toEqual([FILE_EDIT_SHAPE_ERROR])
  })
})
