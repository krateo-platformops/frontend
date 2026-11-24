/**
 * A chart may carry any resource but its own definition (Diego, 2026-11-24): judged on literal template
 * text by the lint, and on a preview's rendered objects, with core-provider's matching rule.
 */
import { describe, expect, it } from 'vitest'

import { lintBlueprintDraft } from './blueprintDraft'
import { judgeRender } from './blueprintRenderSandbox'
import { namesChart, ownDefinitionProblems } from './ownDefinition'

const CHART = {
  'Chart.yaml': 'apiVersion: v2\nname: my-bp\nversion: 0.1.0\ntype: application\n',
  'values.schema.json': JSON.stringify({ $schema: 'http://json-schema.org/draft-07/schema#', additionalProperties: false, properties: { global: { additionalProperties: true, type: 'object' } }, type: 'object' }),
}
const cd = (chart: string, head = '') => `${head}apiVersion: core.krateo.io/v1alpha1\nkind: CompositionDefinition\nmetadata:\n  name: x\nspec:\n  chart:\n${chart}`
const OWN = cd('    url: oci://ghcr.io/org/charts/my-bp\n    version: 0.1.0\n')
const OTHER = cd('    url: oci://ghcr.io/org/charts/other\n    version: 1.0.0\n')

describe('namesChart', () => {
  const cases: [string, { repo?: string; url?: string }, boolean][] = [
    ['the OCI path', { url: 'oci://ghcr.io/org/charts/my-bp' }, true],
    ['a trailing slash', { url: 'oci://ghcr.io/org/charts/my-bp/' }, true],
    ['a tag', { url: 'oci://ghcr.io/org/charts/my-bp:1.2.3' }, true],
    ['a digest', { url: 'oci://ghcr.io/org/charts/my-bp@sha256:abc' }, true],
    ['a registry with a port', { url: 'oci://localhost:5000/charts/my-bp' }, true],
    ['the repo field', { repo: 'my-bp', url: 'https://charts.example.com' }, true],
    ['an archive', { url: 'https://example.com/my-bp-1.2.3.tgz?x=1' }, true],
    ['a pre-release archive', { url: 'https://example.com/my-bp-1.2.3-rc.1.tgz' }, true],
    ['another chart', { url: 'oci://ghcr.io/org/charts/other' }, false],
    ['a chart whose name starts the same', { url: 'oci://ghcr.io/org/charts/my-bp-extra' }, false],
    ['an archive whose name starts the same', { url: 'https://example.com/my-bp-extra-1.2.3.tgz' }, false],
    ['this name elsewhere in the path', { url: 'oci://ghcr.io/my-bp/charts/other' }, false],
    ['nothing named', {}, false],
  ]
  for (const [why, chart, want] of cases) {
    it(why, () => { expect(namesChart(chart, 'my-bp')).toBe(want) })
  }
})

describe('the lint, on literal template text', () => {
  const lint = (text: string, path = 'templates/x.yaml') => lintBlueprintDraft({ ...CHART, [path]: text }, 'blueprint')

  it('refuses the chart’s own definition, by file, saying why and what to do', () => {
    expect(lint(OWN)).toEqual([expect.stringMatching(/^templates\/x\.yaml: .*the chart it is part of \(my-bp\).*rewrite or delete its own registration.*portal writes compositiondefinition\.yaml/)])
  })

  const refused: [string, string][] = [
    ['second in the file', `kind: ConfigMap\n---\n${OWN}`],
    ['quoted', cd('    url: "oci://ghcr.io/org/charts/my-bp" # mine\n')],
    ['with a templated registry and a literal name', cd('    url: oci://{{ .Values.registry }}/charts/my-bp\n')],
    ['named by repo', cd('    repo: my-bp\n    url: https://charts.example.com\n')],
    ['inside a condition, with template lines', cd('    {{- if .Values.a }}\n    url: oci://ghcr.io/org/charts/my-bp\n    {{- end }}\n', '{{- if .Values.b }}\n')],
  ]
  for (const [why, text] of refused) {
    it(`refuses it ${why}`, () => { expect(lint(text)).toHaveLength(1) })
  }

  const allowed: [string, string][] = [
    ['another chart’s definition', OTHER],
    ['a widget', 'apiVersion: widgets.templates.krateo.io/v1beta1\nkind: Flex\nmetadata: {name: page-x}\n'],
    ['a RESTAction', 'apiVersion: templates.krateo.io/v1\nkind: RESTAction\nmetadata: {name: x}\n'],
    ['a RestDefinition', 'apiVersion: ogen.krateo.io/v1alpha1\nkind: RestDefinition\nmetadata: {name: x}\n'],
    ['a name built from a template expression', cd('    url: oci://ghcr.io/org/charts/{{ .Chart.Name }}\n')],
    ['the kind of another group', OWN.replace('core.krateo.io', 'example.com')],
    ['the text inside a ConfigMap', `apiVersion: v1\nkind: ConfigMap\ndata:\n  x: |\n${OWN.split('\n').map((line) => `    ${line}`).join('\n')}`],
    ['a commented-out definition', OWN.split('\n').map((line) => `# ${line}`).join('\n')],
    ['a url deeper than the chart', cd('    url: oci://ghcr.io/org/charts/other\n    credentials:\n      url: oci://ghcr.io/org/charts/my-bp\n')],
    ['a url beside the chart', `${OTHER}  other:\n    url: oci://ghcr.io/org/charts/my-bp\n`],
  ]
  for (const [why, text] of allowed) {
    it(`allows ${why}`, () => { expect(lint(text)).toEqual([]) })
  }

  it('allows another chart’s definition at templates/compositiondefinition.yaml', () => { expect(lint(OTHER, 'templates/compositiondefinition.yaml')).toEqual([]) })
  it('reads templates only: the root registration file is the portal’s', () => { expect(ownDefinitionProblems({ 'compositiondefinition.yaml': OWN }, 'my-bp')).toEqual([]) })
})

describe('a preview, on the rendered objects', () => {
  const object = (yaml: string, apiVersion = 'core.krateo.io/v1alpha1') => ({ apiVersion, kind: 'CompositionDefinition', name: 'x', yaml })
  const judge = (objects: ReturnType<typeof object>[], args: object = { rawTemplates: CHART }) => judgeRender({ objects }, args).error

  it('fails a render that registers its own chart, templated names included', () => {
    expect(judge([object(OTHER), object(OWN)])).toMatch(/^CompositionDefinition x: .*my-bp/)
  })
  it('passes one that registers another chart', () => { expect(judge([object(OTHER)])).toBeUndefined() })
  it('keeps a render’s own error', () => { expect(judgeRender({ error: 'boom', objects: [object(OWN)] }, { rawTemplates: CHART }).error).toBe('boom') })
  it('does not judge a published chart’s dry run', () => { expect(judge([object(OWN)], { chart: { url: 'oci://x/charts/my-bp' } })).toBeUndefined() })
  it('does not judge a definition whose YAML it cannot read, or another group’s', () => {
    expect(judge([object('a: [')])).toBeUndefined()
    expect(judge([object(OWN, 'example.com/v1')])).toBeUndefined()
  })
})
