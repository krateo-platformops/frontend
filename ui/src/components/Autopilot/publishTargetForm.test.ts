/**
 * publishTargetForm — the publish-destination kind extension (item #30 adds 'restdef').
 * Headless-path coverage: with no mounted host, askPublishDestination resolves the prefills
 * (byte-identical non-interactive behavior), for EVERY kind in the union including the new one.
 */
import { afterEach, describe, expect, it } from 'vitest'

import { askPublishDestination, repositoryProblem, resetPublishTargetForTests, type PublishTargetRequest } from './publishTargetForm'

afterEach(() => {
  resetPublishTargetForTests()
})

describe('askPublishDestination — headless resolves the prefills, per kind', () => {
  const kinds: PublishTargetRequest['kind'][] = ['page', 'blueprint', 'restdef']

  it('resolves the default repo for each kind when the proposal omits coords', async () => {
    const targets = await Promise.all(kinds.map((kind) => askPublishDestination({}, kind, `default-${kind}-repo`)))
    kinds.forEach((kind, index) => {
      expect(targets[index]).toEqual({ base: 'main', owner: 'krateo-blueprints', repo: `default-${kind}-repo` })
    })
  })

  it('restdef kind: prefers the proposal coords over the default when supplied', async () => {
    const target = await askPublishDestination({ base: 'develop', owner: 'acme', repo: 'my-oas' }, 'restdef', 'krateo-oas')
    expect(target).toEqual({ base: 'develop', owner: 'acme', repo: 'my-oas' })
  })

  it('restdef kind falls back to krateo-oas as its default repo', async () => {
    const target = await askPublishDestination({}, 'restdef', 'krateo-oas')
    expect(target?.repo).toBe('krateo-oas')
  })

  it('honors a per-builder default owner when the proposal omits one (KOG/oas → krateo-platformops)', async () => {
    // Regression guard for the #105 mis-repoint: the KOG registry lives in krateo-platformops,
    // NOT krateo-blueprints (which has no krateo-oas repo). The restdef/page callers pass this owner.
    const target = await askPublishDestination({}, 'restdef', 'krateo-oas', 'krateo-platformops')
    expect(target).toEqual({ base: 'main', owner: 'krateo-platformops', repo: 'krateo-oas' })
  })

  it('a proposal owner still wins over the per-builder default owner', async () => {
    const target = await askPublishDestination({ owner: 'acme' }, 'restdef', 'krateo-oas', 'krateo-platformops')
    expect(target?.owner).toBe('acme')
  })
})

describe('askPublishDestination — a page or blueprint names its own repository (D4)', () => {
  it('prefills the ARTIFACT\'S slug as the repository, whatever the proposal names', async () => {
    // A model-emitted repo used to win, and the rail's own re-prompt handed the model the install's
    // fallback repo to emit — so a page set could arrive prefilled into `portal`.
    const target = await askPublishDestination({ repo: 'portal' }, 'page', 'portal', 'krateo-platformops', { seeded: false, slug: 'fleet-health' })
    expect(target?.repo).toBe('fleet-health')
  })

  it('still takes the proposal\'s owner and base — those are not per artifact', async () => {
    const target = await askPublishDestination({ base: 'develop', owner: 'acme', repo: 'elsewhere' }, 'blueprint', 'fallback', 'krateo-blueprints', { seeded: true, slug: 'orders-api' })
    expect(target).toEqual({ base: 'develop', owner: 'acme', repo: 'orders-api' })
  })

  it('without an artifact (a KOG mapping), the proposal\'s repo still wins as before', async () => {
    const target = await askPublishDestination({ repo: 'my-oas' }, 'restdef', 'krateo-oas', 'krateo-platformops')
    expect(target?.repo).toBe('my-oas')
  })
})

describe('repositoryProblem — the form\'s repository rule', () => {
  it('refuses, with the reason, a repository other than the one a SEEDED publish requires', () => {
    expect(repositoryProblem({ requiredRepo: 'orders-api' }, 'blueprints')).toMatch(/^the repository must be "orders-api", not "blueprints" — a repository seeded from the builder template holds exactly one chart/)
  })

  it('accepts the required repository', () => {
    expect(repositoryProblem({ requiredRepo: 'orders-api' }, 'orders-api')).toBeNull()
  })

  it('says nothing when nothing is required — an unseeded publish may go anywhere', () => {
    expect(repositoryProblem({}, 'anything')).toBeNull()
    expect(repositoryProblem(undefined, 'anything')).toBeNull()
  })

  it('leaves an EMPTY value to the required rule, so one message shows, not two', () => {
    expect(repositoryProblem({ requiredRepo: 'orders-api' }, '')).toBeNull()
    expect(repositoryProblem({ requiredRepo: 'orders-api' }, undefined)).toBeNull()
  })
})
