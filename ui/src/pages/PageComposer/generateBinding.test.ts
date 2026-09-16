/**
 * Two things are under test: that the generated pair is one the cluster would accept, and that a
 * field path the author types can never reach the generated jq unvalidated.
 *
 * The second matters more. What they type lands inside a jq program they did not write, so an
 * unchecked string fails as a syntax error in generated code — the worst error to debug, because
 * the thing that is wrong is not the thing you are looking at.
 */
import { load } from 'js-yaml'
import { describe, expect, it } from 'vitest'

import { generateBinding, validateBinding } from './generateBinding'

const input = (over: Partial<Parameters<typeof generateBinding>[0]> = {}) => ({
  apiPath: '/apis/composition.krateo.io/v1alpha1/namespaces/krateo-system/fireworksapps',
  columns: { Name: '.metadata.name', Status: '.status.conditions[0].type' },
  directory: 'helm/portal/templates',
  itemsAt: '.items',
  name: 'fleet-failing',
  ...over,
})

const generated = (over = {}) => {
  const result = generateBinding(input(over))
  if (!result.ok) {
    throw new Error(`expected success, got: ${result.error}`)
  }
  return result
}

describe('generateBinding — the pair', () => {
  it('generates BOTH halves: a widget alone is inert, a RESTAction alone is invisible', () => {
    const { restAction, widget } = generated()

    expect(restAction.path).toBe('helm/portal/templates/restaction.fleet-failing.yaml')
    expect(widget.path).toBe('helm/portal/templates/table.fleet-failing.yaml')
  })

  it('binds the widget to the RESTAction it just generated', () => {
    const doc = load(generated().widget.content) as { spec: { apiRef: { name: string } } }

    // apiRef is the whole point — it is what puts this widget in the 212-template half.
    expect(doc.spec.apiRef.name).toBe('fleet-failing')
  })

  it('shapes every response into the same rows envelope', () => {
    const doc = load(generated().restAction.content) as { spec: { filter: string } }

    // One shape in, one shape out: the widget's template is mechanical precisely because the
    // envelope never varies with what was queried.
    expect(doc.spec.filter).toContain('{ rows: [')
    expect(doc.spec.filter).toContain('.src.items')
  })

  it('keys cells c1..cN rather than by title', () => {
    const doc = load(generated().widget.content) as {
      spec: { widgetData: { columns: { title: string; valueKey: string }[] } }
    }

    // A title is free text — spaces, punctuation, duplicates — and none of that is safe as a jq
    // key or a valueKey. The title stays where it belongs: the column header.
    expect(doc.spec.widgetData.columns).toEqual([
      { title: 'Name', valueKey: 'c1' },
      { title: 'Status', valueKey: 'c2' },
    ])
  })

  it('guards each field so one bad row cannot blank the table', () => {
    const doc = load(generated().restAction.content) as { spec: { filter: string } }

    // Without `// empty`, an object missing one field fails the whole filter and the table shows
    // nothing — one malformed row taking out every good one.
    expect(doc.spec.filter).toContain('// empty')
    expect(doc.spec.filter).toContain('tostring')
  })

  it('handles a response that IS the list', () => {
    const doc = load(generated({ itemsAt: '.' }).restAction.content) as { spec: { filter: string } }

    expect(doc.spec.filter).toContain('(.src // [])')
  })

  it('emits a dataSource template shaped as cell arrays, which is what Table requires', () => {
    const doc = load(generated().widget.content) as {
      spec: { widgetDataTemplate: { forPath: string; expression: string }[] }
    }
    const [template] = doc.spec.widgetDataTemplate

    expect(template.forPath).toBe('dataSource')
    expect(template.expression).toContain('jsonSchemaType')
    expect(template.expression).toContain('stringValue:.c1')
  })

  it('writes the allowedResources the Table CRD requires', () => {
    // Caught by a server dry-run, not by any unit test: without it the apply fails with
    // "spec.widgetData.allowedResources: Required value" and the whole binding is useless.
    const doc = load(generated().widget.content) as {
      spec: { widgetData: { allowedResources: string[] } }
    }

    expect(doc.spec.widgetData.allowedResources).toEqual([])
  })

  it('preserves column order, which is the order they render in', () => {
    const doc = load(generated({
      columns: { Age: '.metadata.creationTimestamp', Name: '.metadata.name', Zone: '.spec.zone' },
    }).widget.content) as { spec: { widgetData: { columns: { title: string }[] } } }

    expect(doc.spec.widgetData.columns.map((column) => column.title)).toEqual(['Age', 'Name', 'Zone'])
  })
})

describe('validateBinding — what the author types never reaches the jq unchecked', () => {
  it.each([
    ['a pipe', '.metadata.name | halt'],
    ['a function call', 'input_line_number'],
    ['arithmetic', '.a + .b'],
    ['an alternative', '.a // "x"'],
    ['a closing paren', '.a) | .b'],
    ['a bare identifier', 'metadata.name'],
    ['empty', ''],
  ])('refuses %s by name rather than generating broken jq', (_label, path) => {
    const error = validateBinding(input({ columns: { Bad: path } }))

    expect(error).toContain('not a supported field path')
  })

  it.each([
    ['.metadata.name'],
    ['.status.conditions[0].type'],
    ['.metadata.labels["krateo.io/composition-id"]'],
    ['.spec.a.b.c'],
  ])('accepts the real shape %s', (path) => {
    expect(validateBinding(input({ columns: { Good: path } }))).toBeNull()
  })

  it('refuses a name that is not a valid resource name', () => {
    // It becomes TWO resource names; an invalid one is rejected by the apiserver at publish, long
    // after the author has moved on.
    expect(validateBinding(input({ name: 'Fleet Failing' }))).toContain('lower-case')
  })

  it('refuses a URL where an apiserver path belongs', () => {
    expect(validateBinding(input({ apiPath: 'https://example.com/things' }))).toContain('must start with')
  })

  it('refuses a table with no columns', () => {
    expect(validateBinding(input({ columns: {} }))).toContain('at least one column')
  })

  it('refuses an untitled column', () => {
    expect(validateBinding(input({ columns: { '   ': '.metadata.name' } }))).toContain('needs a title')
  })

  it('refuses an itemsAt that is not a field path', () => {
    expect(validateBinding(input({ itemsAt: 'items' }))).toContain('not a field path')
  })

  it('generateBinding refuses too, not just validateBinding', () => {
    // The guard belongs on the generator as well: a caller that forgets to validate must not be
    // able to produce a broken filter.
    expect(generateBinding(input({ columns: { Bad: '.a | halt' } })).ok).toBe(false)
  })
})
