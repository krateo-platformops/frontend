/**
 * The engine's one source of Builders (T2): the fixtures load, parse clean, and answer every way the
 * engine asks — by draft kind, route, name and verb. Every draft kind this build's DraftKind type
 * names has a Builder and a draft-kind plugin, so `builderOf` / `draftKindOf` cannot throw on a held
 * draft.
 */
import { describe, expect, it } from 'vitest'

import type { DraftKind } from '../components/Autopilot/blueprintDraftStore'
import { isBuilderPayload, payloadAppliesCrs } from '../components/Autopilot/previewBus'
import { composerModeOf } from '../components/Autopilot/previewDraftChanged'

import { builderOf, builderRegistry, findBuilderOf } from './builderRegistry'
import { draftKindNames, draftKindOf, findDraftKindPlugin } from './draftKinds'
import { builderRefusals } from './pluginRegistry'

const DRAFT_KINDS: DraftKind[] = ['page', 'blueprint']

describe('builderRegistry — the fixtures, loaded', () => {
  it('loads both builders, with no problem', () => {
    expect(builderRegistry.problems()).toEqual([])
    expect(builderRegistry.all().map((builder) => builder.metadata.name)).toEqual(['portal-builder', 'blueprint-builder'])
  })

  it('every builder it loads names only plugins and checks this frontend ships', () => {
    for (const builder of builderRegistry.all()) {
      expect(builderRefusals(builder.spec)).toEqual([])
    }
  })

  it('answers by draft kind, route, name and verb', () => {
    expect(builderRegistry.get({ draftKind: 'page' })?.metadata.name).toBe('portal-builder')
    expect(builderRegistry.get({ route: '/blueprint-builder/compose' })?.metadata.name).toBe('blueprint-builder')
    expect(builderRegistry.get({ name: 'blueprint-builder' })?.spec.draftKind).toBe('blueprint')
    expect(builderRegistry.get({ verb: 'publishPage' })?.metadata.name).toBe('portal-builder')
    expect(builderRegistry.get({ verb: 'chartPut' })?.metadata.name).toBe('blueprint-builder')
  })

  it('answers undefined — never a throw — for what no Builder declares', () => {
    expect(builderRegistry.get({ draftKind: 'controller' })).toBeUndefined()
    expect(builderRegistry.get({ verb: 'publishRestDef' })).toBeUndefined()
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
})
