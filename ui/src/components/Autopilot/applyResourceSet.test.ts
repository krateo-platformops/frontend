/**
 * P1 applySet — the SCOPED, human-gated `applyResourceSet` mutating branch. Pure-logic
 * coverage (no RTL/jsdom), matching patchField.test.ts. Proves:
 *   - the isApplySetAllowed SET SAFETY KERNEL truth table (op-count cap at 10; group
 *     allowlist = *.krateo.io OR core ConfigMaps only; per-op shape requirements;
 *     the A.3 NEVER-HAND-APPLY carve-out: widget CRs / restactions DENIED except
 *     into EXACTLY the configured preview sandbox namespace — no config, no exception);
 *   - applyResourceSet compiles the ORDERED WriteOps (snowplow /call write paths the
 *     W0-4 confirm parses) and dispatches EXACTLY ONCE through deps.handleActionSet → runRestSet,
 *     so the whole set ALWAYS flows through the ONE aggregated blast-radius gate;
 *   - a denied set (too many ops / out-of-scope group / malformed op) is a no-op
 *     (null, no dispatch) — the kernel gates BEFORE the W0-4 gate, never a bypass;
 *   - the human's decline (handleActionSet → null) yields no chip.
 */
import { describe, expect, it, vi } from 'vitest'

import type { WriteOp, WriteOpResult } from '../../hooks/runRestSet'

import {
  applyResourceSet,
  type ApplyResourceSetDeps,
  type ApplyResourceSetOp,
  type ApplyResourceSetProposal,
  buildSetOpPath,
  isApplySetAllowed,
  isSetOpAllowed,
  isSetOpGroupAllowed,
  MAX_APPLY_SET_OPS,
} from './applyResourceSet'

const KRATEO_OP: ApplyResourceSetOp = {
  gvr: { group: 'core.krateo.io', resource: 'compositiondefinitions', version: 'v1alpha1' },
  name: 'my-def',
  namespace: 'demo',
  payload: { spec: { chart: { version: '1.0.0' } } },
  verb: 'PATCH',
}

const CONFIGMAP_OP: ApplyResourceSetOp = {
  gvr: { group: '', resource: 'configmaps', version: 'v1' },
  name: 'my-config',
  namespace: 'demo',
  payload: { data: { key: 'value' } },
  verb: 'PATCH',
}

const opOf = (over: Partial<ApplyResourceSetOp> = {}): ApplyResourceSetOp => ({ ...KRATEO_OP, ...over })

const makeDeps = (result: WriteOpResult[] | null = []): { deps: ApplyResourceSetDeps; handleActionSet: ReturnType<typeof vi.fn> } => {
  const handleActionSet = vi.fn((_ops: readonly WriteOp[]): Promise<WriteOpResult[] | null> => Promise.resolve(result))
  return { deps: { handleActionSet }, handleActionSet }
}

const makeProposal = (ops: ApplyResourceSetOp[], label?: string): ApplyResourceSetProposal => ({
  ops,
  verb: 'applyResourceSet',
  ...(label ? { label } : {}),
})

// ────────────────────────────────────────────────────────────────────────────
// The SET SAFETY KERNEL — group allowlist + per-op shape + op-count cap
// ────────────────────────────────────────────────────────────────────────────

