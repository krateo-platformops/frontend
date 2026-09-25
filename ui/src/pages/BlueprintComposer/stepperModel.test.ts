import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { ARCHITECTURE_API_VERSION, deriveStates, type ChartArchitecture } from './architecture'
import { extractArchitecture } from './gateExtract'
import { INITIAL_STATE_NAME, MISSING_READINESS, READINESS_DEFAULTS, stepperModel, type DerivedMachine } from './stepperModel'

const machine = (arch: ChartArchitecture): DerivedMachine => {
  const derived = deriveStates(arch)
  if (!derived.ok) { throw new Error(`unexpected cycle ${derived.cycle.join(' → ')}`) }
  return derived
}

const builderPublish = (): ChartArchitecture => {
  const dir = join(__dirname, '__fixtures__', 'builder-publish', 'templates')
  const templates = Object.fromEntries(readdirSync(dir).map((file) => [`templates/${file}`, readFileSync(join(dir, file), 'utf8')]))
  return extractArchitecture('builder-publish', templates).architecture
}

const empty = (resources: ChartArchitecture['resources'] = []): ChartArchitecture =>
  ({ apiVersion: ARCHITECTURE_API_VERSION, chart: 'fresh', kind: 'ChartArchitecture', resources })

describe('stepperModel — builder-publish, the documented machine', () => {
  const arch = builderPublish()
  const derived = machine(arch)

  it('S1: the Repository alone; leaving needs its default branch', () => {
    const model = stepperModel(arch, derived, 0)
    expect(model).toEqual({
      frontier: ['repository'],
      initial: false,
      label: 'S1',
      leavesWhen: [{ from: 'repository', predicate: '.status.default_branch', source: 'readyWhen', to: 'repo', when: '.Values.repository.create' }],
      level: 0,
      lit: ['repository'],
      name: null,
      orthogonal: ['username-secret'],
      total: 4,
      withheld: ['localresources', 'pullrequest', 'repo'],
    })
  })

  it('S2 → S3: every ready edge into the next level, including one from two levels back', () => {
    const model = stepperModel(arch, derived, 1)
    expect(model.frontier).toEqual(['repo'])
    expect(model.leavesWhen).toEqual([
      { from: 'repository', predicate: '.status.default_branch', source: 'readyWhen', to: 'localresources', when: '.Values.repository.create' },
      { from: 'repo', predicate: '.status.targetCommitId', source: 'readyWhen', to: 'localresources', when: '.Values.source.url' },
    ])
  })

  it('S3 → S4 waits on EVERY LocalResource (all: true)', () => {
    expect(stepperModel(arch, derived, 2).leavesWhen).toEqual([
      { all: true, from: 'localresources', predicate: '.status.targetCommitId', source: 'readyWhen', to: 'pullrequest' },
    ])
  })

  it('S4 is terminal: everything lit, nothing withheld, no way out', () => {
    const model = stepperModel(arch, derived, 3)
    expect(model.lit).toEqual(['localresources', 'pullrequest', 'repo', 'repository'])
    expect(model.frontier).toEqual(['pullrequest'])
    expect(model.withheld).toEqual([])
    expect(model.leavesWhen).toEqual([])
  })

  it('an out-of-range level is clamped, and a named state keeps its name', () => {
    const named = { ...arch, states: [{ name: 'repository-only' }, { name: 'seeding' }] }
    expect(stepperModel(named, derived, 99)).toMatchObject({ label: 'S4', level: 3, name: null })
    expect(stepperModel(named, derived, -2)).toMatchObject({ label: 'S1', level: 0, name: 'repository-only' })
    expect(stepperModel(named, derived, Number.NaN).level).toBe(0)
  })
})

describe('stepperModel — the class default when readyWhen is omitted', () => {
  it('native → kstatus, composition → Ready/Synced, custom → a prompt to declare one', () => {
    const arch = empty([
      { apiVersion: 'apps/v1', class: 'native', id: 'deploy', kind: 'Deployment', template: 't/deploy.yaml' },
      { apiVersion: 'composition.krateo.io/v0-1-0', class: 'composition', id: 'db', kind: 'Postgres', template: 't/db.yaml' },
      { apiVersion: 'g/v1', class: 'custom', id: 'bucket', kind: 'Bucket', template: 't/bucket.yaml' },
      {
        apiVersion: 'v1',
        class: 'native',
        dependsOn: [{ ready: true, ref: 'deploy' }, { ready: true, ref: 'db' }, { ready: true, ref: 'bucket' }, { ref: 'deploy' }],
        id: 'svc',
        kind: 'Service',
        template: 't/svc.yaml',
      },
    ])
    expect(stepperModel(arch, machine(arch), 0).leavesWhen).toEqual([
      { from: 'deploy', predicate: READINESS_DEFAULTS.native, source: 'default', to: 'svc' },
      { from: 'db', predicate: READINESS_DEFAULTS.composition, source: 'default', to: 'svc' },
      { from: 'bucket', predicate: MISSING_READINESS, source: 'missing', to: 'svc' },
    ])
  })
})

describe('stepperModel — the zero-state', () => {
  it('a fresh chart (resources: []) derives no states; the model is one explicit initial state', () => {
    const arch = empty()
    const derived = machine(arch)
    expect(derived.states).toEqual([])
    expect(stepperModel(arch, derived, 0)).toEqual({
      frontier: [],
      initial: true,
      label: 'S1',
      leavesWhen: [],
      level: 0,
      lit: [],
      name: INITIAL_STATE_NAME,
      orthogonal: [],
      total: 1,
      withheld: [],
    })
  })

  it('a chart of shims only is the same initial state, with the shims orthogonal', () => {
    const arch = empty([{ apiVersion: 'v1', class: 'native', id: 'legacy', kind: 'Secret', lifecycle: 'shim', template: 't/legacy.yaml' }])
    expect(stepperModel(arch, machine(arch), 3)).toMatchObject({ initial: true, label: 'S1', lit: [], orthogonal: ['legacy'], total: 1 })
  })
})
