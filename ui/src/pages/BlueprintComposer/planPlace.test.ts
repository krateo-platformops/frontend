/**
 * planPlace — a placement is a node AND a file, planned as one batch, or refused in words.
 */
import { describe, expect, it } from 'vitest'

import { extractCrdSpecFields } from '../../components/Autopilot/describeResource'

import { CRDS, golden } from './__fixtures__/s4a'
import {
  ARCHITECTURE_API_VERSION,
  ARCHITECTURE_KIND,
  ARCHITECTURE_TEMPLATE_PATH,
  parseArchitecture,
  regenerateGraphBlock,
  rewrapDescriptor,
  serializeArchitecture,
  unwrapFromConfigMapTemplate,
  wrapAsConfigMapTemplate,
  type ResourceNode,
} from './architecture'
import { graphBlockIn } from './graphCompile'
import { placedNameExpression } from './naming'
import { DESCRIPTOR_REFUSED, NO_DESCRIPTOR, placementCrd, planPlace, type PalettePick } from './planPlace'
import { startChart } from './startChart'

const seeded = (name = 'orders'): Record<string, string> => {
  const started = startChart({ description: '', name, version: '0.1.0' })
  if (!started.ok) { throw new Error('fixture refused') }
  return started.files
}

const repository: PalettePick = { apiVersion: 'github.krateo.io/v2022-11-28', cls: 'custom', group: 'github.krateo.io', kind: 'Repository', plural: 'repositories' }
const builderPublish: PalettePick = { apiVersion: 'composition.krateo.io/v1-8-40', blueprint: 'builder-publish', cls: 'composition', kind: 'BuilderPublish', plural: 'builderpublishes' }
const repositorySpec = extractCrdSpecFields(CRDS['repositories.github.krateo.io'], 'v2022-11-28')
/** The name placing writes into the template's metadata.name — and so into the descriptor's entry. */
const REPOSITORY_NAME = placedNameExpression('repository', false)

const nodesOf = (template: string): ResourceNode[] => {
  const parsed = parseArchitecture(unwrapFromConfigMapTemplate(template) ?? '')
  if (!parsed.ok) { throw new Error(JSON.stringify(parsed.problems)) }
  return parsed.architecture.resources
}