describe('isSetOpGroupAllowed — Krateo groups or core ConfigMaps only', () => {
  it('accepts any group ending in .krateo.io', () => {
    expect(isSetOpGroupAllowed({ group: 'core.krateo.io', resource: 'compositiondefinitions', version: 'v1alpha1' })).toBe(true)
    expect(isSetOpGroupAllowed({ group: 'fireworksapp.composition.krateo.io', resource: 'fireworksapps', version: 'v1alpha1' })).toBe(true)
    // The widgets group passes the GROUP predicate (it is Krateo-owned) — its
    // namespace-dependent A.3 deny lives in isSetOpAllowed (see the carve-out matrix).
    expect(isSetOpGroupAllowed({ group: 'widgets.templates.krateo.io', resource: 'tables', version: 'v1beta1' })).toBe(true)
  })

  it('accepts core ("") ConfigMaps ONLY — no other core kind', () => {
    expect(isSetOpGroupAllowed({ group: '', resource: 'configmaps', version: 'v1' })).toBe(true)
    expect(isSetOpGroupAllowed({ group: '', resource: 'secrets', version: 'v1' })).toBe(false)
    expect(isSetOpGroupAllowed({ group: '', resource: 'pods', version: 'v1' })).toBe(false)
    expect(isSetOpGroupAllowed({ group: '', resource: 'serviceaccounts', version: 'v1' })).toBe(false)
  })

  it('rejects any other group (no arbitrary cluster resource)', () => {
    expect(isSetOpGroupAllowed({ group: 'apps', resource: 'deployments', version: 'v1' })).toBe(false)
    expect(isSetOpGroupAllowed({ group: 'rbac.authorization.k8s.io', resource: 'clusterroles', version: 'v1' })).toBe(false)
    expect(isSetOpGroupAllowed({ group: 'ec2.services.k8s.aws', resource: 'vpcs', version: 'v1alpha1' })).toBe(false)
    // A group that merely CONTAINS (or non-dot-ends with) the suffix is rejected.
    expect(isSetOpGroupAllowed({ group: 'krateo.io', resource: 'x', version: 'v1' })).toBe(false)
    expect(isSetOpGroupAllowed({ group: 'evil-krateo.io', resource: 'x', version: 'v1' })).toBe(false)
    expect(isSetOpGroupAllowed({ group: 'core.krateo.io.evil.example.com', resource: 'x', version: 'v1' })).toBe(false)
    expect(isSetOpGroupAllowed(undefined)).toBe(false)
  })
})

describe('NEVER-WRITE-GIT — no set may write a branch, file or pull request through github.krateo.io', () => {
  const gitOp = (resource: string): ApplyResourceSetOp => ({
    gvr: { group: 'github.krateo.io', resource, version: 'v1alpha1' },
    name: 'x',
    namespace: 'krateo-system',
    payload: {},
    verb: 'POST',
  })

  it('refuses each git-write kind — the legacy GitHub publish must not survive as a model-emitted set', () => {
    for (const resource of ['gitrefs', 'repocontents', 'pullrequests']) {
      expect(isSetOpAllowed(gitOp(resource))).toBe(false)
    }
    expect(isApplySetAllowed([KRATEO_OP, gitOp('repocontents')])).toBe(false)
  })

  it('leaves the rest of github.krateo.io and the BuilderPublish claim alone', () => {
    expect(isSetOpAllowed(gitOp('repositories'))).toBe(true)
    expect(isSetOpAllowed({ ...gitOp('builderpublishes'), gvr: { group: 'composition.krateo.io', resource: 'builderpublishes', version: 'v1-8-21' } })).toBe(true)
  })
})

describe('isSetOpAllowed — one op\'s shape + scope', () => {
  it('allows each mutating verb on an in-scope target', () => {
    expect(isSetOpAllowed(opOf({ verb: 'POST' }))).toBe(true)
    expect(isSetOpAllowed(opOf({ verb: 'PUT' }))).toBe(true)
    expect(isSetOpAllowed(opOf({ verb: 'PATCH' }))).toBe(true)
    expect(isSetOpAllowed(opOf({ payload: undefined, verb: 'DELETE' }))).toBe(true)
  })

  it('a POST may omit the name (collection create); PUT/PATCH/DELETE must name their target', () => {
    expect(isSetOpAllowed(opOf({ name: undefined, verb: 'POST' }))).toBe(true)
    expect(isSetOpAllowed(opOf({ name: undefined, verb: 'PUT' }))).toBe(false)
    expect(isSetOpAllowed(opOf({ name: undefined, verb: 'PATCH' }))).toBe(false)
    expect(isSetOpAllowed(opOf({ name: undefined, verb: 'DELETE' }))).toBe(false)
  })

  it('rejects path-hostile name/namespace segments (subresource/query smuggling)', () => {
    // A `/` in the name would re-target a SUBRESOURCE path (e.g. `foo/status`).
    expect(isSetOpAllowed(opOf({ name: 'foo/status' }))).toBe(false)
    expect(isSetOpAllowed(opOf({ name: 'foo?dryRun=All' }))).toBe(false)
    expect(isSetOpAllowed(opOf({ name: 'foo#frag' }))).toBe(false)
    expect(isSetOpAllowed(opOf({ name: '..' }))).toBe(false)
    // k8s names are lower-case DNS-1123
    expect(isSetOpAllowed(opOf({ name: 'Foo' }))).toBe(false)
    expect(isSetOpAllowed(opOf({ namespace: 'kube-system/secrets' }))).toBe(false)
    expect(isSetOpAllowed(opOf({ namespace: 'ns?watch=true' }))).toBe(false)
    // A POST with a present-but-hostile name is rejected too (name rides into the path/payload).
    expect(isSetOpAllowed(opOf({ name: 'a/b', verb: 'POST' }))).toBe(false)
    // Clean DNS-1123 segments (dots + dashes) stay allowed.
    expect(isSetOpAllowed(opOf({ name: 'my-app.v2' }))).toBe(true)
    expect(isSetOpAllowed(opOf({ namespace: 'team-a' }))).toBe(true)
  })

  it('rejects a non-mutating or unknown verb, and an incomplete target', () => {
    expect(isSetOpAllowed(opOf({ verb: 'GET' as ApplyResourceSetOp['verb'] }))).toBe(false)
    expect(isSetOpAllowed(opOf({ namespace: '' }))).toBe(false)
    expect(isSetOpAllowed(opOf({ gvr: { group: 'core.krateo.io', resource: '', version: 'v1' } }))).toBe(false)
    expect(isSetOpAllowed(opOf({ gvr: { group: 'core.krateo.io', resource: 'x', version: '' } }))).toBe(false)
    expect(isSetOpAllowed(undefined)).toBe(false)
  })
})

