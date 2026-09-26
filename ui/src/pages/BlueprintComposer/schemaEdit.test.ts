/**
 * values.schema.json, edited the way crdgen needs it. Every edit is a SPLICE — the bytes outside the
 * edited span are the author's and stay exactly as written — and every output is held to the lint
 * the publish gate runs: no [CRDGEN-DEFAULTS] survives a fix or an added field.
 */
import { describe, expect, it } from 'vitest'

import { lintBlueprintDraft } from '../../components/Autopilot/blueprintDraft'

import { MOCKUP_10_FIXED, MOCKUP_10_SCHEMA } from './__fixtures__/s4a'
import { addFormField, fixPopulatedDefault, formSuppressions, schemaProblemsAt } from './schemaEdit'
import { startChart } from './startChart'

const SEEDED_SCHEMA = (() => {
  const started = startChart({ description: '', name: 'orders', version: '0.1.0' })
  if (!started.ok) { throw new Error('fixture refused') }
  return started.files['values.schema.json']
})()

/** The lint the publish gate runs, over a chart holding this schema. */
const crdgenDefaults = (schema: string): string[] =>
  lintBlueprintDraft({ 'Chart.yaml': 'apiVersion: v2\nname: orders\nversion: 0.1.0\n', 'values.schema.json': schema }, 'blueprint')
    .filter((problem) => problem.startsWith('[CRDGEN-DEFAULTS]'))

const edited = (result: { ok: true; text: string } | { ok: false; reason: string }): string => {
  if (!result.ok) { throw new Error(result.reason) }
  expect(crdgenDefaults(result.text)).toEqual([])
  return result.text
}

