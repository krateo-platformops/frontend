/**
 * FE-BP2 — the blueprint preview gate:
 *   - only sets touching a blueprint-publish resource (the builderpublishes claim /
 *     compositiondefinitions) are gated; anything else passes;
 *   - a publish is DENIED unless the CURRENTLY-HELD draft's chart name was previewed this
 *     thread (deny-by-default; no held draft => deny; wrong name => deny);
 *   - previews accumulate; reset() forgets them all (newThread).
 */
import { describe, expect, it } from 'vitest'

import type { ApplyResourceSetOp } from './applyResourceSet'
import {
  BLUEPRINT_PUBLISH_RESOURCES,
  createBlueprintGate,
  opsArePublishSet,
} from './blueprintGate'

const op = (group: string, resource: string, name: string): ApplyResourceSetOp => ({
  gvr: { group, resource, version: 'v1alpha1' },
  name,
  namespace: 'krateo-system',
  payload: { metadata: { name, namespace: 'krateo-system' } },
  verb: 'POST',
})

/** A blueprint publish (the one BuilderPublish claim, set #1) + the register op (set #2). */
const claimSet: ApplyResourceSetOp[] = [op('composition.krateo.io', 'builderpublishes', 'publish-hello')]
const registerSet: ApplyResourceSetOp[] = [op('core.krateo.io', 'compositiondefinitions', 'hello')]
/** A non-blueprint set (a KOG ConfigMap publish, say) — never gated by THIS gate. */
const otherSet: ApplyResourceSetOp[] = [op('', 'configmaps', 'oas'), op('ogen.krateo.io', 'restdefinitions', 'x')]

describe('opsArePublishSet', () => {
  it('detects every guarded resource, ignores others', () => {
    expect([...BLUEPRINT_PUBLISH_RESOURCES].sort()).toEqual(['builderpublishes', 'compositiondefinitions'])
    // The GitHub git-write kinds are not GATED — they are refused outright (applyResourceSet).
    expect(opsArePublishSet([op('github.krateo.io', 'repocontents', 'x')])).toBe(false)
    expect(opsArePublishSet(claimSet)).toBe(true)
    expect(opsArePublishSet(registerSet)).toBe(true)
    expect(opsArePublishSet(otherSet)).toBe(false)
    expect(opsArePublishSet([])).toBe(false)
    expect(opsArePublishSet(undefined)).toBe(false)
  })
})

describe('createBlueprintGate — preview-before-publish', () => {
  it('passes any set that touches no blueprint-publish resource, regardless of preview', () => {
    const gate = createBlueprintGate()
    expect(gate.evaluate(otherSet, null).allowed).toBe(true)
    expect(gate.evaluate([], 'hello').allowed).toBe(true)
  })

  it('DENIES a publish by default (fresh gate, nothing previewed)', () => {
    const gate = createBlueprintGate()
    const verdict = gate.evaluate(claimSet, 'hello')
    expect(verdict.allowed).toBe(false)
    expect(!verdict.allowed && verdict.reason).toContain('hello')
  })

  it('DENIES a publish when no draft is held (heldChartName null/empty)', () => {
    const gate = createBlueprintGate()
    gate.recordPreview('hello')
    const verdict = gate.evaluate(registerSet, null)
    expect(verdict.allowed).toBe(false)
    expect(!verdict.allowed && verdict.reason).toContain('no held blueprint draft')
    expect(gate.evaluate(registerSet, '').allowed).toBe(false)
  })

  it('DENIES when the held draft name was not the one previewed', () => {
    const gate = createBlueprintGate()
    gate.recordPreview('other-chart')
    expect(gate.evaluate(claimSet, 'hello').allowed).toBe(false)
  })

  it('ALLOWS a publish once the held draft name was previewed this thread', () => {
    const gate = createBlueprintGate()
    gate.recordPreview('hello')
    expect(gate.evaluate(claimSet, 'hello').allowed).toBe(true)
    expect(gate.evaluate(registerSet, 'hello').allowed).toBe(true)
  })

  it('accumulates previews; reset() forgets them all', () => {
    const gate = createBlueprintGate()
    gate.recordPreview('a')
    gate.recordPreview('b')
    expect(gate.evaluate(claimSet, 'a').allowed).toBe(true)
    expect(gate.evaluate(claimSet, 'b').allowed).toBe(true)
    gate.reset()
    expect(gate.evaluate(claimSet, 'a').allowed).toBe(false)
  })

  it('ignores null/empty preview records (deny-by-default holds)', () => {
    const gate = createBlueprintGate()
    gate.recordPreview(null)
    gate.recordPreview('')
    gate.recordPreview(undefined)
    expect(gate.evaluate(claimSet, 'hello').allowed).toBe(false)
  })
})

/**
 * forget — the half `reset` could not do. A hand edit that makes the held draft dirty does not
 * change its chart name, so "not re-arming" would leave that name armed from its last clean
 * preview and the publish would pass. Only forgetting the ONE name puts the gate back to deny,
 * without discarding the previews of anything else in the thread.
 */
describe('forget — one name back to deny, the rest untouched', () => {
  it('denies the forgotten chart, keeps every other preview', () => {
    const gate = createBlueprintGate()
    gate.recordPreview('hello')
    gate.recordPreview('other')
    expect(gate.evaluate(gitSet, 'hello').allowed).toBe(true)

    gate.forget('hello')

    expect(gate.evaluate(gitSet, 'hello').allowed).toBe(false)
    expect(gate.evaluate(gitSet, 'other').allowed).toBe(true)
  })

  it('a null/undefined/unknown name is a no-op, not a throw', () => {
    const gate = createBlueprintGate()
    gate.recordPreview('hello')
    expect(() => {
      gate.forget(null)
      gate.forget(undefined)
      gate.forget('never-seen')
    }).not.toThrow()
    expect(gate.evaluate(gitSet, 'hello').allowed).toBe(true)
  })

  it('a forgotten chart re-arms on its next clean preview', () => {
    const gate = createBlueprintGate()
    gate.recordPreview('hello')
    gate.forget('hello')
    gate.recordPreview('hello')
    expect(gate.evaluate(gitSet, 'hello').allowed).toBe(true)
  })
})
