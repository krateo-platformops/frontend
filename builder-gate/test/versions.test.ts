/**
 * The pins that make the gate's verdicts the portal's and snowplow's own.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import yaml from 'js-yaml'

import { GATE_TIMEOUT_MS } from '../src/gate'
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

  it('the RemoteMCPServer timeout sits above the gate\'s own budget and below 120 s', () => {
    const values = yaml.load(read('..', 'helm', 'builder-gate', 'values.yaml')) as { remoteMCPServer: { timeout: string } }
    const seconds = Number(/^(\d+)s$/.exec(values.remoteMCPServer.timeout)?.[1])
    expect(seconds).toBe(110)
    expect(seconds * 1000).toBeGreaterThan(GATE_TIMEOUT_MS)
    expect(seconds).toBeLessThan(120)
  })
})
