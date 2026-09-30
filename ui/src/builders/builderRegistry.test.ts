/**
 * The engine's one source of Builders (T2): the fixtures load, parse clean, and answer every way the
 * engine asks — by draft kind, route, name and verb. Every draft kind this build's DraftKind type
 * names has a Builder and a draft-kind plugin, so `builderOf` / `draftKindOf` cannot throw on a held
 * draft.
 */
import { describe, expect, it } from 'vitest'

import { createBlueprintDraftStore, type DraftKind } from '../components/Autopilot/blueprintDraftStore'
import { draftKindOfPayload, isBuilderPayload, payloadAppliesCrs } from '../components/Autopilot/previewBus'
import { composerModeOf } from '../components/Autopilot/previewDraftChanged'
import { publishDraft, publisherOfVerb, type PublishDraftDeps } from '../components/Autopilot/publishDraft'

import { builderOf, builderRegistry, createBuilderRegistry, findBuilderOf, swapBuildersForTest } from './builderRegistry'
import type { Builder } from './builderSpec'
import { draftKindNames, draftKindOf, findDraftKindPlugin, isDraftKind } from './draftKinds'
import { builderRefusals, pendingPluginNames } from './pluginRegistry'

const DRAFT_KINDS: DraftKind[] = ['page', 'blueprint', 'controller']

describe('builderRegistry — the fixtures, loaded', () => {
  it('loads the three builders, with no problem', () => {
    expect(builderRegistry.problems()).toEqual([])
    expect(builderRegistry.all().map((builder) => builder.metadata.name)).toEqual(['portal-builder', 'blueprint-builder', 'controller-builder'])
  })

  it('the shipped fixtures claim no key twice, and the rail\'s publishRestDef is the Controller Builder\'s', () => {
    // A duplicated draftKind, route, name or verb is a problem sentence here, and the registry then
    // answers NO Builder for that key: drafts of that kind would stop being held, or the rail's
    // publish would publish nothing. Both must fail CI rather than a page.
    expect(builderRegistry.problems()).toEqual([])
    const keys = builderRegistry.all().flatMap((builder) => [
      `draftKind:${builder.spec.draftKind}`,
      `route:${builder.spec.route}`,
      `name:${builder.metadata.name}`,
      ...builder.spec.verbs.allowed.map((verb) => `verb:${verb}`),
    ])
    expect(keys.filter((key, index) => keys.indexOf(key) !== index)).toEqual([])
    expect(publisherOfVerb('publishRestDef')).toBe('controller')
  })

  it('a second Builder declaring the controller draft kind is a problem, and the kind is then held by none', () => {
    const controller = builderRegistry.get({ name: 'controller-builder' })!
    const twin: Builder = { ...controller, metadata: { name: 'twin-builder' }, spec: { ...controller.spec, route: '/twin-builder/compose', verbs: { allowed: [] } } }
    const registry = createBuilderRegistry({ builders: [...builderRegistry.all(), twin], problems: [] })
    expect(registry.problems()).toEqual(['controller-builder and twin-builder both declare the draft kind "controller", so no builder answers for it — one Builder must own it.'])
    expect(registry.get({ draftKind: 'controller' })).toBeUndefined()
  })

  it('every builder it loads names only plugins and checks this frontend ships — the controller\'s too, since T8', () => {
    for (const builder of builderRegistry.all()) {
      expect(builderRefusals(builder.spec), builder.metadata.name).toEqual([])
    }
    expect([...pendingPluginNames('palette'), ...pendingPluginNames('canvas'), ...pendingPluginNames('inspector')]).toEqual([])
  })

  it('answers by draft kind, route, name and verb', () => {
    expect(builderRegistry.get({ draftKind: 'page' })?.metadata.name).toBe('portal-builder')
    expect(builderRegistry.get({ route: '/blueprint-builder/compose' })?.metadata.name).toBe('blueprint-builder')
    expect(builderRegistry.get({ name: 'blueprint-builder' })?.spec.draftKind).toBe('blueprint')
    expect(builderRegistry.get({ verb: 'publishPage' })?.metadata.name).toBe('portal-builder')
    expect(builderRegistry.get({ verb: 'chartPut' })?.metadata.name).toBe('blueprint-builder')
  })

  it('the controller: its draft kind, its route and its publish verb are the Controller Builder\'s', () => {
    expect(builderRegistry.get({ draftKind: 'controller' })?.metadata.name).toBe('controller-builder')
    expect(builderRegistry.get({ route: '/controller-builder/compose' })?.metadata.name).toBe('controller-builder')
    expect(builderRegistry.get({ verb: 'publishRestDef' })?.metadata.name).toBe('controller-builder')
    expect(builderRegistry.get({ verb: 'previewRestDef' })?.metadata.name).toBe('controller-builder')
  })

  it('answers undefined — never a throw — for what no Builder declares', () => {
    expect(builderRegistry.get({ draftKind: 'workflow' })).toBeUndefined()
    expect(builderRegistry.get({ verb: 'publishWorkflow' })).toBeUndefined()
    expect(findBuilderOf(undefined)).toBeUndefined()
    expect(findBuilderOf(null)).toBeUndefined()
  })

  it('every DraftKind has a Builder, and the draft-kind plugin its Builder names', () => {
    for (const kind of DRAFT_KINDS) {
      expect(builderOf(kind).draftKind).toBe(kind)
      expect(() => draftKindOf(kind)).not.toThrow()
    }
    expect(draftKindNames()).toEqual([...DRAFT_KINDS].sort())
  })

  it('isDraftKind is deny-by-default: a plugin AND a loaded Builder, nothing else', () => {
    for (const kind of DRAFT_KINDS) { expect(isDraftKind(kind), kind).toBe(true) }
    for (const kind of ['workflow', 'Page', 'toString', '__proto__', '', null, undefined, 7, {}]) {
      expect(isDraftKind(kind), JSON.stringify(kind)).toBe(false)
    }
    // A kind with a plugin whose Builder is not loaded is not held either.
    const portal = builderRegistry.get({ name: 'portal-builder' })!
    const restore = swapBuildersForTest([portal])
    try {
      expect(isDraftKind('page')).toBe(true)
      expect(isDraftKind('controller')).toBe(false)
      expect(createBlueprintDraftStore().set({ 'Chart.yaml': 'name: x\nversion: 0.1.0\n' }, 'controller')).toEqual({
        error: 'no builder declares the draft kind "controller" — a draft is held only under a kind a loaded Builder declares',
        ok: false,
      })
    } finally {
      restore()
    }
  })

  it('a draft kind no Builder declares is said loudly', () => {
    expect(() => builderOf('nope')).toThrow(/No Builder declares the draft kind "nope"/)
  })

  it('a composer knows its own draft and its own previews by its Builder\'s name', () => {
    expect(composerModeOf({ files: { 'Chart.yaml': 'x' }, kind: 'blueprint' }, 'blueprint-builder')).toBe('own')
    expect(composerModeOf({ files: { 'Chart.yaml': 'x' }, kind: 'page' }, 'blueprint-builder')).toBe('parked')
    expect(composerModeOf({ files: { 'a.yaml': 'x' } }, 'blueprint-builder')).toBe('parked')
    expect(composerModeOf({ files: { 'a.yaml': 'x' }, kind: null }, 'blueprint-builder')).toBe('empty')
    expect(composerModeOf({ files: {} }, 'blueprint-builder')).toBe('empty')
    expect(isBuilderPayload({}, 'portal-builder')).toBe(true)
    expect(isBuilderPayload({ builder: 'blueprint' }, 'portal-builder')).toBe(false)
    expect(isBuilderPayload({ builder: 'blueprint' }, 'blueprint-builder')).toBe(true)
    expect(isBuilderPayload({ builder: 'inspect' }, 'blueprint-builder')).toBe(false)
    expect(isBuilderPayload({ builder: 'restdef' }, 'nope')).toBe(false)
  })

  it('a payload\'s files are CRs to parse only when its Builder previews by applying them', () => {
    expect(payloadAppliesCrs({})).toBe(true)
    expect(payloadAppliesCrs({ builder: 'blueprint' })).toBe(false)
    expect(payloadAppliesCrs({ builder: 'inspect' })).toBe(false)
  })

  it('refuses a draft-kind plugin by name, never by prototype', () => {
    expect(findDraftKindPlugin('toString')).toBeUndefined()
    expect(findDraftKindPlugin('Page')).toBeUndefined()
  })

  it('a payload that SPELLS the legacy kind is held by none — the legacy kind is said only by absence', () => {
    expect(draftKindOfPayload({ builder: 'page' as never })).toBeNull()
    expect(draftKindOfPayload({})).toBe('page')
  })
})