describe('planPlace — the plan', () => {
  it('adds templates/<id>.yaml and appends the node to the descriptor, in one batch that pins what it read', () => {
    const files = seeded()
    const plan = planPlace(files, repository, repositorySpec)
    if (!plan.ok) { throw new Error(plan.reason) }
    expect(plan.id).toBe('repository')
    expect(plan.add).toEqual({ 'templates/repository.yaml': golden('repository') })
    expect(Object.keys(plan.edit)).toEqual([ARCHITECTURE_TEMPLATE_PATH])
    expect(plan.expect).toEqual({ [ARCHITECTURE_TEMPLATE_PATH]: files[ARCHITECTURE_TEMPLATE_PATH] })
    const descriptor = serializeArchitecture({
      apiVersion: ARCHITECTURE_API_VERSION,
      chart: 'orders',
      kind: ARCHITECTURE_KIND,
      resources: [{ apiVersion: 'github.krateo.io/v2022-11-28', class: 'custom', id: 'repository', kind: 'Repository', name: REPOSITORY_NAME, resource: 'repositories', template: 'templates/repository.yaml' }],
    })
    // Only data.architecture is rewritten: the graph block is the store's to regenerate, on this
    // write as on any other — after which the file is exactly a fresh wrap of the new descriptor.
    expect(plan.edit[ARCHITECTURE_TEMPLATE_PATH]).toBe(rewrapDescriptor(files[ARCHITECTURE_TEMPLATE_PATH], descriptor))
    expect(regenerateGraphBlock(plan.edit[ARCHITECTURE_TEMPLATE_PATH], 'orders')).toBe(wrapAsConfigMapTemplate(descriptor, 'orders'))
  })

  it('never writes readyWhen — a suggestion is offered where readiness is picked, not stored', () => {
    const plan = planPlace(seeded(), repository, repositorySpec)
    expect(plan.ok && nodesOf(plan.edit[ARCHITECTURE_TEMPLATE_PATH])[0]).toEqual({
      apiVersion: 'github.krateo.io/v2022-11-28', class: 'custom', id: 'repository', kind: 'Repository', name: REPOSITORY_NAME, resource: 'repositories', template: 'templates/repository.yaml',
    })
  })

  it('a second of the same kind is repository-2 — and a held template the descriptor does not list is not overwritten', () => {
    const files = seeded()
    const first = planPlace(files, repository, repositorySpec)
    if (!first.ok) { throw new Error(first.reason) }
    const after = { ...files, ...first.add, ...first.edit }
    const second = planPlace(after, repository, repositorySpec)
    expect(second.ok && second.id).toBe('repository-2')
    const handWritten = planPlace({ ...files, 'templates/repository.yaml': 'kind: Repository\n' }, repository, repositorySpec)
    expect(handWritten.ok && Object.keys(handWritten.add)).toEqual(['templates/repository-2.yaml'])
  })

  it('a template a node declares is taken even before it is written — no two nodes share one file', () => {
    const descriptor = serializeArchitecture({
      apiVersion: ARCHITECTURE_API_VERSION,
      chart: 'orders',
      kind: ARCHITECTURE_KIND,
      resources: [{ apiVersion: 'apps/v1', class: 'native', id: 'web', kind: 'Deployment', template: 'templates/deployment.yaml' }],
    })
    const files = { ...seeded(), [ARCHITECTURE_TEMPLATE_PATH]: wrapAsConfigMapTemplate(descriptor, 'orders') }
    expect(Object.keys(files)).not.toContain('templates/deployment.yaml')
    const plan = planPlace(files, { apiVersion: 'apps/v1', cls: 'native', kind: 'Deployment', plural: 'deployments' }, null)
    if (!plan.ok) { throw new Error(plan.reason) }
    expect(plan.id).toBe('deployment-2')
    expect(Object.keys(plan.add)).toEqual(['templates/deployment-2.yaml'])
    expect(nodesOf(plan.edit[ARCHITECTURE_TEMPLATE_PATH]).map((node) => node.template)).toEqual(['templates/deployment.yaml', 'templates/deployment-2.yaml'])
  })

  it('REWRAPS the descriptor in the file the chart holds — every byte outside data.architecture is kept', () => {
    const files = seeded()
    const authored = files[ARCHITECTURE_TEMPLATE_PATH]
      .replace('  labels:\n', '  labels:\n    team: platform\n')
      .replace('{{- /*', '# the author\'s own comment\n{{- /*')
      .concat('  notes: |\n    kept as written\n')
    const plan = planPlace({ ...files, [ARCHITECTURE_TEMPLATE_PATH]: authored }, repository, repositorySpec)
    if (!plan.ok) { throw new Error(plan.reason) }
    const next = plan.edit[ARCHITECTURE_TEMPLATE_PATH]
    const [head] = authored.split('  architecture: |\n')
    expect(next.startsWith(`${head}  architecture: |\n`)).toBe(true)
    expect(next.endsWith('  notes: |\n    kept as written\n')).toBe(true)
    expect(nodesOf(next).map((node) => node.id)).toEqual(['repository'])
  })

  it('rewrapDescriptor is the inverse of unwrap: wrap(a) rewrapped with b, its block regenerated, is wrap(b)', () => {
    const one = serializeArchitecture({ apiVersion: ARCHITECTURE_API_VERSION, chart: 'x', kind: ARCHITECTURE_KIND, resources: [] })
    const two = serializeArchitecture({ apiVersion: ARCHITECTURE_API_VERSION, chart: 'x', kind: ARCHITECTURE_KIND, resources: [{ apiVersion: 'v1', class: 'native', id: 'a', kind: 'ConfigMap', name: 'printf "%s-a" $.Release.Name', template: 'templates/a.yaml' }] })
    const rewrapped = rewrapDescriptor(wrapAsConfigMapTemplate(one, 'x'), two) ?? ''
    expect(unwrapFromConfigMapTemplate(rewrapped)).toBe(two)
    // The block is not rewrap's: it stays as it was until the store regenerates it.
    expect(graphBlockIn(rewrapped)).toBe(graphBlockIn(wrapAsConfigMapTemplate(one, 'x')))
    expect(regenerateGraphBlock(rewrapped, 'x')).toBe(wrapAsConfigMapTemplate(two, 'x'))
    expect(rewrapDescriptor('kind: ConfigMap\n', two)).toBeNull()
  })

  it('a composition is placed at the compdef\'s SERVED version — v1-8-40, not the storage version vacuum', () => {
    expect(placementCrd(builderPublish)).toEqual({ name: 'builderpublishes.composition.krateo.io', version: 'v1-8-40' })
    const spec = extractCrdSpecFields(CRDS['builderpublishes.composition.krateo.io'], placementCrd(builderPublish)?.version)
    expect(spec?.fields.filter((field) => field.required).map((field) => field.name)).toEqual(['branch', 'builder', 'name', 'target'])
    const plan = planPlace(seeded(), builderPublish, spec)
    if (!plan.ok) { throw new Error(plan.reason) }
    expect(nodesOf(plan.edit[ARCHITECTURE_TEMPLATE_PATH])[0]).toMatchObject({ apiVersion: 'composition.krateo.io/v1-8-40', class: 'composition', kind: 'BuilderPublish' })
    expect(plan.add['templates/builderpublish.yaml']).toBe(golden('builderpublish'))
  })

  it('a native kind has no CRD to read', () => {
    expect(placementCrd({ apiVersion: 'apps/v1', cls: 'native', kind: 'Deployment', plural: 'deployments' })).toBeNull()
    expect(placementCrd(repository)).toEqual({ name: 'repositories.github.krateo.io', version: 'v2022-11-28' })
  })
})

describe('planPlace — refusals', () => {
  it('no descriptor: add it first', () => {
    const { [ARCHITECTURE_TEMPLATE_PATH]: _gone, ...files } = seeded()
    expect(planPlace(files, repository, null)).toEqual({ ok: false, reason: NO_DESCRIPTOR })
    expect(NO_DESCRIPTOR).toBe('Add templates/architecture.yaml first — the canvas has the button.')
  })

  it('a descriptor the kernel refuses — or no block to read it from — is fixed in Chart files first', () => {
    expect(DESCRIPTOR_REFUSED).toBe('The architecture file has problems — fix them in Chart files before placing.')
    const files = seeded()
    expect(planPlace({ ...files, [ARCHITECTURE_TEMPLATE_PATH]: 'kind: ConfigMap\n' }, repository, null)).toEqual({ ok: false, reason: DESCRIPTOR_REFUSED })
    const broken = files[ARCHITECTURE_TEMPLATE_PATH].replace('resources: []', 'resources: 3')
    expect(planPlace({ ...files, [ARCHITECTURE_TEMPLATE_PATH]: broken }, repository, null)).toEqual({ ok: false, reason: DESCRIPTOR_REFUSED })
  })

  it('nesting the chart into itself is refused as a cycle', () => {
    expect(planPlace(seeded('builder-publish'), builderPublish, null))
      .toEqual({ ok: false, reason: 'Nesting builder-publish into builder-publish is refused as a cycle — a blueprint cannot contain itself.' })
  })
})