// ────────────────────────────────────────────────────────────────────────────
// The A.3 SANDBOX CARVE-OUT: widget CRs / restactions are NEVER hand-applied —
// DENY, except into EXACTLY the configured preview sandbox namespace.
//   DENY   gvr.group == 'widgets.templates.krateo.io' || gvr.resource == 'restactions'
//   EXCEPT op.namespace === config.PREVIEW_SANDBOX_NAMESPACE  // absent ⇒ no exception
// ────────────────────────────────────────────────────────────────────────────

const SANDBOX = 'krateo-preview'

const WIDGET_OP: ApplyResourceSetOp = {
  gvr: { group: 'widgets.templates.krateo.io', resource: 'paragraphs', version: 'v1beta1' },
  name: 'preview-draft-title',
  namespace: SANDBOX,
  payload: { kind: 'Paragraph', spec: { widgetData: { text: 'draft' } } },
  verb: 'POST',
}

const RESTACTION_OP: ApplyResourceSetOp = {
  gvr: { group: 'templates.krateo.io', resource: 'restactions', version: 'v1' },
  name: 'preview-projects',
  namespace: SANDBOX,
  payload: { kind: 'RESTAction', spec: {} },
  verb: 'POST',
}

describe('A.3 carve-out matrix — widgets/restactions DENY except the exact sandbox ns', () => {
  it('NO configured sandbox: widget-CR and restactions ops are ALWAYS denied (total deny)', () => {
    expect(isSetOpAllowed(WIDGET_OP)).toBe(false)
    expect(isSetOpAllowed(RESTACTION_OP)).toBe(false)
    expect(isSetOpAllowed({ ...WIDGET_OP, namespace: 'krateo-system' })).toBe(false)
    expect(isApplySetAllowed([WIDGET_OP])).toBe(false)
    expect(isApplySetAllowed([RESTACTION_OP])).toBe(false)
  })

  it('configured sandbox: allowed ONLY into exactly that namespace', () => {
    expect(isSetOpAllowed(WIDGET_OP, SANDBOX)).toBe(true)
    expect(isSetOpAllowed(RESTACTION_OP, SANDBOX)).toBe(true)
    // Every mutating verb — the preview flow POSTs and DELETEs (teardown).
    expect(isSetOpAllowed({ ...WIDGET_OP, payload: undefined, verb: 'DELETE' }, SANDBOX)).toBe(true)
  })

  it('any OTHER namespace stays denied even with a sandbox configured', () => {
    expect(isSetOpAllowed({ ...WIDGET_OP, namespace: 'krateo-system' }, SANDBOX)).toBe(false)
    expect(isSetOpAllowed({ ...RESTACTION_OP, namespace: 'demo-system' }, SANDBOX)).toBe(false)
  })

  it('EXACT string equality — no prefix/superstring tricks', () => {
    expect(isSetOpAllowed({ ...WIDGET_OP, namespace: 'krateo-preview2' }, SANDBOX)).toBe(false)
    expect(isSetOpAllowed({ ...WIDGET_OP, namespace: 'krateo-previe' }, SANDBOX)).toBe(false)
    expect(isSetOpAllowed({ ...WIDGET_OP, namespace: 'a-krateo-preview' }, SANDBOX)).toBe(false)
  })

  it('restactions are matched on the RESOURCE (any group — defensive)', () => {
    const rogue = { ...RESTACTION_OP, gvr: { ...RESTACTION_OP.gvr, group: 'other.templates.krateo.io' }, namespace: 'krateo-system' }
    expect(isSetOpAllowed(rogue, SANDBOX)).toBe(false)
    expect(isSetOpAllowed({ ...rogue, namespace: SANDBOX }, SANDBOX)).toBe(true)
  })

  it('non-widget Krateo groups and core ConfigMaps are UNAFFECTED by the sandbox argument', () => {
    expect(isSetOpAllowed(KRATEO_OP)).toBe(true)
    expect(isSetOpAllowed(KRATEO_OP, SANDBOX)).toBe(true)
    expect(isSetOpAllowed(CONFIGMAP_OP)).toBe(true)
    expect(isSetOpAllowed(CONFIGMAP_OP, SANDBOX)).toBe(true)
  })

  it('all-or-nothing: ONE out-of-sandbox widget op denies the WHOLE set', () => {
    expect(isApplySetAllowed([WIDGET_OP, RESTACTION_OP], SANDBOX)).toBe(true)
    expect(isApplySetAllowed([WIDGET_OP, { ...WIDGET_OP, namespace: 'krateo-system' }], SANDBOX)).toBe(false)
  })

  it('applyResourceSet threads deps.sandboxNamespace: sandbox set dispatches, unconfigured is a no-op', async () => {
    const sandboxed = makeDeps()
    const chip = await applyResourceSet(makeProposal([WIDGET_OP, RESTACTION_OP]), { ...sandboxed.deps, sandboxNamespace: SANDBOX })
    expect(sandboxed.handleActionSet).toHaveBeenCalledTimes(1)
    expect(chip).toEqual({ label: 'apply 2 objects', readOnly: false, verb: 'applyResourceSet' })

    const unconfigured = makeDeps()
    expect(await applyResourceSet(makeProposal([WIDGET_OP, RESTACTION_OP]), unconfigured.deps)).toBeNull()
    expect(unconfigured.handleActionSet).not.toHaveBeenCalled()
  })
})

