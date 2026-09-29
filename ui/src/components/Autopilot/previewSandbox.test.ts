/**
 * W4 previewPage v2 (FE-P4) — the pure sandbox-draft toolkit. Pure-logic coverage
 * (no RTL/jsdom), matching the repo's other Autopilot tests. Proves:
 *   - kind→GVR mapping (the verbatim CRD plural table incl. the irregulars) and the
 *     deny-by-default on unknown kinds;
 *   - validatePageDrafts: ajv over the REAL co-located schemas (envelope + required
 *     widgetData props), DNS-1123 names, apiVersion pinning, the RESTAction
 *     structural fallback, duplicate rejection;
 *   - the A.2.2 rewrite: namespace FORCED, names OWNER-SCOPED, preview + owner labels
 *     stamped, in-set resourcesRefs/resourcesRefsTemplate/apiRef re-pointed to the scoped
 *     names, refs into real namespaces left intact, inputs never mutated;
 *   - owner-scoped names: DNS-1123, ≤63, unique per owner even when truncated, idempotent —
 *     and two owners previewing the SAME page write, sweep and tear down disjoint names;
 *   - op builders: ordered POSTs / best-effort DELETEs, ≤10-op chunks, the root
 *     draft's REAL /call widgetEndpoint;
 *   - the epoch-guarded teardown session (stale drawer-close = no-op).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { resetKindCacheForTests } from './kindResolver'
import {
  buildSandboxApplyOps,
  buildSandboxTeardownOps,
  buildSandboxWidgetEndpoint,
  chunkSetOps,
  createPreviewPageSession,
  draftGvrOf,
  primeDraftKinds,
  draftTargetsOf,
  ownerTagOf,
  PREVIEW_OWNER_LABEL,
  PREVIEW_PURPOSE_LABEL,
  PREVIEW_PURPOSE_VALUE,
  PREVIEW_SESSION_LABEL,
  RESTACTION_API_VERSION,
  rewriteDraftsForSandbox,
  rootDraftTargetOf,
  sandboxDraftName,
  validatePageDrafts,
  WIDGETS_API_VERSION,
} from './previewSandbox'

const BASE = 'http://snowplow.test'

/** snowplow's discovery-backed resolver, stubbed: a kind in the map resolves, anything else 404s. */
const fetchMock = vi.fn()
const stubNames = (plurals: Record<string, string>) => {
  fetchMock.mockImplementation((url: string) => {
    const kind = new URL(url).searchParams.get('kind') ?? ''
    const plural = plurals[kind]
    return Promise.resolve(plural
      ? { json: () => Promise.resolve({ plural }), ok: true, status: 200 }
      : { json: () => Promise.resolve({}), ok: false, status: 404 })
  })
}

beforeEach(async () => {
  resetKindCacheForTests()
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
  // The kinds this file's fixtures use. A test that cares about resolution overrides with stubNames.
  stubNames({
    Card: 'cards',
    Flex: 'flexes',
    Listy: 'listies',
    PageHeader: 'pageheaders',
    Paragraph: 'paragraphs',
    Progress: 'progresses',
    Table: 'tables',
  })
  // Prime globally, because the product primes before any sync builder runs: previewPageV2
  // validates (resolving as it goes) and only then rewrites and builds ops. A builder test against
  // an unprimed cache would assert a state the product never reaches.
  await primeDraftKinds(
    [{ kind: 'Card' }, { kind: 'Flex' }, { kind: 'Listy' }, { kind: 'PageHeader' },
      { kind: 'Paragraph' }, { kind: 'Progress' }, { kind: 'Table' }], BASE)
})

afterEach(() => vi.unstubAllGlobals())

const SANDBOX = 'krateo-preview'
const SESSION = 's_abc123'
const OWNER = 'alice'
/** The name a draft carries in the sandbox for OWNER — what every op below must name. */
const scoped = (name: string): string => sandboxDraftName(name, OWNER)

