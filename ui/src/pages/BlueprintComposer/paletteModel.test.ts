/**
 * The palette's view model — grouping, the filter, the owner label, "placed", self-nesting and the
 * cluster-scoped count — over the blueprint-palette status sliced from krateo-057.
 */
import { describe, expect, it } from 'vitest'

import { PALETTE_STATUS } from './__fixtures__/s4a'
import { shapePaletteStatus } from './blueprintPalette'
import { groupOwnerLabel, knownReadyField, paletteModel, placedCounts, rowLabel } from './paletteModel'

const read = shapePaletteStatus(PALETTE_STATUS)
const model = (filter = '', resources: { apiVersion: string; kind: string }[] = [], chart: string | null = 'orders') =>
  paletteModel(read, filter, resources, chart)

describe('paletteModel — the custom class', () => {
  it('groups by API group, namespaced kinds only, and counts what it left out', () => {
    const { custom } = model()
    expect(custom.state).toBe('ok')
    expect(custom.groups.map((group) => [group.group, group.owner, group.total])).toEqual([
      ['cert-manager.io', null, 3],
      ['git.krateo.io', 'git-provider-crd', 2],
      ['github.krateo.io', 'github-provider-kog', 58],
      ['kagent.dev', 'kagent-crds', 9],
    ])
    expect(custom.kinds).toBe(72)
    expect(custom.groupCount).toBe(4)
    expect(custom.clusterScoped).toBe(1)
  })

  it('a row shows the version, and the known readiness field only when the CRD declares it', () => {
    const github = model().custom.groups.find((group) => group.group === 'github.krateo.io')
    const row = (kind: string) => github?.rows.find((entry) => entry.primary === kind)
    expect(row('Repository')?.secondary).toBe('v2022-11-28 · default_branch')
    expect(row('PullRequest')?.secondary).toBe('v2022-11-28 · html_url')
    expect(row('RepoWebhook')?.secondary).toBe('v2022-11-28')
    expect(row('Repository')?.pick).toEqual({ apiVersion: 'github.krateo.io/v2022-11-28', cls: 'custom', group: 'github.krateo.io', kind: 'Repository', plural: 'repositories' })
    expect(knownReadyField('github.krateo.io', 'Repository', ['name'])).toBeNull()
    expect(knownReadyField('git.krateo.io', 'Repo', ['targetCommitId'])).toBe('targetCommitId')
    expect(knownReadyField('x.io', 'constructor', ['constructor'])).toBeNull()
  })

  it('the filter matches a group by name (all its kinds) or kinds by name (only those)', () => {
    expect(model('git').custom.groups.map((group) => [group.group, group.rows.length])).toEqual([['git.krateo.io', 2], ['github.krateo.io', 58]])
    expect(model('  GIT ').filter).toBe('GIT')
    const repo = model('repository').custom.groups
    expect(repo.map((group) => group.group)).toEqual(['github.krateo.io'])
    expect(repo[0].rows.map((entry) => entry.primary)).toEqual(['Repository', 'RepositoryConfiguration'])
    // The pill still counts the whole group.
    expect(repo[0].total).toBe(58)
  })

  it('nothing anywhere matches: said — but not while a class is still listing', () => {
    expect(model('zzz-nothing').nothingMatches).toBe(true)
    expect(model('deploy').nothingMatches).toBe(false)
    expect(paletteModel(null, 'zzz-nothing', [], null).nothingMatches).toBe(false)
  })
})

describe('paletteModel — owner labels', () => {
  it('the longest dash-bounded prefix the owners share, after the RestDefinition\'s namespace', () => {
    expect(groupOwnerLabel(['krateo-system/github-provider-kog-repository', 'krateo-system/github-provider-kog-pullrequest'])).toBe('github-provider-kog')
    expect(groupOwnerLabel(['git-provider-crd', 'git-provider-crd'])).toBe('git-provider-crd')
    expect(groupOwnerLabel(['kog-repositoryx', 'kog-repository'])).toBe('kog')
    expect(groupOwnerLabel(['alpha', 'beta'])).toBeNull()
    expect(groupOwnerLabel([null, null])).toBeNull()
    expect(groupOwnerLabel([null, 'a-b'])).toBe('a-b')
  })
})

describe('paletteModel — native and compositions', () => {
  it('the native nine, filtered by kind or apiVersion', () => {
    expect(model().native.map(rowLabel)[0]).toBe('Deployment · apps/v1 · available')
    expect(model('batch').native.map((row) => row.primary)).toEqual(['Job', 'CronJob'])
    expect(model('networking').native.map((row) => row.primary)).toEqual(['Ingress'])
  })

  it('a composition row: name → Kind · version · N running — no count where it could not be counted', () => {
    const { compositions } = model()
    expect(compositions.installed).toBe(3)
    expect(compositions.rows.map(rowLabel)).toEqual([
      'aws-rds-stack → AwsRdsStack · v0-3-0 · 3 running',
      'builder-publish → BuilderPublish · v1-8-40 · 23 running',
      'mongodb → Mongodb · v0-1-2',
    ])
    expect(compositions.rows[1].pick).toEqual({ apiVersion: 'composition.krateo.io/v1-8-40', blueprint: 'builder-publish', cls: 'composition', kind: 'BuilderPublish', plural: 'builderpublishes' })
  })

  it('flags the one blueprint that is the chart being composed', () => {
    const own = paletteModel(read, '', [], 'builder-publish')
    expect(own.compositions.selfNesting).toBe('builder-publish')
    expect(own.compositions.rows.filter((row) => row.selfNesting).map((row) => row.primary)).toEqual(['builder-publish'])
    expect(model().compositions.selfNesting).toBeNull()
  })
})

describe('paletteModel — placed', () => {
  it('counts nodes of each apiVersion and kind, and a placed row says so in its name', () => {
    const resources = [
      { apiVersion: 'github.krateo.io/v2022-11-28', kind: 'Repository' },
      { apiVersion: 'github.krateo.io/v2022-11-28', kind: 'Repository' },
      { apiVersion: 'apps/v1', kind: 'Deployment' },
    ]
    expect(placedCounts(resources).get('github.krateo.io/v2022-11-28|Repository')).toBe(2)
    const placed = model('', resources)
    expect(placed.native[0].placed).toBe(1)
    expect(rowLabel(placed.native[0])).toBe('Deployment · apps/v1 · available · placed')
    expect(placed.custom.groups.find((group) => group.group === 'github.krateo.io')?.rows.find((row) => row.primary === 'Repository')?.placed).toBe(2)
  })
})

describe('paletteModel — while listing, and when a class is denied', () => {
  it('loading: both discovered classes say so, with nothing in them', () => {
    const loading = paletteModel(null, '', [], null)
    expect([loading.custom.state, loading.compositions.state]).toEqual(['loading', 'loading'])
    expect(loading.native).toHaveLength(9)
  })

  it('denied: the sentence, and no rows', () => {
    const denied = paletteModel(shapePaletteStatus({ ...PALETTE_STATUS, compositions: { error: { code: 403 } } }), '', [], null)
    expect(denied.compositions.state).toBe('denied')
    expect(denied.compositions.sentence).toMatch(/403 on CompositionDefinitions/)
    expect(denied.compositions.rows).toEqual([])
  })
})
