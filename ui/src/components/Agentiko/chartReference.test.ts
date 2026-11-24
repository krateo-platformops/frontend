/**
 * The one matcher of the Builder and core-provider's chart gate. The cases are the gate's own
 * (core-provider-agent 0.62.3, tests/test_gate_rules.py), which follow core-provider's getter.
 */
import { load } from 'js-yaml'
import { describe, expect, it } from 'vitest'

import { chartReference, definitionsIn, registersChart } from './chartReference'

const DIGEST = `sha256:${'a'.repeat(64)}`
type Case = [url: string, repo?: string]
const registers = ([url, repo]: Case, chart = 'hello-web') => registersChart(chartReference({ repo, url }), chart)

const own: Case[] = [
  ['oci://ghcr.io/acme/charts/hello-web'], ['oci://ghcr.io/hello-web'], ['oci://localhost:5000/hello-web'],
  ['oci://ghcr.io/acme/hello-web/'], ['oci://ghcr.io/acme/hello-web:0.1.0'], ['oci://ghcr.io/acme/hello-web:0.1.0/'],
  [`oci://ghcr.io/acme/hello-web@${DIGEST}`], [`oci://ghcr.io/acme/hello-web:0.1.0@${DIGEST}`],
  ['oci://ghcr.io/acme/Hello-Web'], ['oci://ghcr.io/acme', 'hello-web'], ['oci://ghcr.io/acme/', 'hello-web'],
  ['oci://ghcr.io/acme', 'team/hello-web:0.1.0'],
  ['https://example.com/charts/hello-web-0.1.0.tgz'], ['http://example.com/hello-web-v0.1.0.tgz'],
  ['https://example.com/hello-web-1.0.0-rc.1+build.5.tar.gz'], ['https://example.com/hello%2Dweb-0.1.0.tgz'],
  ['https://example.com/HELLO-WEB-0.1.0.tgz'], ['https://example.com/hello-web-0.1.0.tgz?token=abc'],
  ['https://example.com/hello-web-0.1.0.tgz#top'], ['https://example.com/hello-web-0.1.0.tgz', 'ignored-for-an-archive'],
  ['https://example.com/hello-web-0.1.0.tgz?token=abc', 'other'], ['https://example.com/other-0.1.0.tgz?token=abc', 'hello-web'],
  ['https://charts.example.com', 'hello-web'], ['https://charts.example.com/stable/', 'Hello-Web'],
]

const others: Case[] = [
  ['oci://ghcr.io/acme/charts/frontend'], ['oci://ghcr.io/acme/my-hello-web'], ['oci://ghcr.io/acme/hello-web-extra'],
  ['oci://ghcr.io/acme/web'], ['oci://ghcr.io/hello-web/frontend'], ['oci://hello-web/frontend'],
  // the getter appends repo: …/hello-web/frontend
  ['oci://ghcr.io/acme/hello-web', 'frontend'],
  ['https://example.com/my-hello-web-0.1.0.tgz'], ['https://example.com/hello-web-extra-0.1.0.tgz'],
  ['https://hello-web.example.com/hello-web/frontend-0.1.0.tgz'],
  // the getter ignores repo for an archive
  ['https://example.com/frontend-0.1.0.tgz', 'hello-web'],
  ['https://charts.example.com/hello-web', 'frontend'], ['https://charts.example.com', 'my-hello-web'],
  ['https://charts.example.com', 'hello-web-extra'],
]

const unknowns: Case[] = [
  [''], ['oci://'], ['oci://ghcr.io'], ['oci://ghcr.io:5000/'], ['oci://ghcr.io/acme/hello web'], ['oci://ghcr.io/acme/:0.1.0'],
  ['oci://ghcr.io/acme/hello-web:0.1.0', 'frontend'], ['OCI://ghcr.io/acme/frontend'], ['ghcr.io/acme/frontend'],
  ['file:///charts/frontend-0.1.0.tgz'], ['frontend-0.1.0.tgz'], ['https://'], ['https://charts.example.com'],
  ['https://charts.example.com', ''], ['https://charts.example.com', 'a chart'], ['https://example.com/frontend.tgz'],
  ['https://example.com/hello-web.tgz'], ['https://example.com/frontend-latest.tgz'], ['https://example.com/%zz-0.1.0.tgz'],
  ['https://example.com/download?file=frontend-0.1.0.tgz', 'frontend'],
]