describe('schemaProblemsAt — each lint finding, located', () => {
  it('the mockup-10 schema: one problem, the credentials property marked from its key to its end', () => {
    expect(schemaProblemsAt(MOCKUP_10_SCHEMA)).toEqual([{
      code: 'CRDGEN-DEFAULTS',
      endLine: 25,
      field: 'credentials.default',
      fixable: true,
      message: 'credentials.default — a populated object default breaks Krateo\'s CRD generation: the CompositionDefinition would wedge at Ready=False. Keep the object default empty and put the values on the scalars inside it.',
      path: 'properties.credentials.default',
      startLine: 21,
    }])
    expect(MOCKUP_10_SCHEMA.split('\n')[20]).toBe('    "credentials": {')
  })

  it('a property NAMED default is a property, not the keyword', () => {
    expect(schemaProblemsAt('{"type":"object","properties":{"default":{"type":"object","properties":{"x":{"type":"string"}}}}}')).toEqual([])
    const [problem] = schemaProblemsAt('{"type":"object","properties":{"default":{"type":"object","default":{"x":"y"},"properties":{"x":{"type":"string"}}}}}')
    expect(problem).toMatchObject({ field: 'default.default', path: 'properties.default.default' })
  })

  it('a combinator is marked, and is not fixable', () => {
    const text = '{\n  "type": "object",\n  "properties": {\n    "src": { "anyOf": [{ "required": ["a"] }, { "required": ["b"] }] }\n  }\n}\n'
    expect(schemaProblemsAt(text)).toEqual([expect.objectContaining({ code: 'CRDGEN-COMBINATOR', endLine: 4, field: 'src.anyOf', fixable: false, startLine: 4 })])
    expect(schemaProblemsAt(text)[0].message).toMatch(/^src\.anyOf — `anyOf` is valid JSON Schema but breaks Krateo's CRD generation/)
    expect(fixPopulatedDefault(text, 'properties.src.anyOf').ok).toBe(false)
  })

  it('invalid JSON: one problem, on the line where the text stops being JSON', () => {
    const text = '{\n  "type": "object",\n  "properties": {\n    "a": { "type": "string" },\n  }\n}\n'
    const [problem] = schemaProblemsAt(text)
    expect(problem).toMatchObject({ code: 'JSON', endLine: 5, field: '', fixable: false, startLine: 5 })
    expect(problem.message.startsWith('values.schema.json is not valid JSON — ')).toBe(true)
  })

  it('a clean schema has none', () => {
    expect(schemaProblemsAt(SEEDED_SCHEMA)).toEqual([])
    expect(schemaProblemsAt(MOCKUP_10_FIXED)).toEqual([])
  })
})

describe('formSuppressions', () => {
  it('names the top-level fields whose schema has a problem — and none once it is fixed', () => {
    expect(formSuppressions(MOCKUP_10_SCHEMA)).toEqual(['credentials'])
    expect(formSuppressions(MOCKUP_10_FIXED)).toEqual([])
    expect(formSuppressions('{"default":{"a":1},"properties":{}}')).toEqual([])
  })
})

describe('fixPopulatedDefault — "Fix it for me"', () => {
  it('the mockup: the object default emptied, byte for byte — "basic" is already on the scalar', () => {
    expect(edited(fixPopulatedDefault(MOCKUP_10_SCHEMA, 'properties.credentials.default'))).toBe(MOCKUP_10_FIXED)
  })

  it('moves each scalar onto its property when that has no default, following nested objects, never overwriting', () => {
    const text = [
      '{',
      '  "type": "object",',
      '  "properties": {',
      '    "db": {',
      '      "type": "object",',
      '      "default": { "engine": "postgres", "size": 10, "tls": { "enabled": true }, "tags": ["a"], "ghost": 1 },',
      '      "properties": {',
      '        "engine": { "type": "string" },',
      '        "size": { "type": "integer", "default": 20 },',
      '        "tls": {',
      '          "type": "object",',
      '          "properties": {',
      '            "enabled": {',
      '              "type": "boolean"',
      '            }',
      '          }',
      '        },',
      '        "tags": { "type": "array" }',
      '      }',
      '    }',
      '  }',
      '}',
      '',
    ].join('\n')
    const expected = text
      .replace('"default": { "engine": "postgres", "size": 10, "tls": { "enabled": true }, "tags": ["a"], "ghost": 1 }', '"default": {}')
      .replace('"engine": { "type": "string" }', '"engine": { "type": "string", "default": "postgres" }')
      .replace('              "type": "boolean"\n', '              "type": "boolean",\n              "default": true\n')
    expect(edited(fixPopulatedDefault(text, 'properties.db.default'))).toBe(expected)
  })

  it('a populated array default becomes []', () => {
    const text = '{"type":"object","properties":{"list":{"type":"array","default":["a","b"]}}}'
    expect(edited(fixPopulatedDefault(text, 'properties.list.default'))).toBe('{"type":"object","properties":{"list":{"type":"array","default":[]}}}')
  })

  it('a path with no problem — the schema moved on — is refused, not guessed', () => {
    expect(fixPopulatedDefault(MOCKUP_10_FIXED, 'properties.credentials.default')).toEqual({
      ok: false, reason: 'There is no problem at properties.credentials.default to fix — the schema has changed since it was read.',
    })
  })
})

describe('addFormField', () => {
  it('into the seeded, empty properties: opened out onto a line of its own', () => {
    expect(edited(addFormField(SEEDED_SCHEMA, { name: 'region', type: 'string' }))).toBe(SEEDED_SCHEMA.replace(
      '"properties": {}',
      '"properties": {\n    "region": { "type": "string" }\n  }',
    ))
  })

  it('after the last field, at its indent; an enum starts with one option', () => {
    const text = '{\n  "type": "object",\n  "properties": {\n    "a": { "type": "string" }\n  }\n}\n'
    expect(edited(addFormField(text, { name: 'tier', type: 'enum' })))
      .toBe('{\n  "type": "object",\n  "properties": {\n    "a": { "type": "string" },\n    "tier": { "type": "string", "enum": ["option-1"] }\n  }\n}\n')
    expect(edited(addFormField('{"properties":{"a":{"type":"string"}}}', { name: 'n', type: 'number' })))
      .toBe('{"properties":{"a":{"type":"string"}, "n": { "type": "number" }}}')
  })

  it('a schema with no properties gets them', () => {
    expect(edited(addFormField('{\n  "type": "object"\n}\n', { name: 'on', type: 'boolean' })))
      .toBe('{\n  "type": "object",\n  "properties": { "on": { "type": "boolean" } }\n}\n')
  })

  it('refuses a duplicate, a name that is not one, the create form\'s own two names, and a schema it cannot read', () => {
    const text = '{"type":"object","properties":{"region":{"type":"string"}}}'
    expect(addFormField(text, { name: 'region', type: 'string' })).toEqual({ ok: false, reason: '"region" is already a field of this form.' })
    expect(addFormField(text, { name: 'name', type: 'string' })).toEqual({ ok: false, reason: '"name" is reserved — the create form always asks for the composition\'s name and namespace itself.' })
    expect(addFormField(text, { name: 'namespace', type: 'string' }).ok).toBe(false)
    for (const bad of ['1st', 'a-b', 'a b', '']) {
      const refused = addFormField(text, { name: bad, type: 'string' })
      expect(!refused.ok && refused.reason).toMatch(/is not a field name/)
    }
    expect(addFormField('{"type":', { name: 'x', type: 'string' })).toEqual({ ok: false, reason: 'values.schema.json is not valid JSON — fix it before adding a field.' })
    expect(addFormField('[]', { name: 'x', type: 'string' }).ok).toBe(false)
    expect(addFormField('{"properties":[]}', { name: 'x', type: 'string' }).ok).toBe(false)
  })

  it('refuses "global", of every type the form adds — CDC writes an object there on every render', () => {
    const text = '{"type":"object","properties":{"region":{"type":"string"}}}'
    for (const type of ['string', 'number', 'boolean', 'enum'] as const) {
      expect(addFormField(text, { name: 'global', type })).toEqual({
        ok: false,
        reason: '"global" is reserved — composition-dynamic-controller adds a global block of its own to the values of every render, so a field by that name would fail every composition.',
      })
    }
    // Only the exact key: a field that merely starts with it is the author's.
    expect(addFormField(text, { name: 'globalRegion', type: 'string' }).ok).toBe(true)
    // …and a name the prototype carries is not "reserved".
    expect(addFormField(text, { name: 'constructor', type: 'string' }).ok).toBe(true)
  })
})