describe('builderRegistry — a verb two Builders allow', () => {
  /** The portal builder, and a chart builder that ALSO allows publishPage. */
  const clash = (): Builder[] => {
    const portal = builderRegistry.get({ name: 'portal-builder' })
    const blueprint = builderRegistry.get({ name: 'blueprint-builder' })
    if (!portal || !blueprint) { throw new Error('fixtures missing') }
    const other: Builder = {
      ...blueprint,
      metadata: { name: 'other-builder' },
      spec: { ...blueprint.spec, route: '/other-builder/compose', verbs: { allowed: ['chartPut', 'publishPage'] } },
    }
    return [portal, other]
  }

  it('answers no Builder for it, and says why — load order never decides', () => {
    const registry = createBuilderRegistry({ builders: clash(), problems: [] })
    expect(registry.get({ verb: 'publishPage' })).toBeUndefined()
    expect(registry.get({ verb: 'chartPut' })?.metadata.name).toBe('other-builder')
    const sentence = 'portal-builder and other-builder both declare the verb publishPage, so no builder answers for it — one Builder must own it.'
    expect(registry.verbProblem('publishPage')).toBe(sentence)
    expect(registry.verbProblem('chartPut')).toBeNull()
    expect(registry.problems()).toEqual([sentence])
  })

  it('a publish of the contested verb is denied with that sentence', async () => {
    const restore = swapBuildersForTest(clash())
    try {
      expect(publisherOfVerb('publishPage')).toBeNull()
      const store = createBlueprintDraftStore()
      const outcome = await publishDraft({ blueprintStore: store } as unknown as PublishDraftDeps, { verb: 'publishPage' })
      expect(outcome.compiled.ops).toBeNull()
      expect(outcome.compiled.denial).toBe('denied — portal-builder and other-builder both declare the verb publishPage, so no builder answers for it — one Builder must own it.')
    } finally {
      restore()
    }
  })
})