describe('chartReference', () => {
  it.each(own)('%s (repo %s) is the chart itself', (...reference) => { expect(registers(reference)).toBe(true) })

  it.each(others)('%s (repo %s) is another chart', (...reference) => {
    expect(chartReference({ repo: reference[1], url: reference[0] })).toHaveProperty('names')
    expect(registers(reference)).toBe(false)
  })

  it.each(unknowns)('%s (repo %s) cannot be told, and says why', (url, repo) => {
    expect(chartReference({ repo, url })).toEqual({ unknown: expect.any(String) as string })
  })

  it.each([[undefined], [null], ['hello-web'], [{}], [{ repo: 'hello-web' }], [{ url: 5 }], [{ repo: 7, url: 'https://charts.example.com' }]])('%j names no chart', (chart) => {
    const reference = chartReference(chart)
    expect(reference).toHaveProperty('unknown')
    expect(registersChart(reference, 'hello-web')).toBe(false)
  })

  it.each<Case>([['oci://ghcr.io/acme/foo-bar'], ['https://example.com/foo-bar-1.0.0.tgz'], ['https://charts.example.com', 'foo-bar']])('%s is not the chart its name extends', (...reference) => {
    expect([registers(reference, 'foo'), registers(reference, 'bar'), registers(reference, 'foo-bar')]).toEqual([false, false, true])
  })

  it('an archive whose name splits two ways may be either', () => {
    const reference: Case = ['https://example.com/foo-1.0.0-2.0.0.tgz']
    expect([registers(reference, 'foo'), registers(reference, 'foo-1.0.0'), registers(reference, 'bar')]).toEqual([true, true, false])
  })
})

describe('definitionsIn', () => {
  const own1 = 'apiVersion: core.krateo.io/v1alpha1\nkind: CompositionDefinition\nmetadata: {name: x}\nspec: {chart: {url: oci://r/a/hello-web}}\n'
  const item = (text: string) => `  - ${text.trim().split('\n').join('\n    ')}\n`
  const find = (yaml: string) => {
    const body = load(yaml) as Record<string, unknown>
    return definitionsIn(body, body.apiVersion as string, body.kind as string)
  }
  const bare = own1.split('\n').slice(2).join('\n')

  it('reads the object, at any version of the group and of no other group', () => {
    expect(find(own1)).toEqual([{ name: 'x', reference: { names: ['hello-web'] } }])
    expect(find(own1.replace('v1alpha1', 'v1beta1'))).toHaveLength(1)
    for (const group of ['core.krateo.io.example.com/v1', 'xcore.krateo.io/v1', 'v1']) {
      expect(find(own1.replace('core.krateo.io/v1alpha1', group))).toEqual([])
    }
  })

  it.each([
    ['a List', `apiVersion: v1\nkind: List\nitems:\n${item('kind: ConfigMap\napiVersion: v1')}${item(own1)}`],
    ['a typed list', `apiVersion: core.krateo.io/v1alpha1\nkind: CompositionDefinitionList\nitems:\n${item(own1)}`],
    ['an item that takes its kind from the list', `apiVersion: core.krateo.io/v1alpha1\nkind: CompositionDefinitionList\nitems:\n${item(bare)}`],
    ['a list inside a list', `apiVersion: v1\nkind: List\nitems:\n${item(`apiVersion: v1\nkind: List\nitems:\n${item(own1)}`)}`],
    ['any object with items', `apiVersion: v1\nkind: ConfigMap\nitems:\n${item(own1)}`],
  ])('reads a definition inside %s', (_, yaml) => {
    expect(find(yaml)).toEqual([{ name: 'x', reference: { names: ['hello-web'] } }])
  })

  it('a typed list that cannot be read cannot be told', () => {
    const head = 'apiVersion: core.krateo.io/v1alpha1\nkind: CompositionDefinitionList\n'
    for (const tail of ['', 'items:\n  - 5\n']) {
      expect(find(head + tail)).toEqual([{ name: '', reference: { unknown: expect.any(String) as string } }])
    }
    expect(find('apiVersion: v1\nkind: List\nitems:\n  - 5\n')).toEqual([])
  })
})
