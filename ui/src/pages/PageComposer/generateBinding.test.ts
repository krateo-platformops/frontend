/**
 * Two things are under test: the SHAPE of the generated pair, and that a field path the author
 * types can never reach the generated jq unvalidated.
 *
 * "Shape", not "the cluster would accept it" — that is a claim this file cannot make and used to
 * make anyway. Nothing here talks to an apiserver, so these assert the fields a CRD requires are
 * present and correctly spelled; whether the cluster takes the result is settled by a server-side
 * dry-run, which is how the missing `allowedResources` and the missing `apiRef.namespace` were both
 * found AFTER a green run of this file.
 *
 * The validation half matters more. What the author types lands inside a jq program they did not
 * write, so an unchecked string fails as a syntax error in generated code — the worst error to
 * debug, because the thing that is wrong is not the thing you are looking at.
 */
import { load } from 'js-yaml'
import { describe, expect, it } from 'vitest'

import { generateBinding, validateBinding } from './generateBinding'

const input = (over: Partial<Parameters<typeof generateBinding>[0]> = {}) => ({
  apiPath: '/apis/composition.krateo.io/v1alpha1/namespaces/krateo-system/fireworksapps',
  columns: { Name: '.metadata.name', Status: '.status.conditions[0].type' },
  itemsAt: '.items',
  name: 'fleet-failing',
  namespace: 'krateo-system',
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

    // HELD KEYS — bare identity tokens, no directory. `pagePublishPath` prefixes the chart root
    // once, at publish; emitting a prefixed path here published to
    // `helm/portal/templates/helm/portal/templates/…`.
    expect(restAction.path).toBe('restaction.fleet-failing.yaml')
    expect(widget.path).toBe('table.fleet-failing.yaml')
  })

  it('sets apiRef.namespace, which the Table CRD requires and nothing defaults', () => {
    const doc = load(generated().widget.content) as {
      metadata: { namespace: string }
      spec: { apiRef: { namespace: string } }
    }

    // js-yaml omits an undefined key entirely, so when this was optional and the caller did not
    // pass it, the generated Table carried no namespace at all and every apply was rejected with
    // "spec.apiRef.namespace: Required value". The absence was invisible in the Files tab.
    expect(doc.spec.apiRef.namespace).toBe('krateo-system')
    expect(doc.metadata.namespace).toBe('krateo-system')
  })

  it('refuses to generate at all when the draft declares no namespace', () => {
    // Refusing beats defaulting: a guessed namespace publishes clean and renders nothing.
    expect(generateBinding(input({ namespace: '' })).ok).toBe(false)
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

  it('guards each cell so a missing, false, or wrongly-typed field cannot drop the row', () => {
    const doc = load(generated().restAction.content) as { spec: { filter: string } }

    // This asserted `// empty` and claimed it was the guard. It is the opposite. Run against a
    // 3-item list where one item lacked `.status.ready` and one had it `false`, the `// empty`
    // form emitted ONE row: in jq an object-construction value that evaluates to `empty` yields no
    // object, so the row vanishes whole, and `//` treats `false` the same as absent. A third case
    // — a field whose parent is a scalar — aborted the entire filter with "Cannot index string
    // with string", blanking the table outright.
    //
    // `try … catch null` makes the indexing error a null instead of an abort, and the explicit
    // null test distinguishes absent from false. Same three items, three rows out.
    expect(doc.spec.filter).toContain('try (.metadata.name) catch null')
    expect(doc.spec.filter).toContain('if . == null then "" else tostring end')
    expect(doc.spec.filter).not.toContain('// empty')
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
    // Caught by a server dry-run, not by this file: without it the apply fails with
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
    // A backslash passes a quote-only check — it is an ordinary character to the regex — and then
    // escapes the closing quote inside the generated program, so jq fails to compile.
    ['a backslash in a quoted key', '.["a\\"]'],
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