describe('isApplySetAllowed — the composed kernel (cap + all-or-nothing scope)', () => {
  it(`ALLOWS 1..${MAX_APPLY_SET_OPS} in-scope ops and REJECTS ${MAX_APPLY_SET_OPS + 1}`, () => {
    expect(isApplySetAllowed([KRATEO_OP])).toBe(true)
    expect(isApplySetAllowed(Array.from({ length: MAX_APPLY_SET_OPS }, () => KRATEO_OP))).toBe(true)
    expect(isApplySetAllowed(Array.from({ length: MAX_APPLY_SET_OPS + 1 }, () => KRATEO_OP))).toBe(false)
  })

  it('REJECTS an empty set and a set with ANY out-of-scope op (all-or-nothing)', () => {
    expect(isApplySetAllowed([])).toBe(false)
    expect(isApplySetAllowed(undefined)).toBe(false)
    const rogue = opOf({ gvr: { group: 'apps', resource: 'deployments', version: 'v1' } })
    expect(isApplySetAllowed([KRATEO_OP, CONFIGMAP_OP, rogue])).toBe(false)
  })
})

// ────────────────────────────────────────────────────────────────────────────
// buildSetOpPath — the snowplow /call target (parsed by the W0-4 set confirm)
// ────────────────────────────────────────────────────────────────────────────

describe('buildSetOpPath — snowplow /call query-shape write paths', () => {
  it('builds /call?apiVersion=<group>%2F<version>&resource=…&name=…&namespace=… for a named-group write', () => {
    expect(buildSetOpPath(KRATEO_OP)).toBe('/call?apiVersion=core.krateo.io%2Fv1alpha1&resource=compositiondefinitions&name=my-def&namespace=demo')
  })

  it('uses the BARE version as apiVersion for the core group', () => {
    expect(buildSetOpPath(CONFIGMAP_OP)).toBe('/call?apiVersion=v1&resource=configmaps&name=my-config&namespace=demo')
  })

  it('a POST targets the collection: name is the required-but-ignored placeholder', () => {
    // snowplow validates a non-empty `name` on EVERY verb but ignores it when building a
    // POST's apiserver URI (the create hits the collection).
    expect(buildSetOpPath(opOf({ verb: 'POST' }))).toBe('/call?apiVersion=core.krateo.io%2Fv1alpha1&resource=compositiondefinitions&name=-&namespace=demo')
    expect(buildSetOpPath(opOf({ name: undefined, verb: 'POST' }))).toBe('/call?apiVersion=core.krateo.io%2Fv1alpha1&resource=compositiondefinitions&name=-&namespace=demo')
  })
})

