/**
 * FE-B1 + FE-B2 pure-logic coverage for blueprintDraft.ts:
 *   - the crdgen-defaults lint matrix (non-empty object/array defaults = the
 *     krateo-platformops/core-provider#46 class → HARD ERROR; scalar/absent/empty
 *     defaults pass; a property literally NAMED "default" is not a false positive),
 *     including the exact #46 ingress.hosts shape as a fixture;
 *   - the 512 KiB rawTemplates size cap (same discipline as the OAS attachment);
 *   - the inline-args guard (parseRawTemplates) and the form-preview builders
 *     (verbatim-string preference, name/namespace splice, hidden-title collection).
 */
import { describe, expect, it } from 'vitest'

import {
  buildFormPreviewModel,
  buildFormSchemaText,
  draftDisplayName,
  lintBlueprintDraft,
  lintValuesSchemaDefaults,
  parseRawTemplates,
  RAW_TEMPLATES_MAX_BYTES,
  rawTemplatesByteSize,
  stripCodeFence,
} from './blueprintDraft'

describe('stripCodeFence — de-fence a model-wrapped file body', () => {
  const json = '{ "title": "AWS VPC", "type": "object" }'
  it('strips a python-style triple-quote wrapper (the observed values.schema.json failure)', () => {
    expect(stripCodeFence(`'''${json}'''`)).toBe(json)
    expect(stripCodeFence(`"""${json}"""`)).toBe(json)
  })
  it('strips a markdown fence, including an opening language tag', () => {
    expect(stripCodeFence(`\`\`\`json\n${json}\n\`\`\``)).toBe(json)
    expect(stripCodeFence(`\`\`\`\n${json}\n\`\`\``)).toBe(json)
  })
  it('leaves genuine content untouched (no wrapper)', () => {
    expect(stripCodeFence(json)).toBe(json)
    expect(stripCodeFence('replicaCount: 1\nimage:\n  tag: latest')).toBe('replicaCount: 1\nimage:\n  tag: latest')
  })
  it('parseRawTemplates de-fences every file body so the schema then parses', () => {
    const cleaned = parseRawTemplates({ 'Chart.yaml': '```yaml\nname: x\n```', 'values.schema.json': `'''${json}'''` })
    expect(cleaned).not.toBeNull()
    expect(cleaned!['values.schema.json']).toBe(json)
    expect(cleaned!['Chart.yaml']).toBe('name: x')
    expect(() => { JSON.parse(cleaned!['values.schema.json']) }).not.toThrow()
  })
})

/** The EXACT krateo-platformops/core-provider#46 class: a helm-scaffold ingress.hosts
 * array default in values.schema.json → malformed +kubebuilder:default marker →
 * controller-gen parse failure → the CompositionDefinition wedges Ready=False. */
const ISSUE_46_INGRESS_HOSTS_SCHEMA = JSON.stringify({
  properties: {
    ingress: {
      properties: {
        enabled: { default: false, type: 'boolean' },
        hosts: {
          default: [
            { host: 'chart-example.local', paths: [{ path: '/', pathType: 'ImplementationSpecific' }] },
          ],
          items: { type: 'object' },
          type: 'array',
        },
      },
      type: 'object',
    },
  },
  type: 'object',
})

