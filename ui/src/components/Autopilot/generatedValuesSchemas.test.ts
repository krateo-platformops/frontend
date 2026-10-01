/**
 * Every values.schema.json a builder GENERATES must accept the values composition-dynamic-controller
 * renders with.
 *
 * A generated chart is registered through a CompositionDefinition, and CDC then renders each
 * composition with the composition's spec PLUS a top-level `global` block it adds itself (plumbing
 * `helm/utils/values.go`, InjectGlobalValues). Helm validates those values against the chart's
 * values.schema.json before rendering. A root closed with `additionalProperties: false` that does
 * not declare `global` therefore refuses every composition of the chart, and nothing on the way
 * there says so: the preview, the publish, the merge, the release and Register are all green.
 *
 * The blueprint lint refuses that shape in an AUTHORED schema ([CDC-GLOBAL], lintValuesSchemaRoot).
 * A page set's and a controller's schema are generated instead, and the lint is not run on them,
 * because a refusal would name a file nobody wrote. So this suite runs the same check on the
 * generators, and validates what CDC actually sends, so a generator and the lint cannot drift apart.
 */
import Ajv from 'ajv'
import { describe, expect, it } from 'vitest'

import { lintValuesSchemaRoot } from './blueprintDraft'
import { kogValuesSchema } from './kogChart'
import { pageValuesSchema } from './pageDraft'

/** The block CDC sets at `.global` on every render — the ten keys InjectGlobalValues writes. */
const CDC_GLOBAL = {
  compositionApiVersion: 'composition.krateo.io/v0-1-0',
  compositionGroup: 'composition.krateo.io',
  compositionId: '6f1c2a4e-0b7d-4e8a-9d31-2c5f0e7a9b10',
  compositionInstalledVersion: 'v0-1-0',
  compositionKind: 'ChainPages',
  compositionName: 'chain-pages',
  compositionNamespace: 'team-a',
  compositionResource: 'chainpages',
  gracefullyPaused: 'false',
  krateoNamespace: 'krateo-system',
}

interface GeneratedSchema {
  global?: { additionalProperties?: unknown; type?: unknown }
}

const GENERATED: [label: string, schemaText: string, spec: Record<string, unknown>][] = [
  ['a page set (pageValuesSchema)', pageValuesSchema('chain-pages'), { tiers: { common: '' } }],
  ['a controller (kogValuesSchema)', kogValuesSchema('githubrepo'), {}],
]

describe.each(GENERATED)('%s — the values composition-dynamic-controller renders with', (_label, schemaText, spec) => {
  const schema = JSON.parse(schemaText) as { properties: GeneratedSchema }
  const validate = new Ajv({ allErrors: true, strict: false }).compile(schema)
  const errorsOf = (values: Record<string, unknown>): string => (validate(values) ? '' : JSON.stringify(validate.errors))

  it('passes the blueprint lint\'s [CDC-GLOBAL] check', () => {
    expect(lintValuesSchemaRoot(schemaText)).toEqual([])
  })

  it('accepts a composition\'s spec together with the global block CDC adds', () => {
    expect(errorsOf({ ...spec, global: CDC_GLOBAL })).toBe('')
  })

  it('keeps the root closed — any other undeclared key is still refused', () => {
    // Declaring global is the fix; opening the root would be a different fix that also admits typos
    // in a deployer's values, which the closed root exists to catch.
    expect(validate({ ...spec, global: CDC_GLOBAL, stray: 'x' })).toBe(false)
  })
})

describe('a page set leaves global OPEN — the controller, not the chart, decides which keys it carries', () => {
  const schema = JSON.parse(pageValuesSchema('chain-pages')) as { properties: GeneratedSchema }
  const validate = new Ajv({ allErrors: true, strict: false }).compile(schema)

  it('takes a key a later CDC adds', () => {
    expect(schema.properties.global?.type).toBe('object')
    expect(schema.properties.global?.additionalProperties).toBeUndefined()
    expect(validate({ global: { ...CDC_GLOBAL, keyAddedByALaterController: 'x' }, tiers: { common: '' } })).toBe(true)
  })
})

describe('a controller CLOSES global — core-provider\'s crdgen would otherwise emit x-kubernetes-preserve-unknown-fields on spec.global', () => {
  const schema = JSON.parse(kogValuesSchema('githubrepo')) as { properties: { global: { additionalProperties?: unknown; properties?: Record<string, { type?: string }> } } }
  const validate = new Ajv({ allErrors: true, strict: false }).compile(schema)

  it('declares exactly the ten keys CDC writes, each a string, and nothing else', () => {
    expect(schema.properties.global.additionalProperties).toBe(false)
    expect(Object.keys(schema.properties.global.properties ?? {}).sort()).toEqual(Object.keys(CDC_GLOBAL).sort())
    expect(Object.values(schema.properties.global.properties ?? {}).every((property) => property.type === 'string')).toBe(true)
  })

  it('refuses a key CDC does not write — which is why a key a later CDC adds must be added here', () => {
    expect(validate({ global: { ...CDC_GLOBAL, keyAddedByALaterController: 'x' } })).toBe(false)
  })

  it('declares no default anywhere', () => {
    expect(kogValuesSchema('githubrepo')).not.toMatch(/"default"/)
  })
})
