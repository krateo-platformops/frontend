/**
 * The provider's verb dispatch (routeProposal): a Builder ALLOWING a verb must not make it a publish.
 *
 * Regression (#422 review): publisherOfVerb answered the Builder's publish.builder for ANY verb in
 * its verbs.allowed, so an agent's previewBlueprint, chartPut or composeAdd opened the publish form
 * instead of being applied.
 */
import { describe, expect, it } from 'vitest'

import { builderRegistry } from '../../builders/builderRegistry'

import { routeProposal } from './proposalRoute'
import { PUBLISH_VERBS, publisherOfVerb } from './publishDraft'

describe('publisherOfVerb — only a publish verb publishes', () => {
  it('is null for every non-publish verb either fixture allows', () => {
    const allowed = builderRegistry.all().flatMap((builder) => builder.spec.verbs.allowed)
    const others = allowed.filter((verb) => !PUBLISH_VERBS.has(verb))
    expect(others).toEqual(expect.arrayContaining(['composeAdd', 'composeMove', 'composeBind', 'previewPage', 'chartPut', 'chartDelete', 'chartLink', 'previewBlueprint']))
    for (const verb of others) {
      expect(publisherOfVerb(verb), verb).toBeNull()
    }
  })

  it('names the publisher of each publish verb', () => {
    expect(publisherOfVerb('publishPage')).toBe('page')
    expect(publisherOfVerb('publishBlueprint')).toBe('blueprint')
    expect(publisherOfVerb('publishRestDef')).toBe('controller')
  })
})

describe('routeProposal — which path a proposal takes', () => {
  it('previewBlueprint, chartPut and composeAdd reach apply, not publishDraft', () => {
    expect(routeProposal('previewBlueprint')).toBe('apply')
    expect(routeProposal('chartPut')).toBe('apply')
    expect(routeProposal('composeAdd')).toBe('apply')
    expect(routeProposal('previewPage')).toBe('apply')
    expect(routeProposal('previewRestDef')).toBe('apply')
  })

  it('the three publish verbs reach publishDraft; prefillForm and applyResourceSet keep their own paths', () => {
    expect(routeProposal('publishPage')).toBe('publish')
    expect(routeProposal('publishBlueprint')).toBe('publish')
    expect(routeProposal('publishRestDef')).toBe('publish')
    expect(routeProposal('prefillForm')).toBe('prefillForm')
    expect(routeProposal('applyResourceSet')).toBe('applyResourceSet')
    expect(routeProposal('navigate')).toBe('apply')
  })
})
