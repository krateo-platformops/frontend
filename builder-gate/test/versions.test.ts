/**
 * The pins that make the gate's verdicts the portal's and snowplow's own.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import yaml from 'js-yaml'
import { describe, expect, it } from 'vitest'

import { GATE_TIMEOUT_MS } from '../src/gate'

import { replaceOf } from './goMod'
import { ROOT } from './helpers'

const read = (...path: string[]): string => readFileSync(join(ROOT, ...path), 'utf8')

describe('pins', () => {
  it('ajv is the version the portal resolves (ui/package-lock.json), so the lint compiles schemas identically', () => {
    // JSON.parse returns `any`; name the shape so a changed lockfile layout is a type error
    // here rather than an `undefined` that silently makes the assertion compare nothing.
    const lock = JSON.parse(read('..', 'ui', 'package-lock.json')) as { packages: Record<string, { version: string }> }
    const manifest = JSON.parse(read('package.json')) as { dependencies: Record<string, string> }
    const portal = lock.packages['node_modules/ajv'].version
    const gate = manifest.dependencies.ajv
    expect(gate).toBe(portal)
  })

  // Shape only: the fork and its VERSION are snowplow's to decide, so test/drift/gojqFork.test.ts
  // reads them from snowplow's go.mod at SNOWPLOW_REF rather than this file writing one down.
  it('jqcheck replaces gojq with a fork (which one: the drift check, against snowplow\'s go.mod)', () => {
    expect(replaceOf(read('jqcheck', 'go.mod'), 'github.com/itchyny/gojq', 'jqcheck/go.mod').to).not.toBe('github.com/itchyny/gojq')
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
