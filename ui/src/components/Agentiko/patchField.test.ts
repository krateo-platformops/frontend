/**
 * Day-2 ops part B — the SCOPED, human-gated `patchField` mutating branch. Pure-logic
 * coverage (no RTL/jsdom), matching the repo's other Agentiko tests. Proves:
 *   - the isPatchAllowed SAFETY KERNEL truth table (composition + single spec field
 *     ALLOWED; non-composition GVR REJECTED; metadata/status/'*'/empty/nested REJECTED);
 *   - applyPatchField builds the correct PATCH `rest` WidgetAction + minimal merge-patch
 *     payload on a PATCH ResourceRef, and dispatches EXACTLY ONCE (mocked handleAction);
 *   - a non-composition GVR (and an out-of-spec field) is DENIED (null, no dispatch) — so
 *     the scoping kernel gates BEFORE the W0-2 gate, never after / never a bypass.
 */
import { describe, expect, it, vi } from 'vitest'

import type { ResourcesRefs, WidgetAction } from '../../types/Widget'

import {
  applyPatchField,
  buildPatchRefPath,
  isCompositionGvr,
  isPatchAllowed,
  type PatchFieldDeps,
  type PatchFieldGvr,
  type PatchFieldProposal,
  specKeyOf,
} from './patchField'

const COMPOSITION_GVR: PatchFieldGvr = {
  group: 'fireworksapp.composition.krateo.io',
  resource: 'fireworksapps',
  version: 'v1alpha1',
}

const makeDeps = (): { deps: PatchFieldDeps; handleAction: ReturnType<typeof vi.fn> } => {
  const handleAction = vi.fn((): Promise<void> => Promise.resolve())
  return { deps: { handleAction }, handleAction }
}

const makeProposal = (over: Partial<PatchFieldProposal> = {}): PatchFieldProposal => ({
  field: 'spec.size',
  gvr: COMPOSITION_GVR,
  name: 'my-app',
  namespace: 'demo-system',
  value: 'large',
  verb: 'patchField',
  ...over,
})

// ────────────────────────────────────────────────────────────────────────────
// The SAFETY KERNEL — isPatchAllowed truth table
// ────────────────────────────────────────────────────────────────────────────

describe('isCompositionGvr — composition-only group scoping', () => {
  it('accepts a group ending in composition.krateo.io', () => {
    expect(isCompositionGvr(COMPOSITION_GVR)).toBe(true)
    expect(isCompositionGvr({ group: 'composition.krateo.io', resource: 'x', version: 'v1' })).toBe(true)
  })

  it('rejects any other group (no arbitrary cluster resource)', () => {
    expect(isCompositionGvr({ group: 'apps', resource: 'deployments', version: 'v1' })).toBe(false)
    expect(isCompositionGvr({ group: '', resource: 'secrets', version: 'v1' })).toBe(false)
    expect(isCompositionGvr({ group: 'ec2.services.k8s.aws', resource: 'vpcs', version: 'v1alpha1' })).toBe(false)
    // A group that merely CONTAINS but does not END with the suffix is rejected.
    expect(isCompositionGvr({ group: 'composition.krateo.io.evil.example.com', resource: 'x', version: 'v1' })).toBe(false)
    expect(isCompositionGvr(undefined)).toBe(false)
  })
})

describe('specKeyOf — single simple spec field normalization', () => {
  it('normalizes a bare simple key to itself (patched under spec)', () => {
    expect(specKeyOf('size')).toBe('size')
    expect(specKeyOf('  replicas  ')).toBe('replicas')
  })

  it('normalizes a spec.<key> path to the key', () => {
    expect(specKeyOf('spec.size')).toBe('size')
    expect(specKeyOf('spec.replicas')).toBe('replicas')
  })

  it('rejects metadata / status / apiVersion / kind / deletion paths', () => {
    expect(specKeyOf('metadata.name')).toBeNull()
    expect(specKeyOf('metadata.deletionTimestamp')).toBeNull()
    expect(specKeyOf('status.conditions')).toBeNull()
    expect(specKeyOf('apiVersion')).toBeNull()
    expect(specKeyOf('kind')).toBeNull()
    // bare reserved roots must not slip through as simple keys
    expect(specKeyOf('metadata')).toBeNull()
    expect(specKeyOf('status')).toBeNull()
  })

  it("rejects '*', empty, nested spec paths, and wildcard/path chars", () => {
    expect(specKeyOf('*')).toBeNull()
    expect(specKeyOf('')).toBeNull()
    expect(specKeyOf('   ')).toBeNull()
    expect(specKeyOf(undefined)).toBeNull()
    // nested / deeper than a single spec key
    expect(specKeyOf('spec.deploy.targetRef.name')).toBeNull()
    expect(specKeyOf('spec.*')).toBeNull()
    expect(specKeyOf('spec.')).toBeNull()
    // path/index characters in a bare key
    expect(specKeyOf('a.b')).toBeNull()
    expect(specKeyOf('items[0]')).toBeNull()
  })
})

