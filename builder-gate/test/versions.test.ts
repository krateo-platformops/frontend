/**
 * The pins that make the gate's verdicts the portal's and snowplow's own.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { ROOT } from './helpers'

const read = (...path: string[]): string => readFileSync(join(ROOT, ...path), 'utf8')

describe('pins', () => {
  it('ajv is the version the portal resolves (ui/package-lock.json), so the lint compiles schemas identically', () => {
    const portal = JSON.parse(read('..', 'ui', 'package-lock.json')).packages['node_modules/ajv'].version
    const gate = JSON.parse(read('package.json')).dependencies.ajv
    expect(gate).toBe(portal)
  })

  it('jqcheck builds against the gojq fork snowplow replaces gojq with', () => {
    expect(read('jqcheck', 'go.mod')).toMatch(/^replace github\.com\/itchyny\/gojq => github\.com\/krateo-platformops\/gojq v0\.13\.0$/m)
  })

  it('SNOWPLOW_REF names one snowplow tag; its modules are what jqcheck embeds (CI diffs them against that tag)', () => {
    expect(read('SNOWPLOW_REF').trim()).toMatch(/^\d+\.\d+\.\d+$/)
  })
})