describe('lintValuesSchemaDefaults — the FE-B2 crdgen-defaults matrix', () => {
  it('flags a non-empty OBJECT default as a hard error', () => {
    const schema = JSON.stringify({
      properties: { resources: { default: { limits: { cpu: '100m' } }, type: 'object' } },
      type: 'object',
    })
    const problems = lintValuesSchemaDefaults(schema)
    expect(problems).toHaveLength(1)
    expect(problems[0]).toContain('[CRDGEN-DEFAULTS]')
    expect(problems[0]).toContain('properties.resources.default')
    expect(problems[0]).toContain('object default')
    expect(problems[0]).toContain('krateo-core-provider#46')
  })

  it('flags a non-empty ARRAY default as a hard error', () => {
    const schema = JSON.stringify({
      properties: { tolerations: { default: [{ key: 'node' }], items: { type: 'object' }, type: 'array' } },
      type: 'object',
    })
    const problems = lintValuesSchemaDefaults(schema)
    expect(problems).toHaveLength(1)
    expect(problems[0]).toContain('array default')
    expect(problems[0]).toContain('properties.tolerations.default')
  })

  it('flags the exact #46 ingress.hosts fixture (and ONLY the hosts default)', () => {
    const problems = lintValuesSchemaDefaults(ISSUE_46_INGRESS_HOSTS_SCHEMA)
    expect(problems).toHaveLength(1)
    expect(problems[0]).toContain('properties.ingress.properties.hosts.default')
    expect(problems[0]).toContain('array default')
  })

  it('flags nested defaults at ANY depth (items / allOf branches)', () => {
    const schema = JSON.stringify({
      allOf: [{ properties: { extra: { default: { on: true }, type: 'object' } } }],
      properties: {
        list: { items: { default: ['a'], type: 'array' }, type: 'array' },
      },
      type: 'object',
    })
    const problems = lintValuesSchemaDefaults(schema)
    expect(problems).toHaveLength(2)
    expect(problems.join('\n')).toContain('allOf[0].properties.extra.default')
    expect(problems.join('\n')).toContain('properties.list.items.default')
  })

  it('passes scalar defaults, absent defaults, and EMPTY object/array defaults', () => {
    const schema = JSON.stringify({
      properties: {
        annotations: { default: {}, type: 'object' },
        args: { default: [], items: { type: 'string' }, type: 'array' },
        enabled: { default: false, type: 'boolean' },
        name: { type: 'string' },
        region: { default: 'eu-west-1', enum: ['eu-west-1', 'us-east-1'], type: 'string' },
        replicas: { default: 2, type: 'integer' },
        tag: { default: null, type: 'string' },
      },
      required: ['name'],
      type: 'object',
    })
    expect(lintValuesSchemaDefaults(schema)).toEqual([])
  })

  it('does NOT mistake a property literally named "default" for the keyword', () => {
    const schema = JSON.stringify({
      properties: {
        default: { properties: { size: { type: 'string' } }, type: 'object' },
      },
      type: 'object',
    })
    expect(lintValuesSchemaDefaults(schema)).toEqual([])
  })

  it('does not walk INTO enum/const/examples values (data, not schema)', () => {
    const schema = JSON.stringify({
      properties: {
        preset: { enum: [{ default: ['not-a-keyword'] }], type: 'object' },
      },
      type: 'object',
    })
    expect(lintValuesSchemaDefaults(schema)).toEqual([])
  })

  it('invalid JSON is itself a hard error (never a crash)', () => {
    const problems = lintValuesSchemaDefaults('{ not json')
    expect(problems).toHaveLength(1)
    expect(problems[0]).toContain('values.schema.json is not valid JSON')
  })
})

describe('lintBlueprintDraft — size cap + schema gate', () => {
  const cleanDraft = {
    'Chart.yaml': 'apiVersion: v2\nname: pg-app\nversion: 0.1.0\n',
    'templates/cm.yaml': 'kind: ConfigMap\n',
    'values.schema.json': JSON.stringify({ properties: { size: { default: 'S', type: 'string' } }, type: 'object' }),
    'values.yaml': 'size: S\n',
  }

  it('passes a clean draft (scalar defaults only, under the cap)', () => {
    expect(lintBlueprintDraft(cleanDraft)).toEqual([])
  })

  it('rejects a draft over the 512 KiB cap — the SAME discipline as $oasAttachment', () => {
    const oversized = { ...cleanDraft, 'templates/big.yaml': 'x'.repeat(RAW_TEMPLATES_MAX_BYTES + 1) }
    const problems = lintBlueprintDraft(oversized)
    expect(problems).toHaveLength(1)
    expect(problems[0]).toContain('512 KiB')
  })

  it('surfaces the #46 class through the draft gate', () => {
    const bad = { ...cleanDraft, 'values.schema.json': ISSUE_46_INGRESS_HOSTS_SCHEMA }
    expect(lintBlueprintDraft(bad).join('\n')).toContain('[CRDGEN-DEFAULTS]')
  })

  it('a draft WITHOUT values.schema.json passes the lint (the render decides)', () => {
    const noSchema = { 'Chart.yaml': cleanDraft['Chart.yaml'], 'templates/cm.yaml': 'kind: ConfigMap\n' }
    expect(lintBlueprintDraft(noSchema)).toEqual([])
  })

  it('rawTemplatesByteSize measures UTF-8 bytes of paths + contents', () => {
    expect(rawTemplatesByteSize({ 'a.yaml': 'xy' })).toBe('a.yaml'.length + 2)
    expect(rawTemplatesByteSize({ 'é.yaml': 'é' })).toBe(Buffer.byteLength('é.yaml') + Buffer.byteLength('é'))
  })
})

