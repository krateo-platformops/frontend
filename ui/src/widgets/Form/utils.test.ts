import type { JSONSchema4 } from 'json-schema'
import { describe, expect, it } from 'vitest'

import { getDefaultsFromSchema, getOptionsFromEnum, narrowAgentDraft } from './utils'

describe('getDefaultsFromSchema', () => {
  it('collects scalar defaults and omits properties without one', () => {
    const schema: JSONSchema4 = {
      properties: {
        enabled: { default: false, type: 'boolean' },
        name: { type: 'string' },
        replicas: { default: 3, type: 'integer' },
      },
      type: 'object',
    }
    expect(getDefaultsFromSchema(schema)).toEqual({ enabled: false, replicas: 3 })
  })

  it('recurses into nested objects', () => {
    const schema: JSONSchema4 = {
      properties: {
        storage: {
          properties: {
            size: { default: 100, type: 'integer' },
            tier: { default: 'standard', type: 'string' },
          },
          type: 'object',
        },
      },
      type: 'object',
    }
    expect(getDefaultsFromSchema(schema)).toEqual({ storage: { size: 100, tier: 'standard' } })
  })

  it('returns an empty object for a schema without properties', () => {
    expect(getDefaultsFromSchema({ type: 'object' })).toEqual({})
  })

  it('omits a property-less object (free-form map) with no default', () => {
    const schema: JSONSchema4 = {
      properties: {
        name: { type: 'string' },
        // x-kubernetes-preserve-unknown-fields map → no `properties`, no `default`
        tags: { type: 'object' },
        ttl: { default: 30, type: 'integer' },
      },
      type: 'object',
    }
    // `tags` must NOT become `{}` (which a text input renders as "[object Object]")
    expect(getDefaultsFromSchema(schema)).toEqual({ ttl: 30 })
  })

  it('keeps a default on a property-less object map', () => {
    const schema: JSONSchema4 = {
      properties: { labels: { default: { env: 'prod' }, type: 'object' } },
      type: 'object',
    }
    expect(getDefaultsFromSchema(schema)).toEqual({ labels: { env: 'prod' } })
  })
})

describe('getOptionsFromEnum', () => {
  it('maps string/number enum values to antd options', () => {
    expect(getOptionsFromEnum(['dev', 'prod', 5])).toEqual([
      { label: 'dev', value: 'dev' },
      { label: 'prod', value: 'prod' },
      { label: '5', value: 5 },
    ])
  })

  it('drops non-scalar enum values', () => {
    expect(getOptionsFromEnum(['ok', true, null, { a: 1 }] as never)).toEqual([{ label: 'ok', value: 'ok' }])
  })

  it('returns undefined when there is no enum', () => {
    expect(getOptionsFromEnum(undefined)).toBeUndefined()
  })
})

describe('narrowAgentDraft — what the agent may fill', () => {
  const schema = { name: {}, replicas: {}, token: {} }

  it('keeps fields that are real and visible', () => {
    expect(narrowAgentDraft({ name: 'db', replicas: 3 }, schema, [])).toEqual({ name: 'db', replicas: 3 })
  })

  it('drops a field the form HIDES — the human never sees it, so cannot review it', () => {
    // The safety property. propertiesToHide removes the field from the rendered form, so a value
    // written there would be approved on submit without ever having been shown.
    expect(narrowAgentDraft({ name: 'db', token: 'secret' }, schema, ['token'])).toEqual({ name: 'db' })
  })

  it('drops a hidden field even when no schema is available', () => {
    // Hiding is declared on the widget, not derived from the schema, so it must hold either way.
    expect(narrowAgentDraft({ name: 'db', token: 'secret' }, undefined, ['token'])).toEqual({ name: 'db' })
  })

  it('drops an invented field so a draft cannot land nowhere', () => {
    expect(narrowAgentDraft({ name: 'db', nmae: 'typo' }, schema, [])).toEqual({ name: 'db' })
  })

  it('passes everything through when there is no schema and nothing is hidden', () => {
    expect(narrowAgentDraft({ anything: 1 }, undefined, undefined)).toEqual({ anything: 1 })
  })

  it('returns undefined for no draft, so the form keeps its own initial values', () => {
    expect(narrowAgentDraft(null, schema, [])).toBeUndefined()
    expect(narrowAgentDraft(undefined, schema, [])).toBeUndefined()
  })
})
