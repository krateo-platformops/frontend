import { describe, expect, it } from 'vitest'

import { containmentFor, GENERAL_LAYOUTS, HOLDS_NOTHING, NOT_A_CHILD, PURPOSE_BUILT } from './containment'

const VOCABULARY = ['buttons', 'cards', 'flexes', 'layouts', 'qrcodes', 'themes']

describe('containmentFor', () => {
  it('gives a general layout every plural except what is never a child', () => {
    expect(containmentFor('Flex', VOCABULARY)).toEqual(['buttons', 'cards', 'flexes', 'qrcodes'])
  })

  it('takes a new widget into the general lists by its existing', () => {
    expect(containmentFor('Row', [...VOCABULARY, 'brandnews'])).toContain('brandnews')
  })

  it('refuses a container with no role, rather than guessing a list that could refuse real pages', () => {
    expect(() => containmentFor('Brandnew', VOCABULARY)).toThrow(/no role/)
  })

  it('refuses a purpose-built list naming what no CRD declares', () => {
    expect(() => containmentFor('ButtonGroup', ['cards'])).toThrow(/buttons/)
  })
})

describe('the table', () => {
  it('gives a kind one role only', () => {
    const named = [...GENERAL_LAYOUTS, ...HOLDS_NOTHING, ...Object.keys(PURPOSE_BUILT)]
    expect(new Set(named).size).toBe(named.length)
  })

  it('never lets a purpose-built kind hold what is never a child', () => {
    Object.values(PURPOSE_BUILT).forEach((list) => {
      expect(list.filter((plural) => NOT_A_CHILD.includes(plural))).toEqual([])
    })
  })
})
