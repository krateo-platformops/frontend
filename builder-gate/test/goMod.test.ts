/**
 * The go.mod reader behind the gojq-fork drift check (test/drift/gojqFork.test.ts), offline.
 */
import { describe, expect, it } from 'vitest'

import { describeReplace, replaceOf, replacesOf } from './goMod'

describe('go.mod replace directives', () => {
  it('reads the single-line form, with a trailing comment', () => {
    const goMod = 'module m\n\nrequire github.com/itchyny/gojq v0.12.17\n\nreplace github.com/itchyny/gojq => github.com/krateo-platformops/gojq v0.13.0 // the fork\n'
    expect(replacesOf(goMod)).toEqual([{ from: 'github.com/itchyny/gojq', fromVersion: '', to: 'github.com/krateo-platformops/gojq', toVersion: 'v0.13.0' }])
  })

  it('reads a block, a version-limited left side and a local directory', () => {
    const goMod = 'module m\n\nreplace (\n\t// a comment line\n\tgithub.com/a/b v1.2.3 => github.com/c/d v1.2.4\n\tgithub.com/e/f => ../f\n)\n'
    expect(replacesOf(goMod).map(describeReplace)).toEqual(['github.com/a/b v1.2.3 => github.com/c/d v1.2.4', 'github.com/e/f => ../f'])
  })

  it('a directive it does not understand throws', () => {
    expect(() => replacesOf('replace github.com/a/b github.com/c/d v1\n')).toThrow(/does not understand/)
  })

  it('an unterminated block throws', () => {
    expect(() => replacesOf('replace (\n\tgithub.com/a/b => github.com/c/d v1\n')).toThrow(/unterminated/)
  })

  it('replaceOf wants exactly one', () => {
    expect(() => replaceOf('module m\n', 'github.com/itchyny/gojq', 'x/go.mod')).toThrow(/x\/go.mod: expected one replace of github.com\/itchyny\/gojq, found 0/)
    const two = 'replace github.com/itchyny/gojq => github.com/a/gojq v1\nreplace github.com/itchyny/gojq v0.1.0 => github.com/b/gojq v2\n'
    expect(() => replaceOf(two, 'github.com/itchyny/gojq', 'x/go.mod')).toThrow(/found 2/)
  })
})