describe('isPatchAllowed — the composed safety kernel truth table', () => {
  it('ALLOWS a composition GVR + a single spec field (bare or spec.-prefixed)', () => {
    expect(isPatchAllowed(COMPOSITION_GVR, 'spec.size')).toBe(true)
    expect(isPatchAllowed(COMPOSITION_GVR, 'size')).toBe(true)
  })

  it('REJECTS a non-composition GVR even with a valid spec field', () => {
    expect(isPatchAllowed({ group: 'apps', resource: 'deployments', version: 'v1' }, 'spec.replicas')).toBe(false)
    expect(isPatchAllowed({ group: '', resource: 'secrets', version: 'v1' }, 'size')).toBe(false)
  })

  it('REJECTS metadata/status/deletion/*/empty fields even on a composition GVR', () => {
    expect(isPatchAllowed(COMPOSITION_GVR, 'metadata.name')).toBe(false)
    expect(isPatchAllowed(COMPOSITION_GVR, 'metadata.deletionTimestamp')).toBe(false)
    expect(isPatchAllowed(COMPOSITION_GVR, 'status.phase')).toBe(false)
    expect(isPatchAllowed(COMPOSITION_GVR, '*')).toBe(false)
    expect(isPatchAllowed(COMPOSITION_GVR, '')).toBe(false)
    expect(isPatchAllowed(COMPOSITION_GVR, 'spec.a.b')).toBe(false)
  })
})

// ────────────────────────────────────────────────────────────────────────────
// buildPatchRefPath — the snowplow /call PATCH target (parsed by the W0-2 gate)
// ────────────────────────────────────────────────────────────────────────────

describe('buildPatchRefPath — snowplow /call query shape the W0-2 gate parses', () => {
  it('builds /call?apiVersion=<group>%2F<version>&resource=<plural>&name=<name>&namespace=<ns>', () => {
    expect(buildPatchRefPath(COMPOSITION_GVR, 'demo-system', 'my-app')).toBe(
      '/call?apiVersion=fireworksapp.composition.krateo.io%2Fv1alpha1&resource=fireworksapps&name=my-app&namespace=demo-system',
    )
  })
})

// ────────────────────────────────────────────────────────────────────────────
// applyPatchField — the mutating branch: builds the PATCH action + dispatches once
// ────────────────────────────────────────────────────────────────────────────

describe('applyPatchField — builds the PATCH WidgetAction + merge-patch payload', () => {
  it('dispatches ONCE a PATCH rest action with a merge-patch header + minimal spec body', async () => {
    const { deps, handleAction } = makeDeps()
    const chip = await applyPatchField(makeProposal({ field: 'spec.size', value: 'large' }), deps)

    expect(handleAction).toHaveBeenCalledTimes(1)
    const [action, refs] = handleAction.mock.calls[0] as [WidgetAction, ResourcesRefs]

    // The action is a `rest` action referencing our PATCH ref, with the merge-patch Content-Type.
    expect(action.type).toBe('rest')
    const rest = action as WidgetAction & { type: 'rest' }
    expect(rest.resourceRefId).toBe('agentiko-patch-field')
    expect(rest.headers).toContain('Content-Type: application/merge-patch+json')

    // The ResourceRef carries verb PATCH (runRest reads verb from the REF → W0-2 gate fires),
    // the snowplow /call write path, and the minimal { spec: { <key>: <value> } } merge-patch body.
    expect(refs.items).toHaveLength(1)
    const [ref] = refs.items
    expect(ref.verb).toBe('PATCH')
    expect(ref.id).toBe('agentiko-patch-field')
    expect(ref.path).toBe('/call?apiVersion=fireworksapp.composition.krateo.io%2Fv1alpha1&resource=fireworksapps&name=my-app&namespace=demo-system')
    expect(ref.payload).toEqual({ spec: { size: 'large' } })

    // The returned chip marks a MUTATION (readOnly:false).
    expect(chip).not.toBeNull()
    expect(chip?.verb).toBe('patchField')
    expect(chip?.readOnly).toBe(false)
  })

  it('normalizes a bare simple field ("size") under spec too', async () => {
    const { deps, handleAction } = makeDeps()
    await applyPatchField(makeProposal({ field: 'size', value: 3 }), deps)
    const [, refs] = handleAction.mock.calls[0] as [WidgetAction, ResourcesRefs]
    expect(refs.items[0].payload).toEqual({ spec: { size: 3 } })
  })

  it('supports an object value in the merge-patch body', async () => {
    const { deps, handleAction } = makeDeps()
    await applyPatchField(makeProposal({ field: 'spec.resources', value: { cpu: '2' } }), deps)
    const [, refs] = handleAction.mock.calls[0] as [WidgetAction, ResourcesRefs]
    expect(refs.items[0].payload).toEqual({ spec: { resources: { cpu: '2' } } })
  })
})

describe('applyPatchField — DENIED (no dispatch) — scoping kernel gates before W0-2', () => {
  it('denies a non-composition GVR (returns null, never dispatches)', async () => {
    const { deps, handleAction } = makeDeps()
    const chip = await applyPatchField(
      makeProposal({ field: 'spec.replicas', gvr: { group: 'apps', resource: 'deployments', version: 'v1' } }),
      deps,
    )
    expect(chip).toBeNull()
    expect(handleAction).not.toHaveBeenCalled()
  })

  it('denies an out-of-spec field (metadata/status) on a composition GVR', async () => {
    const { deps, handleAction } = makeDeps()
    expect(await applyPatchField(makeProposal({ field: 'metadata.name', value: 'x' }), deps)).toBeNull()
    expect(await applyPatchField(makeProposal({ field: 'status.phase', value: 'x' }), deps)).toBeNull()
    expect(await applyPatchField(makeProposal({ field: '*', value: 'x' }), deps)).toBeNull()
    expect(handleAction).not.toHaveBeenCalled()
  })

  it('denies a malformed proposal (missing name/namespace)', async () => {
    const { deps, handleAction } = makeDeps()
    expect(await applyPatchField(makeProposal({ name: '' }), deps)).toBeNull()
    expect(await applyPatchField(makeProposal({ namespace: '' }), deps)).toBeNull()
    expect(handleAction).not.toHaveBeenCalled()
  })
})
