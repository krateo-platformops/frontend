/**
 * `checkResolvedShape` — does a resolved widgetDataTemplate value match its CRD's shape?
 *
 * The case that matters is frontend#473's: `krateo-blueprints/event-health` paired a RESTAction
 * emitting rows as OBJECTS with a Table feeding them to `dataSource`, which requires an array of
 * arrays of cells. Preview, publish, release and install all passed because the query returned
 * nothing, and the widget died the first time a row existed. The first test here is that exact
 * value and that exact API server message.
 */
/* eslint-disable no-template-curly-in-string -- the ${…} jq DSL appears in the expression tests */
import { describe, expect, it } from 'vitest'

import { checkResolvedShape, itemSchemaConstrains, primeEmptyArrays, schemaAtPath } from './widgetShape'

describe("frontend#473: the shape that shipped and the message the API server gave", () => {
  it('REJECTS rows that are objects, in the API server\'s own words', () => {
    // `expression: ${ .sites }` over a RESTAction whose rows are objects.
    const resolved = [{ name: 'milan', status: 'Ready' }, { name: 'rome', status: 'Ready' }]
    const verdict = checkResolvedShape('Table', 'dataSource', resolved)
    expect(verdict.verdict).toBe('wrong')
    // The live error was:
    //   dataSource[0]: Invalid value: "object": dataSource[0] in body must be of type array: "object"
    expect(verdict).toHaveProperty('detail', 'dataSource[0]: Invalid value: "object": dataSource[0] in body must be of type array: "object"')
  })

  it('ACCEPTS the same table once its rows are arrays of cells', () => {
    const resolved = [[{ kind: 'jsonSchemaType', valueKey: 'name', type: 'string', stringValue: 'milan' }]]
    expect(checkResolvedShape('Table', 'dataSource', resolved)).toEqual({ verdict: 'ok' })
  })

  it('is SILENT on the empty value every gate saw — nothing to judge is not a pass', () => {
    // This is the whole bug: [] satisfies the schema, so this check CANNOT be the thing that
    // catches #473 on its own. The caller must treat an empty result as unexercised.
    expect(checkResolvedShape('Table', 'dataSource', [])).toEqual({ verdict: 'ok' })
  })

  it('names a missing required cell key, which is the other way a cell goes wrong', () => {
    const resolved = [[{ valueKey: 'name', stringValue: 'milan' }]] // no `kind`
    const verdict = checkResolvedShape('Table', 'dataSource', resolved)
    expect(verdict.verdict).toBe('wrong')
    expect(verdict).toHaveProperty('detail', expect.stringContaining('dataSource[0][0].kind in body is required'))
  })

  it('reports the FIRST offending row, as the API server does', () => {
    const resolved = [[{ kind: 'jsonSchemaType', valueKey: 'a' }], { bad: true }]
    expect(checkResolvedShape('Table', 'dataSource', resolved)).toHaveProperty('detail', expect.stringContaining('dataSource[1]'))
  })
})

describe('it refuses to judge what it cannot', () => {
  it('is unknowable for a kind or field outside the widget registry', () => {
    expect(checkResolvedShape('NotAWidget', 'dataSource', []).verdict).toBe('unknowable')
    expect(checkResolvedShape('Table', 'notAField', []).verdict).toBe('unknowable')
  })

  it('does not judge a field the CRD itself leaves open', () => {
    // Listy's dataSource items are (the kind is `Listy`: `List` collides with k8s' meta List) `x-kubernetes-preserve-unknown-fields`: the CRD accepts any
    // object there, so an object row is CORRECT for a Listy and must not be reported.
    expect(checkResolvedShape('Listy', 'dataSource', [{ anything: 'goes' }])).toEqual({ verdict: 'ok' })
  })

  it('resolves a path with an index, the other form validateDataTemplate accepts', () => {
    // Shape only: that `series[0].data` descends into items rather than failing.
    expect(schemaAtPath('Table', 'dataSource')).not.toBeNull()
    expect(schemaAtPath('Table', 'columns[0].title')).not.toBeNull()
  })
})

describe('itemSchemaConstrains: which fields a pass-through could actually break', () => {
  it('is TRUE for a Table\'s dataSource — strict cell arrays, which is why #473 happened there', () => {
    expect(itemSchemaConstrains('Table', 'dataSource')).toBe(true)
  })

  it('is FALSE for every chart\'s data — preserve-unknown objects, so rows passed through are correct', () => {
    // This is the case that caught the first version of this check: it used a text test for
    // `valueKey`, which is Table's marker, and so called every chart pass-through a defect. The
    // gate's own fixture (PieChart/pod-phase-pie) went red on a page that was fine.
    expect(itemSchemaConstrains('PieChart', 'data')).toBe(false)
    expect(itemSchemaConstrains('BarChart', 'data')).toBe(false)
    expect(itemSchemaConstrains('LineChart', 'data')).toBe(false)
  })

  it('is FALSE for a Listy\'s dataSource, and for anything it cannot find', () => {
    expect(itemSchemaConstrains('Listy', 'dataSource')).toBe(false)
    expect(itemSchemaConstrains('NotAWidget', 'dataSource')).toBe(false)
  })
})

describe('a cell\'s own values are judged too, not just the nesting', () => {
  const cell = (extra: object) => [[{ kind: 'jsonSchemaType', valueKey: 'name', ...extra }]]

  it('catches a stringValue holding an object — right nesting, unusable value', () => {
    // Without this the nesting check alone passes, and the table renders a cell of "[object Object]".
    expect(checkResolvedShape('Table', 'dataSource', cell({ stringValue: {} }))).toHaveProperty(
      'detail',
      'dataSource[0][0].stringValue: Invalid value: "object": dataSource[0][0].stringValue in body must be of type string: "object"',
    )
  })

  it('catches a non-string kind', () => {
    expect(checkResolvedShape('Table', 'dataSource', [[{ kind: 123, valueKey: 'n' }]]).verdict).toBe('wrong')
  })

  it('accepts a well-formed cell', () => {
    expect(checkResolvedShape('Table', 'dataSource', cell({ stringValue: 'milan' }))).toEqual({ verdict: 'ok' })
  })
})

describe('priming, and why its leaf values must not be judged', () => {
  it('gives every empty array one element, at any depth', () => {
    expect(primeEmptyArrays({ namespaces: [] })).toEqual({ namespaces: [{}] })
    expect(primeEmptyArrays({ a: { b: [] } })).toEqual({ a: { b: [{}] } })
    expect(primeEmptyArrays({ keep: [1, 2] })).toEqual({ keep: [1, 2] })
  })

  it('structureOnly ignores a leaf type that came from the primer, but still catches a missing cell key', () => {
    // `stringValue: .` over a primed {} yields an object: that is the primer's shape, not the
    // author's, so strict judging here would be a false positive on a correct constructor.
    expect(checkResolvedShape('Table', 'dataSource', [[{ kind: 'jsonSchemaType', valueKey: 'n', stringValue: {} }]], { structureOnly: true })).toEqual({ verdict: 'ok' })
    // The nesting and the required keys ARE the author's, so they are still judged.
    expect(checkResolvedShape('Table', 'dataSource', [[{ valueKey: 'n', stringValue: {} }]], { structureOnly: true }).verdict).toBe('wrong')
    expect(checkResolvedShape('Table', 'dataSource', [{ not: 'an array' }], { structureOnly: true }).verdict).toBe('wrong')
  })
})
