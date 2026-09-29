/**
 * What a person's Publish ANSWERS — the one payload that makes a composer say "Published".
 *
 * The composer reads `denial === null` as success and shows the change-request link. So the
 * answer may carry no denial only when the claim was actually written: not when the person
 * declined the blast-radius confirm (apply → null, nothing dispatched), and not when the apiserver
 * refused the claim (a chip with a `failure`). Both used to answer `denial: null` with the deep
 * link — computed before apply ran — and the composer congratulated a publish that never happened.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./builderClaimPublish', () => ({
  buildClaimPublish: vi.fn(() => Promise.resolve({
    branch: 'builder/builder-publish',
    compiled: {
      claim: { namespace: 'krateo-system', paths: ['Chart.yaml'], publishName: 'builder-publish', target: 'krateo-blueprints/builder-publish' },
      denial: null,
      ops: [{ gvr: { group: 'builder.krateo.io', resource: 'builderpublishes', version: 'v1alpha1' }, namespace: 'krateo-system', payload: {}, verb: 'POST' }],
    },
    deepLink: 'https://github.com/krateo-blueprints/builder-publish/compare/main...builder/builder-publish',
  })),
}))

import { startChart } from '../../pages/BlueprintComposer/startChart'

import { createBlueprintDraftStore } from './blueprintDraftStore'
import { runPersonPublish, type PersonPublishDeps } from './publishDraft'
import type { AutopilotActionChip } from './types'

/** A chart exactly as Start seeds it — clean under the lint, so only the apply decides. */
const seeded = (): Record<string, string> => {
  const started = startChart({ description: '', name: 'builder-publish', version: '0.1.0' })
  if (!started.ok) { throw new Error('fixture chart refused') }
  return started.files
}

const deps = (applied: AutopilotActionChip | null) => {
  const store = createBlueprintDraftStore()
  store.set(seeded(), 'blueprint')
  const apply = vi.fn(() => Promise.resolve(applied))
  const track = vi.fn()
  const markPublished = vi.fn(() => Promise.resolve())
  return {
    apply,
    deps: {
      apply,
      blueprintGate: { evaluate: () => ({ allowed: true, reason: null }) },
      blueprintStore: store,
      builderTargets: { blueprint: { owner: 'krateo-blueprints', repo: 'builder-publish' }, blueprintTemplate: { owner: '', repo: '' }, page: { owner: 'krateo-platformops', repo: 'portal' } },
      markPublished,
      origin: { prompt: null, sessionId: null },
      track,
    } as unknown as PersonPublishDeps,
    markPublished,
    store,
    track,
  }
}

const LANDED: AutopilotActionChip = { label: 'Publish', readOnly: false, verb: 'applyResourceSet' }

beforeEach(() => { vi.clearAllMocks() })

describe('runPersonPublish — "published" only when the claim was written', () => {
  it('a landed claim: no denial, the change-request link, and the rail watches it', async () => {
    const { apply, deps: publishDeps, track } = deps(LANDED)
    const answer = await runPersonPublish(publishDeps, 'publishBlueprint')
    expect(apply).toHaveBeenCalledTimes(1)
    expect(answer.denial).toBeNull()
    expect(answer.deepLink).toContain('builder/builder-publish')
    expect(track).toHaveBeenCalledTimes(1)
  })

  it('a DECLINED confirm (apply → null): not published, no link, nothing watched', async () => {
    const { deps: publishDeps, track } = deps(null)
    const answer = await runPersonPublish(publishDeps, 'publishBlueprint')
    expect(answer.denial).toMatch(/^Not published — nothing was written/)
    expect(answer.deepLink).toBeNull()
    expect(track).not.toHaveBeenCalled()
  })

  it('a REFUSED claim (the chip carries the apiserver\'s failure): said in its words, no link', async () => {
    const { deps: publishDeps, track } = deps({ ...LANDED, failure: 'HTTP 403 — builderpublishes.builder.krateo.io is forbidden' })
    const answer = await runPersonPublish(publishDeps, 'publishBlueprint')
    expect(answer.denial).toBe('Not published — the claim was refused: HTTP 403 — builderpublishes.builder.krateo.io is forbidden')
    expect(answer.deepLink).toBeNull()
    expect(track).not.toHaveBeenCalled()
  })

  it('a landed claim marks the draft\'s RECORD published, with the claim and the change-request link', async () => {
    const { deps: publishDeps, markPublished, store } = deps(LANDED)
    const held = store.get()
    const answer = await runPersonPublish(publishDeps, 'publishBlueprint')
    expect(markPublished).toHaveBeenCalledTimes(1)
    expect(markPublished).toHaveBeenCalledWith(held, expect.objectContaining({ publishName: 'builder-publish' }), answer.deepLink)
  })

  it('a declined or refused publish leaves the record open', async () => {
    const declined = deps(null)
    await runPersonPublish(declined.deps, 'publishBlueprint')
    const refused = deps({ ...LANDED, failure: 'HTTP 403' })
    await runPersonPublish(refused.deps, 'publishBlueprint')
    expect(declined.markPublished).not.toHaveBeenCalled()
    expect(refused.markPublished).not.toHaveBeenCalled()
  })
})
