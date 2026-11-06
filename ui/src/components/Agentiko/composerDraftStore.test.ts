/**
 * DRAFT PROVENANCE — the speak-back trigger, tested through the seam dictation will use.
 *
 * The whole feature turns on one question: were these words DICTATED, or TYPED? The string
 * cannot answer it, so the store carries the answer explicitly and these tests pin the
 * three cases the owner's trigger names — dictated-only speaks, dictated-then-typed does
 * not, typed-only does not — plus the resets that stop one turn's provenance leaking into
 * the next.
 */
import { describe, expect, it } from 'vitest'

import { createComposerDraftStore } from './composerDraftStore'

describe('draft provenance', () => {
  it('a purely dictated draft is a VOICE turn', () => {
    const store = createComposerDraftStore()
    store.appendDictatedSegment('scale the payments composition')
    store.appendDictatedSegment('to three replicas')
    expect(store.getSnapshot()).toEqual({ provenance: 'dictated', text: 'scale the payments composition to three replicas' })
    expect(store.turnModality()).toBe('voice')
  })

  it('one typed character after dictation makes it a TEXT turn, for good', () => {
    const store = createComposerDraftStore()
    store.appendDictatedSegment('scale payments')
    // The textarea's onChange — a single appended character is the whole trigger.
    store.setTypedDraft('scale payments?')
    expect(store.getSnapshot().provenance).toBe('typed')
    expect(store.turnModality()).toBe('text')
    // And it never climbs back: more dictation onto a touched draft stays a typed turn.
    store.appendDictatedSegment('to three replicas')
    expect(store.getSnapshot().text).toBe('scale payments? to three replicas')
    expect(store.turnModality()).toBe('text')
  })

  it('a typed draft is a TEXT turn even when it reads like something you would say', () => {
    const store = createComposerDraftStore()
    store.setTypedDraft('scale the payments composition to three replicas')
    expect(store.turnModality()).toBe('text')
  })

  it('deleting the last character is still a keyboard touch, not a reset to dictated', () => {
    const store = createComposerDraftStore()
    store.appendDictatedSegment('scale payments')
    store.setTypedDraft('scale payment')
    expect(store.turnModality()).toBe('text')
  })

  it('emptying the draft resets provenance, so a typed question cannot poison the next dictated one', () => {
    const store = createComposerDraftStore()
    store.setTypedDraft('typed and then deleted')
    store.setTypedDraft('')
    expect(store.getSnapshot().provenance).toBe('empty')
    store.appendDictatedSegment('now dictated')
    expect(store.turnModality()).toBe('voice')
  })

  it('clear() after Send leaves the next draft with no history', () => {
    const store = createComposerDraftStore()
    store.appendDictatedSegment('dictated question')
    expect(store.turnModality()).toBe('voice')
    store.clear()
    expect(store.getSnapshot()).toEqual({ provenance: 'empty', text: '' })
    expect(store.turnModality()).toBe('text')
  })

  it('an empty or whitespace-only transcript never flips an untouched draft to dictated', () => {
    const store = createComposerDraftStore()
    store.appendDictatedSegment('   ')
    expect(store.getSnapshot()).toEqual({ provenance: 'empty', text: '' })
    expect(store.turnModality()).toBe('text')
  })

  it('appends after whatever is in the draft at the moment the transcript arrives, one space apart', () => {
    const store = createComposerDraftStore()
    store.setTypedDraft('a')
    store.setTypedDraft('a b')
    store.appendDictatedSegment('  c  ')
    expect(store.getSnapshot().text).toBe('a b c')
  })
})

describe('remount survival', () => {
  it('notifies subscribers and keeps text AND provenance across a re-read (the routerVersion remount)', () => {
    const store = createComposerDraftStore()
    let notifications = 0
    const unsubscribe = store.subscribe(() => { notifications += 1 })
    store.appendDictatedSegment('half a question')
    expect(notifications).toBe(1)
    // A remount re-reads the SAME module-level snapshot rather than starting from ''.
    const afterRemount = store.getSnapshot()
    expect(afterRemount.text).toBe('half a question')
    expect(afterRemount.provenance).toBe('dictated')
    unsubscribe()
    store.appendDictatedSegment('ignored')
    expect(notifications).toBe(1)
  })

  it('does not emit when a write changes nothing (stable snapshot reference)', () => {
    const store = createComposerDraftStore()
    store.setTypedDraft('same')
    const before = store.getSnapshot()
    let notifications = 0
    store.subscribe(() => { notifications += 1 })
    store.setTypedDraft('same')
    expect(notifications).toBe(0)
    expect(store.getSnapshot()).toBe(before)
  })
})
