/**
 * publishTargetForm — the publish-destination kind extension (item #30 adds 'restdef').
 * Headless-path coverage: with no mounted host, askPublishDestination resolves the prefills
 * (byte-identical non-interactive behavior), for EVERY kind in the union including the new one.
 */
import { afterEach, describe, expect, it } from 'vitest'

import { askPublishDestination, resetPublishTargetForTests, type PublishTargetRequest } from './publishTargetForm'

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
})
