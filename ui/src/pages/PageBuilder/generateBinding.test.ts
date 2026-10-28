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

import { dataPathFor, generateBinding, validateBinding } from './generateBinding'

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

    // CHART-RELATIVE keys, via pageDraftSlug — a page set publishes as its own Helm chart, and a
    // chart keeps its manifests in templates/. The key IS the path; nothing routes it afterwards.
    expect(restAction.path).toBe('templates/restaction.fleet-failing.yaml')
    expect(widget.path).toBe('templates/table.fleet-failing.yaml')
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

describe('validateBinding — the author may write an expression; it may not escape the wrapper', () => {
  /*
   * THIS CONTRACT INVERTED, deliberately, and the old one is worth stating because it was wrong
   * for a stated reason rather than by accident.
   *
   * It used to refuse every pipe, function and piece of arithmetic, on the grounds that a bad
   * expression would leave the author "debugging generated code they did not write". Measured
   * against the live server, that premise is false: snowplow answers a malformed filter with
   *   unable to resolve filter: invalid jq query "{ rows: [ ... | { c1: } ] }": unexpected token "}"
   * and a runtime fault with
   *   unable to resolve filter: expected an object but got: string ("kagent-ui-...")
   * — the query quoted, the token named, the offending value named. `readErrorDetail` already
   * hoists that onto the error and `WidgetRenderer` already prefers it over the HTTP phrase, so the
   * author reads the server's own words in the live preview.
   *
   * What remains refused is CONTAINMENT, not taste: the expression is interpolated inside
   * `(try ( … ) catch null)`, and a balanced expression cannot reach past those parens whatever it
   * contains.
   */
  it.each([
    ['a pipe', '.metadata.name | ascii_downcase'],
    ['a function call', '(.spec.replicas // 0) | tostring'],
    ['arithmetic', '(.status.ready // 0) - (.status.desired // 0)'],
    ['an alternative', '.a // "n/a"'],
    ['an if/then/else', 'if .status.phase == "Running" then "up" else "down" end'],
    ['an array construction', '[.spec.containers[].name] | join(", ")'],
  ])('ACCEPTS %s — being wrong is the server\'s job to report, not the form\'s', (_label, path) => {
    expect(validateBinding(input({ columns: { Good: path } }))).toBeNull()
  })

  it.each([
    ['a closing paren that escapes the wrapper', '.a) | .b'],
    ['a fabricated sibling key', '1) } ], evil: (2'],
    ['an unclosed bracket', '.spec.containers[0'],
    ['an unclosed brace', '{ a: .b'],
    ['an unterminated string', '.metadata.labels["krateo'],
    ['empty', ''],
    // A backslash passes a quote-only check — it is an ordinary character to the regex — and then
    // escapes the closing quote inside the generated program, so jq fails to compile.
    ['a backslash in a quoted key', '.["a\\"]'],
  ])('refuses %s — it would rewrite the generated program', (_label, path) => {
    const error = validateBinding(input({ columns: { Bad: path } }))

    expect(error).toContain('unbalanced')
  })

  it('refuses a control character, which would break the generated line', () => {
    expect(validateBinding(input({ columns: { Bad: '.a\nevil' } }))).toContain('unbalanced')
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
    // able to produce a filter that rewrites the program around it.
    //
    // The example is UNBALANCED rather than merely exotic. `.a | halt` used to serve here and no
    // longer refuses — it is contained, so it reaches the server, aborts the filter, and comes back
    // as a message the preview shows. That is the new contract working, not a hole in it.
    expect(generateBinding(input({ columns: { Bad: '.a) | .b' } })).ok).toBe(false)
  })
})

