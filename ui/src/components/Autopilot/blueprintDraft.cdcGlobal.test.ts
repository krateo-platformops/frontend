/**
 * [CDC-GLOBAL], the declared half: a `global` the schema DOES declare must be able to take the
 * object composition-dynamic-controller writes there on every render. A string, number, boolean or
 * enum field of that name — which the form editor refuses to add, and a hand or an agent can still
 * write — passes Preview (`helm template` sends no globals) and then fails Helm's schema check for
 * every composition of the published chart, open root or closed. (The closed root that does not
 * declare `global` at all is blueprintDraft.test.ts's `[CDC-GLOBAL]` block.)
 */
import { describe, expect, it } from 'vitest'

import { lintValuesSchemaRoot } from './blueprintDraft'

/** The ten keys CDC's InjectGlobalValues writes — generatedValuesSchemas.test.ts sends the same. */
const CDC_KEYS = [
  'compositionApiVersion', 'compositionGroup', 'compositionId', 'compositionInstalledVersion', 'compositionKind',
  'compositionName', 'compositionNamespace', 'compositionResource', 'gracefullyPaused', 'krateoNamespace',
]

const open = { properties: { size: { type: 'string' } }, type: 'object' }
const closed = { ...open, additionalProperties: false }
const lint = (root: typeof open, global: unknown): string =>
  lintValuesSchemaRoot(JSON.stringify({ ...root, properties: { ...root.properties, global } })).join('\n')

describe('[CDC-GLOBAL] a declared global must take CDC\'s object', () => {
  it('REFUSES a global declared as anything else — with an open root and with a closed one', () => {
    for (const root of [open, closed]) {
      for (const global of [{ type: 'string' }, { type: 'number' }, { type: 'boolean' }, { enum: ['a'], type: 'string' }, { type: ['string', 'null'] }, false]) {
        const problems = lint(root, global)
        const why = JSON.stringify({ global, root })
        expect(problems, why).toContain('[CDC-GLOBAL] values.schema.json: properties.global ')
        expect(problems, why).toContain('composition-dynamic-controller adds a top-level global object to the values of every render')
      }
    }
    expect(lint(open, { type: 'string' })).toContain('properties.global is declared as "string", not an object')
    // The way out named fits the root: with a closed one, removing global would need the root opened.
    expect(lint(open, { type: 'string' })).toMatch(/declare it as an open object, \{ "type": "object" \}, or remove it\.$/)
    expect(lint(closed, { type: 'string' })).toMatch(/or remove it and open the root\.$/)
  })

  it('REFUSES an object closed without CDC\'s keys, and names the ones it leaves out', () => {
    const closedGlobal = { additionalProperties: false, properties: { compositionName: { type: 'string' } }, type: 'object' }
    expect(lint(open, closedGlobal)).toContain('properties.global sets "additionalProperties": false without declaring compositionApiVersion, compositionGroup, compositionId,')
    expect(lint(open, closedGlobal)).not.toContain('compositionName,')
  })

  it('accepts a global that takes it: an open object, no type, a type list with object, or closed over all ten keys', () => {
    const allKeys = { additionalProperties: false, properties: Object.fromEntries(CDC_KEYS.map((key) => [key, { type: 'string' }])), type: 'object' }
    for (const root of [open, closed]) {
      for (const global of [{ type: 'object' }, {}, true, { type: ['object', 'null'] }, allKeys]) {
        expect(lint(root, global), JSON.stringify({ global, root })).toBe('')
      }
    }
  })
})