/** A schema-valid Flex root wired to a child paragraph (in-set) + a live RA (out-of-set). */
const flexRoot = (): Record<string, unknown> => ({
  apiVersion: WIDGETS_API_VERSION,
  kind: 'Flex',
  metadata: { name: 'page-preview-draft', namespace: 'krateo-system' },
  spec: {
    resourcesRefs: {
      items: [
        { allowed: true, apiVersion: WIDGETS_API_VERSION, id: 'p1', name: 'preview-draft-title', namespace: 'krateo-system', resource: 'paragraphs', verb: 'GET' },
        // Points at a LIVE production widget (not in this set) — must stay untouched.
        { allowed: true, apiVersion: WIDGETS_API_VERSION, id: 'live', name: 'app-shell-menu', namespace: 'krateo-system', resource: 'menus', verb: 'GET' },
      ],
    },
    widgetData: { allowedResources: ['paragraphs'], items: [{ resourceRefId: 'p1' }] },
  },
})

const paragraph = (name = 'preview-draft-title'): Record<string, unknown> => ({
  kind: 'Paragraph',
  metadata: { name },
  spec: {
    apiRef: { name: 'preview-projects', namespace: 'whatever-the-model-said' },
    widgetData: { text: 'Draft paragraph' },
  },
})

const restAction = (name = 'preview-projects'): Record<string, unknown> => ({
  apiVersion: RESTACTION_API_VERSION,
  kind: 'RESTAction',
  metadata: { name },
  spec: { api: [{ name: 'namespaces', path: '/api/v1/namespaces' }] },
})