describe('binding a kind that is not a Table', () => {
  /*
   * Every widget CRD carries `spec.apiRef`, so binding was never Table-specific in the data model —
   * only in this emitter. The one path that gave a newly authored widget live data therefore
   * produced a Table whatever you had asked for, which at forty-four creatable kinds is the
   * difference between "create any widget" and "create any widget and then hand-write its YAML".
   */
  const bind = (kind: string, extraWidgetData?: Record<string, unknown>) => generateBinding({
    apiPath: '/api/v1/namespaces/krateo-system/pods',
    columns: { Node: '.spec.nodeName', Pod: '.metadata.name' },
    extraWidgetData,
    itemsAt: '.items',
    kind,
    name: 'pods-by-node',
    namespace: 'krateo-system',
  })

  it('writes into the array field the CRD names, which differs by kind', () => {
    // Charts require `data`; Table and Listy use `dataSource` and do not require it — so "the
    // required array property" is the wrong rule and finds nothing for half of them.
    expect(dataPathFor('LineChart')).toBe('data')
    expect(dataPathFor('Table')).toBe('dataSource')
    expect(dataPathFor('Listy')).toBe('dataSource')
  })

  it('NEVER treats a container\'s items as a data array', () => {
    // Every container REQUIRES the arrays `items` and `allowedResources`, which hold child
    // references. Filling them with fetched rows would replace a page's structure with its data.
    for (const container of ['Flex', 'Row', 'Col', 'Tabs', 'Card']) {
      expect(dataPathFor(container), container).not.toBe('items')
      expect(dataPathFor(container), container).not.toBe('allowedResources')
    }
  })

  it('emits PLAIN OBJECTS for a chart, not Table cell arrays', () => {
    const result = bind('LineChart', { xField: 'Node', yField: 'Pod' })
    expect(result.ok).toBe(true)
    if (!result.ok) { return }
    const widget = load(result.widget.content) as { kind: string; spec: { widgetDataTemplate: { expression: string; forPath: string }[] } }
    expect(widget.kind).toBe('LineChart')
    expect(widget.spec.widgetDataTemplate[0].forPath).toBe('data')
    // Keyed by the column TITLE — a chart's xField names a key in the data, and the author picks it
    // from the titles they typed. Emitting the internal c1/c2 would give them axes referring to
    // fields that do not exist: renders empty, reports nothing.
    //
    // Asserted WITHOUT assuming which title got which generated key: that follows the object's
    // insertion order, and a lint autofix sorting the fixture's keys is enough to flip it. The
    // property is that each TITLE maps to some internal key, not which one.
    const [{ expression }] = widget.spec.widgetDataTemplate
    expect(expression).toMatch(/"Pod": \.c\d/)
    expect(expression).toMatch(/"Node": \.c\d/)
    expect(expression).not.toContain('valueKey')
  })

  it('a title with a SPACE stays valid jq and stays selectable as an axis', () => {
    const result = generateBinding({
      apiPath: '/api/v1/namespaces/krateo-system/pods',
      columns: { 'Node name': '.spec.nodeName' },
      extraWidgetData: { xField: 'Node name', yField: 'Node name' },
      itemsAt: '.items',
      kind: 'LineChart',
      name: 'by-node',
      namespace: 'krateo-system',
    })
    if (!result.ok) { return }
    const widget = load(result.widget.content) as { spec: { widgetDataTemplate: { expression: string }[] } }
    expect(widget.spec.widgetDataTemplate[0].expression).toMatch(/"Node name": \.c\d/)
  })

  it('carries the fields only the author can decide, and lets them win', () => {
    // Which mapped column is the x axis is not derivable; guessing it publishes clean and plots the
    // wrong thing.
    const result = bind('LineChart', { xField: 'Node', yField: 'Pod' })
    if (!result.ok) { return }
    const widget = load(result.widget.content) as { spec: { widgetData: Record<string, unknown> } }
    expect(widget.spec.widgetData.xField).toBe('Node')
    expect(widget.spec.widgetData.yField).toBe('Pod')
  })

  it('omits `columns`, which only a Table has', () => {
    const result = bind('LineChart', { xField: 'Node', yField: 'Pod' })
    if (!result.ok) { return }
    const widget = load(result.widget.content) as { spec: { widgetData: Record<string, unknown> } }
    expect(widget.spec.widgetData).not.toHaveProperty('columns')
  })

  it('reports the plural of the kind it ACTUALLY emitted', () => {
    const result = bind('LineChart', { xField: 'Node', yField: 'Pod' })
    expect(result).toMatchObject({ ok: true, resource: 'linecharts' })
  })

  it('REFUSES a kind with no list to bind, rather than writing a template that goes nowhere', () => {
    // A Paragraph takes text, not rows. Emitting `forPath: dataSource` for it would produce a
    // widget that publishes cleanly and renders nothing — the failure this codebase calls the worst
    // available, because nothing downstream reports it.
    const result = bind('Paragraph')
    expect(result.ok).toBe(false)
    if (result.ok) { return }
    expect(result.error).toMatch(/no list to bind/)
  })

  it('still emits a Table when nothing says otherwise', () => {
    const result = generateBinding({
      apiPath: '/api/v1/namespaces/krateo-system/pods',
      columns: { Pod: '.metadata.name' },
      itemsAt: '.items',
      name: 'pods',
      namespace: 'krateo-system',
    })
    expect(result).toMatchObject({ ok: true, resource: 'tables' })
  })
})