// ────────────────────────────────────────────────────────────────────────────
// applyResourceSet — compiles the ordered set + dispatches ONCE through the gate
// ────────────────────────────────────────────────────────────────────────────

describe('applyResourceSet — dispatch through the W0-4 gate', () => {
  it('dispatches ONCE with the ordered WriteOps (verb + parseable path + payload)', async () => {
    const { deps, handleActionSet } = makeDeps()
    const deleteOp = opOf({ name: 'doomed', payload: undefined, verb: 'DELETE' })
    const chip = await applyResourceSet(makeProposal([KRATEO_OP, CONFIGMAP_OP, deleteOp]), deps)

    expect(handleActionSet).toHaveBeenCalledTimes(1)
    const [ops] = handleActionSet.mock.calls[0] as [WriteOp[]]
    expect(ops).toEqual([
      {
        path: '/call?apiVersion=core.krateo.io%2Fv1alpha1&resource=compositiondefinitions&name=my-def&namespace=demo',
        payload: KRATEO_OP.payload,
        verb: 'PATCH',
      },
      { path: '/call?apiVersion=v1&resource=configmaps&name=my-config&namespace=demo', payload: CONFIGMAP_OP.payload, verb: 'PATCH' },
      { path: '/call?apiVersion=core.krateo.io%2Fv1alpha1&resource=compositiondefinitions&name=doomed&namespace=demo', verb: 'DELETE' },
    ])

    // The returned chip marks a MUTATION (readOnly:false).
    expect(chip).toEqual({ label: 'apply 3 objects', readOnly: false, verb: 'applyResourceSet' })
  })

  it('uses the proposal label when given', async () => {
    const { deps } = makeDeps()
    const chip = await applyResourceSet(makeProposal([KRATEO_OP], 'roll out the fleet fix'), deps)
    expect(chip?.label).toBe('roll out the fleet fix')
  })

  it('the human\'s DECLINE (handleActionSet → null: nothing dispatched) yields no chip', async () => {
    const { deps, handleActionSet } = makeDeps(null)
    const chip = await applyResourceSet(makeProposal([KRATEO_OP]), deps)
    expect(handleActionSet).toHaveBeenCalledTimes(1)
    expect(chip).toBeNull()
  })
})

describe('applyResourceSet — DENIED (no dispatch) — the kernel gates before W0-4', () => {
  it(`denies a set over the ${MAX_APPLY_SET_OPS}-op cap (returns null, never dispatches)`, async () => {
    const { deps, handleActionSet } = makeDeps()
    const chip = await applyResourceSet(makeProposal(Array.from({ length: MAX_APPLY_SET_OPS + 1 }, () => KRATEO_OP)), deps)
    expect(chip).toBeNull()
    expect(handleActionSet).not.toHaveBeenCalled()
  })

  it('denies a set containing ANY out-of-scope group (a Deployment, a Secret) — all-or-nothing', async () => {
    const { deps, handleActionSet } = makeDeps()
    const deployment = opOf({ gvr: { group: 'apps', resource: 'deployments', version: 'v1' } })
    const secret = opOf({ gvr: { group: '', resource: 'secrets', version: 'v1' } })
    expect(await applyResourceSet(makeProposal([KRATEO_OP, deployment]), deps)).toBeNull()
    expect(await applyResourceSet(makeProposal([secret]), deps)).toBeNull()
    expect(handleActionSet).not.toHaveBeenCalled()
  })

  it('denies an empty or malformed set (missing namespace / nameless DELETE)', async () => {
    const { deps, handleActionSet } = makeDeps()
    expect(await applyResourceSet(makeProposal([]), deps)).toBeNull()
    expect(await applyResourceSet(makeProposal([opOf({ namespace: '' })]), deps)).toBeNull()
    expect(await applyResourceSet(makeProposal([opOf({ name: undefined, verb: 'DELETE' })]), deps)).toBeNull()
    expect(handleActionSet).not.toHaveBeenCalled()
  })
})