describe('draftGvrOf — plurals discovered, not declared', () => {
  it('resolves a kind the cluster serves, IRREGULARS included', async () => {
    // `listies`/`progresses` are exactly why a pluralizer cannot do this and why the old table
    // existed. The API server knows them; nothing here has to.
    stubNames({ Flex: 'flexes', Listy: 'listies', Progress: 'progresses' })
    await primeDraftKinds([{ kind: 'Flex' }, { kind: 'Listy' }, { kind: 'Progress' }], BASE)
    expect(draftGvrOf('Flex')).toEqual({ group: 'widgets.templates.krateo.io', resource: 'flexes', version: 'v1beta1' })
    expect(draftGvrOf('Listy')?.resource).toBe('listies')
    expect(draftGvrOf('Progress')?.resource).toBe('progresses')
  })

  it('maps RESTAction WITHOUT asking — a different group with a plural this module owns', () => {
    fetchMock.mockClear()
    expect(draftGvrOf('RESTAction')).toEqual({ group: 'templates.krateo.io', resource: 'restactions', version: 'v1' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('a kind the cluster does not serve is null (deny-by-default, from the API server)', async () => {
    // every lookup 404s
    stubNames({})
    await primeDraftKinds([{ kind: 'Deployment' }, { kind: 'Drawer' }], BASE)
    expect(draftGvrOf('Deployment')).toBeNull()
    expect(draftGvrOf('Drawer')).toBeNull()
    expect(draftGvrOf('')).toBeNull()
  })

  it('an UNPRIMED kind is null — the failure direction is under-permit, never over-permit', () => {
    resetKindCacheForTests()
    expect(draftGvrOf('Flex')).toBeNull()
  })

  it('asks once per kind — the mapping is immutable, so the cache is permanent', async () => {
    resetKindCacheForTests()
    fetchMock.mockClear()
    stubNames({ Flex: 'flexes' })
    await primeDraftKinds([{ kind: 'Flex' }], BASE)
    await primeDraftKinds([{ kind: 'Flex' }], BASE)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('does NOT cache a transport failure as "unknown" — one blip must not refuse all session', async () => {
    resetKindCacheForTests()
    fetchMock.mockResolvedValue({ json: () => Promise.resolve({}), ok: false, status: 503 })
    await primeDraftKinds([{ kind: 'Flex' }], BASE)
    expect(draftGvrOf('Flex')).toBeNull()
    stubNames({ Flex: 'flexes' })
    await primeDraftKinds([{ kind: 'Flex' }], BASE)
    expect(draftGvrOf('Flex')?.resource).toBe('flexes')
  })
})

describe('validatePageDrafts — ajv over the co-located schemas', () => {
  it('a schema-valid set (Flex root + Paragraph + RESTAction) has NO problems', async () => {
    expect(await validatePageDrafts([flexRoot(), paragraph(), restAction()], BASE)).toEqual([])
  })

  it('an unknown kind is rejected with the draft identity in the line', async () => {
    const problems = await validatePageDrafts([{ kind: 'Gadget', metadata: { name: 'x' }, spec: {} }], BASE)
    expect(problems).toHaveLength(1)
    expect(problems[0]).toContain('widgets[0] (Gadget/x)')
    expect(problems[0]).toContain('unknown kind')
  })

  it('metadata.name is required and DNS-1123', async () => {
    expect(await validatePageDrafts([{ kind: 'Paragraph', spec: { widgetData: { text: 'x' } } }], BASE)).toHaveLength(1)
    const bad = await validatePageDrafts([{ kind: 'Paragraph', metadata: { name: 'Not-DNS' }, spec: { widgetData: { text: 'x' } } }], BASE)
    expect(bad[0]).toContain('DNS-1123')
  })

  it('a schema violation (Paragraph without widgetData.text) surfaces the ajv error path', async () => {
    const problems = await validatePageDrafts([{ kind: 'Paragraph', metadata: { name: 'p' }, spec: { widgetData: {} } }], BASE)
    expect(problems.length).toBeGreaterThan(0)
    expect(problems[0]).toContain('/spec/widgetData')
  })

  it('a wrong apiVersion is pinned to the kind\'s real coordinates', async () => {
    const draft = { ...paragraph(), apiVersion: 'widgets.templates.krateo.io/v1' }
    const problems = await validatePageDrafts([draft], BASE)
    expect(problems[0]).toContain(`apiVersion must be ${WIDGETS_API_VERSION}`)
  })

  it('RESTAction is validated structurally (no frontend schema — honest gap): spec required', async () => {
    expect(await validatePageDrafts([restAction()], BASE)).toEqual([])
    const problems = await validatePageDrafts([{ kind: 'RESTAction', metadata: { name: 'ra' } }], BASE)
    expect(problems[0]).toContain('spec is required')
  })

  it('duplicate (kind, name) pairs are rejected (the second POST would 409 mid-set)', async () => {
    const problems = await validatePageDrafts([paragraph('twin'), paragraph('twin')], BASE)
    expect(problems).toHaveLength(1)
    expect(problems[0]).toContain('duplicate draft — paragraphs/twin')
  })
})

describe('rewriteDraftsForSandbox — the A.2.2 rewrite', () => {
  it('FORCES metadata.namespace to the sandbox and stamps the preview labels', () => {
    const [root] = rewriteDraftsForSandbox([flexRoot()], SANDBOX, SESSION, OWNER)
    const metadata = root.metadata as { namespace: string; labels: Record<string, string>; name: string }
    expect(metadata.namespace).toBe(SANDBOX)
    expect(metadata.name).toBe(scoped('page-preview-draft'))
    expect(metadata.labels[PREVIEW_PURPOSE_LABEL]).toBe(PREVIEW_PURPOSE_VALUE)
    expect(metadata.labels[PREVIEW_SESSION_LABEL]).toBe(SESSION)
    // The draft-record kernel's owner label — same key, same value, so a listing filters on it.
    expect(PREVIEW_OWNER_LABEL).toBe('krateo.io/draft-owner')
    expect(metadata.labels[PREVIEW_OWNER_LABEL]).toBe(OWNER)
  })

  it('normalizes apiVersion per kind (widgets v1beta1, RESTAction templates v1)', () => {
    const [para, ra] = rewriteDraftsForSandbox([paragraph(), restAction()], SANDBOX, SESSION, OWNER)
    expect(para.apiVersion).toBe(WIDGETS_API_VERSION)
    expect(ra.apiVersion).toBe(RESTACTION_API_VERSION)
  })

  it('re-points resourcesRefs items at IN-SET drafts; refs into real namespaces stay intact', () => {
    const [root] = rewriteDraftsForSandbox([flexRoot(), paragraph()], SANDBOX, SESSION, OWNER)
    const { items } = (root.spec as { resourcesRefs: { items: { name: string; namespace: string }[] } }).resourcesRefs
    // The in-set child paragraph follows the drafts into the sandbox AND to its scoped name — a ref
    // that followed only the namespace would resolve to nothing and the page would render empty…
    expect(items[0].namespace).toBe(SANDBOX)
    expect(items[0].name).toBe(scoped('preview-draft-title'))
    // …the live production menu ref is untouched (reads stay RBAC-gated per-user).
    expect(items[1].namespace).toBe('krateo-system')
    expect(items[1].name).toBe('app-shell-menu')
  })

  it('every in-set ref names an object the set actually writes (nothing dangles after the rename)', () => {
    const table = {
      kind: 'Table',
      metadata: { name: 'rows-table' },
      spec: {
        resourcesRefsTemplate: [
          { iterator: '.items', template: { apiVersion: WIDGETS_API_VERSION, id: 'row', name: 'preview-draft-title', namespace: 'x', resource: 'paragraphs', verb: 'GET' } },
          { iterator: '.items', template: { apiVersion: WIDGETS_API_VERSION, id: 'ext', name: 'app-shell-menu', namespace: 'krateo-system', resource: 'menus', verb: 'GET' } },
        ],
      },
    }
    const rewritten = rewriteDraftsForSandbox([flexRoot(), paragraph(), restAction(), table], SANDBOX, SESSION, OWNER)
    const written = new Set(draftTargetsOf(rewritten).map(({ gvr, name }) => `${gvr.resource}/${name}`))
    const [root, para, , rewrittenTable] = rewritten as { spec: Record<string, unknown> }[]

    const [child] = (root.spec.resourcesRefs as { items: { name: string; resource: string }[] }).items
    expect(written.has(`${child.resource}/${child.name}`)).toBe(true)
    const apiRef = para.spec.apiRef as { name: string; namespace: string }
    expect(written.has(`restactions/${apiRef.name}`)).toBe(true)
    expect(apiRef.namespace).toBe(SANDBOX)
    const [inSet, external] = (rewrittenTable.spec.resourcesRefsTemplate as { template: { name: string; namespace: string; resource: string } }[])
      .map(({ template }) => template)
    expect(written.has(`${inSet.resource}/${inSet.name}`)).toBe(true)
    expect(inSet.namespace).toBe(SANDBOX)
    expect(external).toMatchObject({ name: 'app-shell-menu', namespace: 'krateo-system' })
  })

  it('re-points apiRef ONLY when the named RESTAction is in the set', () => {
    const [inSet] = rewriteDraftsForSandbox([paragraph(), restAction()], SANDBOX, SESSION, OWNER)
    expect((inSet.spec as { apiRef: { name: string; namespace: string } }).apiRef).toEqual({ name: scoped('preview-projects'), namespace: SANDBOX })

    const [external] = rewriteDraftsForSandbox([paragraph()], SANDBOX, SESSION, OWNER)
    expect((external.spec as { apiRef: { name: string; namespace: string } }).apiRef).toEqual({ name: 'preview-projects', namespace: 'whatever-the-model-said' })
  })

  it('is PURE — the input drafts are never mutated', () => {
    const original = flexRoot()
    const snapshot = JSON.parse(JSON.stringify(original)) as Record<string, unknown>
    rewriteDraftsForSandbox([original], SANDBOX, SESSION, OWNER)
    expect(original).toEqual(snapshot)
  })
})

describe('op builders — ordered POSTs, teardown DELETEs, chunks, root endpoint', () => {
  // LAZY, not module-level: a `const` here is evaluated at collection time, before beforeEach has
  // primed the kind cache, so draftTargetsOf would resolve only RESTAction (the one kind that needs
  // no discovery) and every assertion below would count one target instead of three.
  const fixture = () => {
    const rewritten = rewriteDraftsForSandbox([restAction(), flexRoot(), paragraph()], SANDBOX, SESSION, OWNER)
    return { rewritten, targets: draftTargetsOf(rewritten) }
  }

  it('one ordered POST per draft, payload = the rewritten CR, namespace = the sandbox', () => {
    const { rewritten } = fixture()
    const ops = buildSandboxApplyOps(rewritten, SANDBOX)
    expect(ops.map((op) => op.verb)).toEqual(['POST', 'POST', 'POST'])
    expect(ops.map((op) => op.gvr.resource)).toEqual(['restactions', 'flexes', 'paragraphs'])
    expect(ops.every((op) => op.namespace === SANDBOX)).toBe(true)
    expect(ops[1].payload).toBe(rewritten[1])
  })

  it('teardown = one DELETE per applied target (no payloads)', () => {
    const { targets } = fixture()
    const ops = buildSandboxTeardownOps(targets, SANDBOX)
    expect(ops.map((op) => op.verb)).toEqual(['DELETE', 'DELETE', 'DELETE'])
    expect(ops.map((op) => op.name)).toEqual([scoped('preview-projects'), scoped('page-preview-draft'), scoped('preview-draft-title')])
    expect(ops.every((op) => op.payload === undefined)).toBe(true)
  })

  it('chunks the ordered ops at the ≤10-op fabric cap', () => {
    const many = buildSandboxApplyOps(
      rewriteDraftsForSandbox(Array.from({ length: 12 }, (_, index) => paragraph(`p-${index}`)), SANDBOX, SESSION, OWNER),
      SANDBOX,
    )
    const chunks = chunkSetOps(many)
    expect(chunks.map((chunk) => chunk.length)).toEqual([10, 2])
    expect(chunks[1][1].name).toBe(scoped('p-11'))
  })

  it('the ROOT is the page-<slug> Flex — the page ENTRY (its INIT), never inferred from order', () => {
    const { targets } = fixture()
    expect(rootDraftTargetOf(targets)?.name).toBe(scoped('page-preview-draft'))
    // a child listed FIRST never becomes the entry — the page-* Flex wins regardless of order
    const childFirst = draftTargetsOf(rewriteDraftsForSandbox([paragraph('heading-first'), flexRoot()], SANDBOX, SESSION, OWNER))
    expect(rootDraftTargetOf(childFirst)?.name).toBe(scoped('page-preview-draft'))
    // no page-* root Flex → NO entry: never guess (a lone child/RESTAction set has no page to mount)
    const dataOnly = draftTargetsOf(rewriteDraftsForSandbox([restAction()], SANDBOX, SESSION, OWNER))
    expect(rootDraftTargetOf(dataOnly)).toBeNull()
    const noPageRoot = draftTargetsOf(rewriteDraftsForSandbox([paragraph('heading-only')], SANDBOX, SESSION, OWNER))
    expect(rootDraftTargetOf(noPageRoot)).toBeNull()
  })

  it('builds the root\'s REAL /call widgetEndpoint exactly like resourcesRefs paths', () => {
    const root = rootDraftTargetOf(fixture().targets)
    expect(root && buildSandboxWidgetEndpoint(root, SANDBOX)).toBe(
      `/call?resource=flexes&apiVersion=widgets.templates.krateo.io/v1beta1&name=${scoped('page-preview-draft')}&namespace=krateo-preview`,
    )
  })
})

describe('sandboxDraftName — owner-scoped names in the shared sandbox', () => {
  const DNS1123 = /^[a-z0-9]([-a-z0-9.]*[a-z0-9])?$/

  it('is <name>-<8 hex of the owner>: the page- prefix survives, so the root is still found', () => {
    expect(ownerTagOf(OWNER)).toMatch(/^[0-9a-f]{8}$/)
    expect(sandboxDraftName('page-my-page', OWNER)).toBe(`page-my-page-${ownerTagOf(OWNER)}`)
  })

  it('stays DNS-1123 and within 63 characters, however long the name', () => {
    for (const name of ['a', 'page-x', `page-${'a'.repeat(58)}`, `page-${'b'.repeat(200)}`, `${'c'.repeat(44)}-.-${'d'.repeat(30)}`]) {
      const out = sandboxDraftName(name, OWNER)
      expect(out.length).toBeLessThanOrEqual(63)
      expect(out).toMatch(DNS1123)
      expect(out.endsWith(`-${ownerTagOf(OWNER)}`)).toBe(true)
    }
  })

  it('two long names sharing a prefix stay DISTINCT after truncation (the cut is hashed)', () => {
    const head = `page-${'a'.repeat(60)}`
    const one = sandboxDraftName(`${head}-one`, OWNER)
    const two = sandboxDraftName(`${head}-two`, OWNER)
    expect(one).not.toBe(two)
    expect(one.startsWith('page-aaaa')).toBe(true)
  })

  it('is IDEMPOTENT — scoping an already-scoped name does not stack tags', () => {
    const once = sandboxDraftName('page-my-page', OWNER)
    expect(sandboxDraftName(once, OWNER)).toBe(once)
    const long = sandboxDraftName(`page-${'z'.repeat(90)}`, OWNER)
    expect(sandboxDraftName(long, OWNER)).toBe(long)
  })

  it('gives owners whose raw names would run together different tags (a suffix of the owner would not)', () => {
    // `x` by alice-bob and `x-alice` by bob are the same string with a raw-owner suffix.
    expect(sandboxDraftName('x', 'alice-bob')).not.toBe(sandboxDraftName('x-alice', 'bob'))
  })
})

describe('two owners previewing the SAME page never touch each other\'s objects', () => {
  /**
   * THE COLLISION THIS SLICE EXISTS FOR. The sandbox is shared, and a page's draft names are
   * derived from the page. The pre-apply sweep (previewPageV2) is `buildSandboxTeardownOps(targets)`
   * — every name this apply is about to write — and the 409 reclaim deletes the one name in the way.
   * With unscoped names, alice's sweep of `my-page` named bob's `page-my-page` and deleted his live
   * preview. Both are built from the same targets tested here, so disjoint targets ARE the guarantee.
   */
  const setOf = (owner: string) => rewriteDraftsForSandbox([restAction(), flexRoot(), paragraph()], SANDBOX, SESSION, owner)
  const namesOf = (ops: readonly { name?: string }[]) => new Set(ops.map(({ name }) => name ?? ''))

  it('alice\'s sweep, apply and teardown never name one of bob\'s objects', () => {
    const alice = draftTargetsOf(setOf('alice'))
    const bob = draftTargetsOf(setOf('bob'))
    const aliceSweep = namesOf(buildSandboxTeardownOps(alice, SANDBOX))
    const aliceApply = namesOf(buildSandboxApplyOps(setOf('alice'), SANDBOX))
    const bobWrites = namesOf(buildSandboxApplyOps(setOf('bob'), SANDBOX))

    expect(bobWrites.size).toBe(3)
    for (const name of bobWrites) {
      expect(aliceSweep.has(name)).toBe(false)
      expect(aliceApply.has(name)).toBe(false)
    }
    // …and each owner's root — the live endpoint each drawer mounts — is their own.
    expect(rootDraftTargetOf(alice)?.name).not.toBe(rootDraftTargetOf(bob)?.name)
    // The sweep still covers every name alice writes (the no-409 guarantee is unchanged for her).
    expect([...aliceSweep].sort()).toEqual([...aliceApply].sort())
  })
})

describe('createPreviewPageSession — epoch-guarded drawer-close teardown', () => {
  const someOps = () => buildSandboxTeardownOps(draftTargetsOf(rewriteDraftsForSandbox([paragraph()], SANDBOX, SESSION, OWNER)), SANDBOX)

  it('record → takeIf(current epoch) returns the ops ONCE (second close is a no-op)', () => {
    const session = createPreviewPageSession()
    const epoch = session.record(someOps())
    expect(session.takeIf(epoch)).toHaveLength(1)
    expect(session.takeIf(epoch)).toEqual([])
  })

  it('a STALE epoch never takes the newer preview\'s ops', () => {
    const session = createPreviewPageSession()
    const stale = session.record(someOps())
    const fresh = session.record(someOps())
    expect(session.takeIf(stale)).toEqual([])
    expect(session.takeIf(fresh)).toHaveLength(1)
  })

  it('take() is the pre-apply sweep: whatever is held, cleared unconditionally', () => {
    const session = createPreviewPageSession()
    session.record(someOps())
    expect(session.take()).toHaveLength(1)
    expect(session.take()).toEqual([])
  })
})