describe('parseRawTemplates — the inline-args guard', () => {
  it('accepts a non-empty path→string map', () => {
    expect(parseRawTemplates({ 'Chart.yaml': 'name: x' })).toEqual({ 'Chart.yaml': 'name: x' })
  })

  it('denies empty maps, non-objects, blank paths and non-string contents', () => {
    expect(parseRawTemplates({})).toBeNull()
    expect(parseRawTemplates(undefined)).toBeNull()
    expect(parseRawTemplates(null)).toBeNull()
    expect(parseRawTemplates('Chart.yaml')).toBeNull()
    expect(parseRawTemplates([])).toBeNull()
    expect(parseRawTemplates({ ' ': 'content' })).toBeNull()
    expect(parseRawTemplates({ 'Chart.yaml': 42 })).toBeNull()
    expect(parseRawTemplates({ 'Chart.yaml': { name: 'x' } })).toBeNull()
  })
})

describe('draftDisplayName', () => {
  it('reads the chart name from Chart.yaml', () => {
    expect(draftDisplayName({ 'Chart.yaml': 'apiVersion: v2\nname: pg-app\nversion: 0.1.0\n' })).toBe('pg-app')
    expect(draftDisplayName({ 'Chart.yaml': 'name: "quoted-app"\n' })).toBe('quoted-app')
  })

  it('falls back to "draft chart" without a parseable name', () => {
    expect(draftDisplayName({})).toBe('draft chart')
    expect(draftDisplayName({ 'Chart.yaml': 'apiVersion: v2\n' })).toBe('draft chart')
  })
})

describe('buildFormSchemaText — the raw string the form preview mounts', () => {
  const draftSchemaText = '{"type":"object","properties":{"size":{"type":"string"}}}'

  it('prefers the VERBATIM draft file over the response schema (authoring order)', () => {
    const text = buildFormSchemaText({ 'values.schema.json': draftSchemaText }, { properties: {} }, undefined)
    expect(text).toBe(draftSchemaText)
  })

  it('falls back to the response valuesSchema in remote-chart mode', () => {
    const text = buildFormSchemaText(undefined, { properties: { size: { type: 'string' } }, type: 'object' }, undefined)
    expect(text).toBe(JSON.stringify({ properties: { size: { type: 'string' } }, type: 'object' }))
  })

  it('returns undefined on a render error, a schema-less response, or a non-object schema', () => {
    expect(buildFormSchemaText({ 'values.schema.json': draftSchemaText }, undefined, 'template: boom')).toBeUndefined()
    expect(buildFormSchemaText(undefined, undefined, undefined)).toBeUndefined()
    expect(buildFormSchemaText(undefined, 'not-a-schema', undefined)).toBeUndefined()
  })
})

describe('buildFormPreviewModel — the blueprint-formdef splice, client-side', () => {
  it('splices synthetic name + namespace as the FIRST properties, both required', () => {
    const model = buildFormPreviewModel(JSON.stringify({
      properties: { size: { title: 'Size', type: 'string' } },
      required: ['size'],
      type: 'object',
    }))
    expect(model).not.toBeNull()
    expect(Object.keys(model?.schema.properties ?? {})).toEqual(['name', 'namespace', 'size'])
    expect(model?.schema.required).toEqual(['name', 'namespace', 'size'])
  })

  it('collects "(should be hidden)" titles — the formdef hide convention — at any depth', () => {
    const model = buildFormPreviewModel(JSON.stringify({
      properties: {
        debug: { title: 'Debug flag (should be hidden)', type: 'boolean' },
        nested: {
          properties: { internal: { title: 'Internal (Should Be Hidden)', type: 'string' } },
          type: 'object',
        },
        size: { title: 'Size', type: 'string' },
      },
      type: 'object',
    }))
    expect(model?.hidden.sort()).toEqual(['debug', 'internal'])
  })

  it('returns null for unparseable, property-less or non-object schemas (no section)', () => {
    expect(buildFormPreviewModel('{ not json')).toBeNull()
    expect(buildFormPreviewModel(JSON.stringify({ type: 'object' }))).toBeNull()
    expect(buildFormPreviewModel(JSON.stringify({ properties: {}, type: 'object' }))).toBeNull()
    expect(buildFormPreviewModel(JSON.stringify(['not', 'a', 'schema']))).toBeNull()
  })
})
