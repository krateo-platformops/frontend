/**
 * The autocomplete tokens `fieldInputs` applies are the ones the CRD offers, and none of them asks a
 * browser for a credential or a card.
 */
import { describe, expect, it } from 'vitest'

import { AUTOCOMPLETE_TOKENS, fieldInputOf, INPUT_TYPES } from './fieldInputs'
import FormSchema from './Form.schema.json'

const entry = FormSchema.properties.spec.properties.widgetData.properties.fieldInputs.items.properties

describe('fieldInputs tokens', () => {
  it('the CRD offers exactly the tokens and types the form applies', () => {
    expect(entry.autoComplete.enum).toEqual([...AUTOCOMPLETE_TOKENS])
    expect(entry.type.enum).toEqual([...INPUT_TYPES])
  })

  it('no credential or payment token', () => {
    expect(AUTOCOMPLETE_TOKENS.filter((token) => /password|one-time-code|webauthn|^cc-|^transaction-/.test(token))).toEqual([])
  })

  it('an entry keeps only what it says validly', () => {
    expect(fieldInputOf({ autoComplete: 'cc-number', name: 'x', placeholder: ' ', type: 'password' })).toBeUndefined()
    expect(fieldInputOf({ autoComplete: 'email', name: 'x', type: 'email' })).toEqual({ autoComplete: 'email', type: 'email' })
  })
})
