/**
 * Conditions (screens 8b/8c) on builder-publish's REAL descriptor — the chart the mockup draws —
 * whose three `when` paths (repository.create, source.url, pullRequest.create) each select a
 * different machine. The variants' states come from the one kernel, deriveStates.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { deriveStates, parseArchitecture, type ChartArchitecture } from './architecture'
import { applyConditions, conditionsOf, defaultPositions, variantLabel } from './conditions'

const builderPublish = (): ChartArchitecture => {
  const parsed = parseArchitecture(readFileSync(join(__dirname, '__fixtures__', 'builder-publish', 'expected.architecture.yaml'), 'utf8'))
  if (!parsed.ok) { throw new Error(JSON.stringify(parsed.problems)) }
  return parsed.architecture
}
const VALUES = 'repository:\n  create: true\nsource:\n  url: ""\npullRequest:\n  create: true\n'
const stateCount = (arch: ChartArchitecture): number => {
  const derived = deriveStates(arch)
  if (!derived.ok) { throw new Error('cycle') }
  return derived.states.length
}

describe('conditionsOf', () => {
  it('lists every distinct when path once, in descriptor order, with the nodes it guards', () => {
    const conditions = conditionsOf(builderPublish(), VALUES)
    expect(conditions.map((condition) => condition.path)).toEqual(['.Values.repository.create', '.Values.source.url', '.Values.pullRequest.create'])
    expect(conditions.find((condition) => condition.path === '.Values.source.url')?.nodes).toEqual(['repo'])
  })

  it('starts each at values.yaml — Helm truthiness when it is set, ON when it is not there at all', () => {
    const byPath = Object.fromEntries(conditionsOf(builderPublish(), VALUES).map((condition) => [condition.path, condition]))
    expect(byPath['.Values.repository.create']).toMatchObject({ byDefault: true, inValues: true })
    expect(byPath['.Values.source.url']).toMatchObject({ byDefault: false, inValues: true })
    const unset = Object.fromEntries(conditionsOf(builderPublish(), 'other: 1\n').map((condition) => [condition.path, condition]))
    expect(unset['.Values.source.url']).toMatchObject({ byDefault: true, inValues: false })
    // An unreadable values.yaml is the lint's to report; every condition then starts ON.
    expect(conditionsOf(builderPublish(), ': not yaml: [').every((condition) => condition.byDefault)).toBe(true)
  })

  it('has none for a chart without when', () => {
    const arch = builderPublish()
    const plain = { ...arch, resources: arch.resources.map(({ when: _w, ...node }) => ({ ...node, dependsOn: node.dependsOn?.map(({ when: _dw, ...dep }) => dep) })) }
    expect(conditionsOf(plain, VALUES)).toEqual([])
  })
})

describe('applyConditions — the variant a set of switches selects', () => {
  it('source.url set: the seed Repo is in the machine — four states', () => {
    const arch = builderPublish()
    const all = defaultPositions(conditionsOf(arch, VALUES.replace('url: ""', 'url: https://github.com/x/y')))
    const variant = applyConditions(arch, all)
    expect(variant.absent).toEqual([])
    expect(variant.architecture).toBe(arch)
    expect(stateCount(variant.architecture)).toBe(4)
  })

  it('source.url empty (the default here): repo is absent, the edges into it drop, and the states renumber to three', () => {
    const arch = builderPublish()
    const positions = defaultPositions(conditionsOf(arch, VALUES))
    const variant = applyConditions(arch, positions)
    expect(variant.absent).toEqual(['repo'])
    expect(variant.architecture.resources.map((node) => node.id)).not.toContain('repo')
    const localresources = variant.architecture.resources.find((node) => node.id === 'localresources')
    expect(localresources?.dependsOn?.map((dep) => dep.ref)).toEqual(['repository'])
    expect(stateCount(variant.architecture)).toBe(3)
    expect(variantLabel(conditionsOf(arch, VALUES), positions)).toBe('repository.create set · source.url empty · pullRequest.create set')
  })

  it('an unknown switch never removes anything: a path it does not name is ON', () => {
    const arch = builderPublish()
    expect(applyConditions(arch, {}).absent).toEqual([])
    expect(applyConditions(arch, { '.Values.nothing': false }).architecture).toBe(arch)
  })

  it('switching the repository off takes out what it guards, and every edge onto it', () => {
    const arch = builderPublish()
    const variant = applyConditions(arch, { '.Values.repository.create': false })
    expect(variant.absent).toEqual(['repository'])
    for (const node of variant.architecture.resources) {
      expect((node.dependsOn ?? []).some((dep) => dep.ref === 'repository')).toBe(false)
    }
  })
})
