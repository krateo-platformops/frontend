import type { JSONSchema4 } from 'json-schema'
import { describe, expect, it } from 'vitest'

import { applyFieldConfig, templatePathOf } from './fieldConfig'
import { collectDependencies, nodeAt, resolveFieldPath } from './fieldDependencies'
import { CHECK_KEY, HELP_KEY, OPTIONS_KEY, ROW_TITLE_KEY, SUGGESTIONS_KEY, VISIBLE_WHEN_KEY } from './fieldKeys'
import { getFieldOptionsSpec } from './fieldOptions'
import { isVisible } from './visibleWhen'

/* eslint-disable sort-keys/sort-keys-fix */
const SCHEMA: JSONSchema4 = {
  type: 'object',
  properties: {
    region: { type: 'string' },
    zone: { type: 'string' },
    owner: { type: 'string' },
    logLevel: { type: 'string' },
    service: {
      type: 'object',
      properties: {
        type: { type: 'string', enum: ['ClusterIP', 'NodePort'] },
        nodePort: { type: 'integer' },
      },
    },
    tls: { type: 'boolean' },
    hosts: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          host: { type: 'string' },
          region: { type: 'string' },
          zone: { type: 'string' },
          subjects: { type: 'object', properties: { name: { type: 'string' } } },
        },
      },
    },
  },
}
/* eslint-enable sort-keys/sort-keys-fix */

const at = (schema: JSONSchema4 | undefined, name: string): JSONSchema4 | undefined =>
  nodeAt(schema, templatePathOf(SCHEMA, name) ?? [])

describe('templatePathOf', () => {
  it('names a field by its dotted path, through a list without an index', () => {
    expect(templatePathOf(SCHEMA, 'service.nodePort')).toEqual(['service', 'nodePort'])
    expect(templatePathOf(SCHEMA, 'hosts')).toEqual(['hosts'])
    expect(templatePathOf(SCHEMA, 'hosts.zone')).toEqual(['hosts', '[]', 'zone'])
    expect(templatePathOf(SCHEMA, 'hosts.subjects.name')).toEqual(['hosts', '[]', 'subjects', 'name'])
  })

  it('names nothing for a path the schema does not have', () => {
    expect(templatePathOf(SCHEMA, 'nope')).toBeUndefined()
    expect(templatePathOf(SCHEMA, 'service.')).toBeUndefined()
    expect(templatePathOf(SCHEMA, '')).toBeUndefined()
  })
})

describe('applyFieldConfig', () => {
  it('writes autocomplete on its field: open by default, extra.key searches', () => {
    const schema = applyFieldConfig(SCHEMA, {
      autocomplete: [
        { closed: true, fallback: 'manual', name: 'region', resourceRefId: 'regions' },
        { extra: { key: 'q' }, minChars: 3, name: 'owner', resourceRefId: 'users' },
      ],
    })
    expect(getFieldOptionsSpec(at(schema, 'region') as JSONSchema4)).toEqual({ closed: true, fallback: 'manual', ref: 'regions' })
    expect(getFieldOptionsSpec(at(schema, 'owner') as JSONSchema4)).toEqual({ closed: false, ref: 'users', search: { minChars: 3, param: 'q' } })
  })

  it('writes dependencies on their field: a closed list by default, the parent sent under extra.key', () => {
    const schema = applyFieldConfig(SCHEMA, {
      dependencies: [
        { dependsOn: { name: 'region' }, extra: { key: 'region' }, name: 'zone', resourceRefId: 'zones' },
        { closed: false, dependsOn: { name: 'hosts.region' }, extra: { key: 'region' }, name: 'hosts.zone', resourceRefId: 'zones' },
      ],
    })
    expect(getFieldOptionsSpec(at(schema, 'zone') as JSONSchema4)).toEqual({ closed: true, dependsOn: { field: '/region', param: 'region' }, ref: 'zones' })
    const row = getFieldOptionsSpec(at(schema, 'hosts.zone') as JSONSchema4)
    expect(row).toEqual({ closed: false, dependsOn: { field: '/hosts.[].region', param: 'region' }, ref: 'zones' })
    // …which reads the region of the same row
    expect(resolveFieldPath(row?.dependsOn?.field as string, ['hosts', 1])).toEqual(['hosts', 1, 'region'])
    expect(collectDependencies(schema).dependencies).toEqual([
      { child: ['zone'], parent: ['region'] },
      { child: ['hosts', '[]', 'zone'], parent: ['hosts', '[]', 'region'] },
    ])
  })

  it('lets a field in both lists depend on another, as the previous frontend did', () => {
    const schema = applyFieldConfig(SCHEMA, {
      autocomplete: [{ name: 'zone', resourceRefId: 'all-zones' }],
      dependencies: [{ dependsOn: { name: 'region' }, extra: { key: 'region' }, name: 'zone', resourceRefId: 'zones' }],
    })
    expect(getFieldOptionsSpec(at(schema, 'zone') as JSONSchema4)?.ref).toBe('zones')
  })

  it('says why a dependency cannot load instead of dropping it', () => {
    const schema = applyFieldConfig(SCHEMA, {
      dependencies: [
        { dependsOn: { name: 'nope' }, extra: { key: 'region' }, name: 'zone', resourceRefId: 'zones' },
        { dependsOn: { name: 'region' }, extra: { key: 'username' }, name: 'owner', resourceRefId: 'users' },
      ],
    })
    expect(getFieldOptionsSpec(at(schema, 'zone') as JSONSchema4)?.problem).toBe('dependsOn.name must name a field of the form')
    expect(getFieldOptionsSpec(at(schema, 'owner') as JSONSchema4)?.problem).toContain('identity')
  })

  it('reads displayingDependencies with the typed value; several on one field must all hold', () => {
    const schema = applyFieldConfig(SCHEMA, {
      displayingDependencies: [
        { dependsOn: { conditionType: 'value', name: 'service.type', value: { stringValue: 'NodePort', type: 'string' } }, name: 'service.nodePort' },
        { dependsOn: { conditionType: 'value', name: 'tls', value: { booleanValue: true, type: 'boolean' } }, name: 'service.nodePort' },
        { dependsOn: { conditionType: 'notEmpty', name: 'region' }, name: 'zone' },
      ],
    })
    const nodePort = at(schema, 'service.nodePort')
    expect(isVisible(nodePort, { service: { type: 'NodePort' }, tls: true }, ['service'])).toBe(true)
    expect(isVisible(nodePort, { service: { type: 'NodePort' }, tls: false }, ['service'])).toBe(false)
    expect(isVisible(nodePort, { service: { type: 'ClusterIP' }, tls: true }, ['service'])).toBe(false)
    expect(isVisible(at(schema, 'zone'), { region: '' }, [])).toBe(false)
    expect(isVisible(at(schema, 'zone'), { region: 'eu' }, [])).toBe(true)
  })

  it('reads every typed value the previous frontend had', () => {
    const rule = (value: Record<string, unknown>) => (applyFieldConfig(SCHEMA, {
      displayingDependencies: [{ dependsOn: { conditionType: 'value', name: 'region', value }, name: 'zone' }],
    }) as JSONSchema4).properties?.zone?.[VISIBLE_WHEN_KEY] as unknown
    expect(rule({ integerValue: 3, type: 'integer' })).toEqual({ equals: 3, field: '/region' })
    expect(rule({ arrayValue: ['a'], type: 'array' })).toEqual({ equals: ['a'], field: '/region' })
    expect(rule({ optionValue: { label: 'Europe', value: 'eu' }, type: 'option' })).toEqual({ equals: 'eu', field: '/region' })
    expect(rule({ type: 'null' })).toEqual({ equals: null, field: '/region' })
    // a condition it cannot read leaves the field visible
    expect(rule({ type: 'date' })).toBeUndefined()
  })

  it('titles list rows by objectFields, a dotted displayField included', () => {
    const schema = applyFieldConfig(SCHEMA, { objectFields: [{ displayField: 'subjects.name', path: 'hosts' }] })
    expect(at(schema, 'hosts')?.[ROW_TITLE_KEY]).toBe('subjects.name')
  })

  it('writes suggestions on their field', () => {
    const schema = applyFieldConfig(SCHEMA, { suggestions: [{ name: 'logLevel', options: [{ value: 'info' }, { label: 'Warning', value: 'warn' }] }] })
    expect(at(schema, 'logLevel')?.[SUGGESTIONS_KEY]).toEqual([{ value: 'info' }, { label: 'Warning', value: 'warn' }])
  })

  it('skips an entry that names no field, and leaves the input schema alone', () => {
    const before = JSON.stringify(SCHEMA)
    const schema = applyFieldConfig(SCHEMA, { autocomplete: [{ name: 'nope', resourceRefId: 'r' }, { name: 'region' }, 'bad'] })
    expect(JSON.stringify(schema)).toBe(before)
    expect(JSON.stringify(SCHEMA)).toBe(before)
  })

  it('removes the internal keys an incoming schema carries: only widgetData configures a field', () => {
    const schema = applyFieldConfig({ properties: { region: { [OPTIONS_KEY]: { ref: 'regions' }, [VISIBLE_WHEN_KEY]: { field: 'x', notEmpty: true }, type: 'string' } }, type: 'object' }, {})
    expect(schema?.properties?.region).toEqual({ type: 'string' })
  })

  it('removes an incoming fieldHelp or fieldChecks key too', () => {
    const schema = applyFieldConfig({ properties: { region: { [CHECK_KEY]: { path: '/x' }, [HELP_KEY]: 'smuggled', type: 'string' } }, type: 'object' }, {})
    expect(schema?.properties?.region).toEqual({ type: 'string' })
  })

  it('writes fieldHelp on a leaf, and skips a group or a list', () => {
    const schema = applyFieldConfig(SCHEMA, { fieldHelp: [{ name: 'owner', text: 'Who owns it.' }, { name: 'service', text: 'no' }, { name: 'hosts', text: 'no' }, { name: 'owner', text: '  ' }] })
    expect(schema?.properties?.owner?.[HELP_KEY]).toBe('Who owns it.')
    expect(schema?.properties?.service?.[HELP_KEY]).toBeUndefined()
    expect(schema?.properties?.hosts?.[HELP_KEY]).toBeUndefined()
  })

  it('writes fieldChecks on a text-like leaf, with the body key defaulting to the last segment', () => {
    const answers = [{ message: 'ok', validateStatus: 'success', when: { status: [200] } }]
    const schema = applyFieldConfig(SCHEMA, {
      fieldChecks: [
        { answers, bodyExtras: { token: 't' }, name: 'service.type', path: '/intake/checks', timeoutMs: 5000 },
        { name: 'tls', path: '/intake/checks' },
        { name: 'hosts', path: '/intake/checks' },
        { name: 'owner' },
      ],
    })
    expect(nodeAt(schema as JSONSchema4, ['service', 'type'])?.[CHECK_KEY]).toEqual({ answers, bodyExtras: { token: 't' }, bodyKey: 'type', path: '/intake/checks', timeoutMs: 5000 })
    expect(schema?.properties?.tls?.[CHECK_KEY]).toBeUndefined()
    expect(schema?.properties?.hosts?.[CHECK_KEY]).toBeUndefined()
    expect(schema?.properties?.owner?.[CHECK_KEY]).toBeUndefined()
  })
})
