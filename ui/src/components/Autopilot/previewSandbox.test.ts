/**
 * W4 previewPage v2 (FE-P4) — the pure sandbox-draft toolkit. Pure-logic coverage
 * (no RTL/jsdom), matching the repo's other Autopilot tests. Proves:
 *   - kind→GVR mapping (the verbatim CRD plural table incl. the irregulars) and the
 *     deny-by-default on unknown kinds;
 *   - validatePageDrafts: ajv over the REAL co-located schemas (envelope + required
 *     widgetData props), DNS-1123 names, apiVersion pinning, the RESTAction
 *     structural fallback, duplicate rejection;
 *   - the A.2.2 rewrite: namespace FORCED, preview labels stamped, in-set
 *     resourcesRefs/apiRef re-pointed, refs into real namespaces left intact,
 *     inputs never mutated;
 *   - op builders: ordered POSTs / best-effort DELETEs, ≤10-op chunks, the root
 *     draft's REAL /call widgetEndpoint;
 *   - the epoch-guarded teardown session (stale drawer-close = no-op).
 */
import { describe, expect, it } from 'vitest'

import {
  buildSandboxApplyOps,
  buildSandboxTeardownOps,
  buildSandboxWidgetEndpoint,
  chunkSetOps,
  createPreviewPageSession,
  draftGvrOf,
  draftTargetsOf,
  PREVIEW_PURPOSE_LABEL,
  PREVIEW_PURPOSE_VALUE,
  PREVIEW_SESSION_LABEL,
  RESTACTION_API_VERSION,
  rewriteDraftsForSandbox,
  rootDraftTargetOf,
  validatePageDrafts,
  WIDGET_KIND_PLURALS,
  WIDGETS_API_VERSION,
} from './previewSandbox'

const SANDBOX = 'krateo-preview'
const SESSION = 's_abc123'

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

describe('draftGvrOf — the verbatim CRD plural table', () => {
  it('maps regular and IRREGULAR kinds to their real CRD plurals', () => {
    expect(draftGvrOf('Flex')).toEqual({ group: 'widgets.templates.krateo.io', resource: 'flexes', version: 'v1beta1' })
    expect(draftGvrOf('Listy')).toEqual({ group: 'widgets.templates.krateo.io', resource: 'listies', version: 'v1beta1' })
    expect(draftGvrOf('Progress')?.resource).toBe('progresses')
    expect(draftGvrOf('Tabs')?.resource).toBe('tabs')
    expect(draftGvrOf('Checkbox')?.resource).toBe('checkboxes')
  })

  it('maps RESTAction to templates.krateo.io/v1 restactions', () => {
    expect(draftGvrOf('RESTAction')).toEqual({ group: 'templates.krateo.io', resource: 'restactions', version: 'v1' })
  })

  it('unknown kinds are null (deny-by-default) — incl. the reserved k8s List and overlays', () => {
    expect(draftGvrOf('List')).toBeNull()
    expect(draftGvrOf('Drawer')).toBeNull()
    expect(draftGvrOf('Deployment')).toBeNull()
    expect(draftGvrOf('')).toBeNull()
  })

  it('has entries at all — the COUNT is pinned against the CRDs, not a literal', () => {
    // This used to assert `toHaveLength(42)`, and that is why the table could lose `PageHeader`
    // and `Theme` without a test noticing: a count compares the table to ITSELF AS IT WAS, so it
    // locks in a gap as firmly as it locks in the contents. It passed throughout, while every
    // hand-started page was rejected with "unknown kind".
    //
    // The real assertion — every shipped CRD kind is present, with its own plural, and nothing is
    // invented — lives in previewSandbox.kinds.test.ts, where it is checked against the chart's
    // CRDs rather than against a number someone has to remember to update.
    expect(Object.keys(WIDGET_KIND_PLURALS).length).toBeGreaterThan(30)
  })
})

describe('validatePageDrafts — ajv over the co-located schemas', () => {
  it('a schema-valid set (Flex root + Paragraph + RESTAction) has NO problems', async () => {
    expect(await validatePageDrafts([flexRoot(), paragraph(), restAction()])).toEqual([])
  })

  it('an unknown kind is rejected with the draft identity in the line', async () => {
    const problems = await validatePageDrafts([{ kind: 'Gadget', metadata: { name: 'x' }, spec: {} }])
    expect(problems).toHaveLength(1)
    expect(problems[0]).toContain('widgets[0] (Gadget/x)')
    expect(problems[0]).toContain('unknown kind')
  })

  it('metadata.name is required and DNS-1123', async () => {
    expect(await validatePageDrafts([{ kind: 'Paragraph', spec: { widgetData: { text: 'x' } } }])).toHaveLength(1)
    const bad = await validatePageDrafts([{ kind: 'Paragraph', metadata: { name: 'Not-DNS' }, spec: { widgetData: { text: 'x' } } }])
    expect(bad[0]).toContain('DNS-1123')
  })

  it('a schema violation (Paragraph without widgetData.text) surfaces the ajv error path', async () => {
    const problems = await validatePageDrafts([{ kind: 'Paragraph', metadata: { name: 'p' }, spec: { widgetData: {} } }])
    expect(problems.length).toBeGreaterThan(0)
    expect(problems[0]).toContain('/spec/widgetData')
  })

  it('a wrong apiVersion is pinned to the kind\'s real coordinates', async () => {
    const draft = { ...paragraph(), apiVersion: 'widgets.templates.krateo.io/v1' }
    const problems = await validatePageDrafts([draft])
    expect(problems[0]).toContain(`apiVersion must be ${WIDGETS_API_VERSION}`)
  })

  it('RESTAction is validated structurally (no frontend schema — honest gap): spec required', async () => {
    expect(await validatePageDrafts([restAction()])).toEqual([])
    const problems = await validatePageDrafts([{ kind: 'RESTAction', metadata: { name: 'ra' } }])
    expect(problems[0]).toContain('spec is required')
  })

  it('duplicate (kind, name) pairs are rejected (the second POST would 409 mid-set)', async () => {
    const problems = await validatePageDrafts([paragraph('twin'), paragraph('twin')])
    expect(problems).toHaveLength(1)
    expect(problems[0]).toContain('duplicate draft — paragraphs/twin')
  })
})

describe('rewriteDraftsForSandbox — the A.2.2 rewrite', () => {
  it('FORCES metadata.namespace to the sandbox and stamps the preview labels', () => {
    const [root] = rewriteDraftsForSandbox([flexRoot()], SANDBOX, SESSION)
    const metadata = root.metadata as { namespace: string; labels: Record<string, string>; name: string }
    expect(metadata.namespace).toBe(SANDBOX)
    expect(metadata.name).toBe('page-preview-draft')
    expect(metadata.labels[PREVIEW_PURPOSE_LABEL]).toBe(PREVIEW_PURPOSE_VALUE)
    expect(metadata.labels[PREVIEW_SESSION_LABEL]).toBe(SESSION)
  })

  it('normalizes apiVersion per kind (widgets v1beta1, RESTAction templates v1)', () => {
    const [para, ra] = rewriteDraftsForSandbox([paragraph(), restAction()], SANDBOX, SESSION)
    expect(para.apiVersion).toBe(WIDGETS_API_VERSION)
    expect(ra.apiVersion).toBe(RESTACTION_API_VERSION)
  })

  it('re-points resourcesRefs items at IN-SET drafts; refs into real namespaces stay intact', () => {
    const [root] = rewriteDraftsForSandbox([flexRoot(), paragraph()], SANDBOX, SESSION)
    const { items } = (root.spec as { resourcesRefs: { items: { name: string; namespace: string }[] } }).resourcesRefs
    // The in-set child paragraph follows the drafts into the sandbox…
    expect(items[0].namespace).toBe(SANDBOX)
    // …the live production menu ref is untouched (reads stay RBAC-gated per-user).
    expect(items[1].namespace).toBe('krateo-system')
  })

  it('re-points apiRef ONLY when the named RESTAction is in the set', () => {
    const [inSet] = rewriteDraftsForSandbox([paragraph(), restAction()], SANDBOX, SESSION)
    expect((inSet.spec as { apiRef: { namespace: string } }).apiRef.namespace).toBe(SANDBOX)

    const [external] = rewriteDraftsForSandbox([paragraph()], SANDBOX, SESSION)
    expect((external.spec as { apiRef: { namespace: string } }).apiRef.namespace).toBe('whatever-the-model-said')
  })

  it('is PURE — the input drafts are never mutated', () => {
    const original = flexRoot()
    const snapshot = JSON.parse(JSON.stringify(original)) as Record<string, unknown>
    rewriteDraftsForSandbox([original], SANDBOX, SESSION)
    expect(original).toEqual(snapshot)
  })
})

describe('op builders — ordered POSTs, teardown DELETEs, chunks, root endpoint', () => {
  const rewritten = rewriteDraftsForSandbox([restAction(), flexRoot(), paragraph()], SANDBOX, SESSION)
  const targets = draftTargetsOf(rewritten)

  it('one ordered POST per draft, payload = the rewritten CR, namespace = the sandbox', () => {
    const ops = buildSandboxApplyOps(rewritten, SANDBOX)
    expect(ops.map((op) => op.verb)).toEqual(['POST', 'POST', 'POST'])
    expect(ops.map((op) => op.gvr.resource)).toEqual(['restactions', 'flexes', 'paragraphs'])
    expect(ops.every((op) => op.namespace === SANDBOX)).toBe(true)
    expect(ops[1].payload).toBe(rewritten[1])
  })

  it('teardown = one DELETE per applied target (no payloads)', () => {
    const ops = buildSandboxTeardownOps(targets, SANDBOX)
    expect(ops.map((op) => op.verb)).toEqual(['DELETE', 'DELETE', 'DELETE'])
    expect(ops.map((op) => op.name)).toEqual(['preview-projects', 'page-preview-draft', 'preview-draft-title'])
    expect(ops.every((op) => op.payload === undefined)).toBe(true)
  })

  it('chunks the ordered ops at the ≤10-op fabric cap', () => {
    const many = buildSandboxApplyOps(
      rewriteDraftsForSandbox(Array.from({ length: 12 }, (_, index) => paragraph(`p-${index}`)), SANDBOX, SESSION),
      SANDBOX,
    )
    const chunks = chunkSetOps(many)
    expect(chunks.map((chunk) => chunk.length)).toEqual([10, 2])
    expect(chunks[1][1].name).toBe('p-11')
  })

  it('the ROOT is the page-<slug> Flex — the page ENTRY (its INIT), never inferred from order', () => {
    expect(rootDraftTargetOf(targets)?.name).toBe('page-preview-draft')
    // a child listed FIRST never becomes the entry — the page-* Flex wins regardless of order
    const childFirst = draftTargetsOf(rewriteDraftsForSandbox([paragraph('heading-first'), flexRoot()], SANDBOX, SESSION))
    expect(rootDraftTargetOf(childFirst)?.name).toBe('page-preview-draft')
    // no page-* root Flex → NO entry: never guess (a lone child/RESTAction set has no page to mount)
    const dataOnly = draftTargetsOf(rewriteDraftsForSandbox([restAction()], SANDBOX, SESSION))
    expect(rootDraftTargetOf(dataOnly)).toBeNull()
    const noPageRoot = draftTargetsOf(rewriteDraftsForSandbox([paragraph('heading-only')], SANDBOX, SESSION))
    expect(rootDraftTargetOf(noPageRoot)).toBeNull()
  })

  it('builds the root\'s REAL /call widgetEndpoint exactly like resourcesRefs paths', () => {
    const root = rootDraftTargetOf(targets)
    expect(root && buildSandboxWidgetEndpoint(root, SANDBOX)).toBe(
      '/call?resource=flexes&apiVersion=widgets.templates.krateo.io/v1beta1&name=page-preview-draft&namespace=krateo-preview',
    )
  })
})

describe('createPreviewPageSession — epoch-guarded drawer-close teardown', () => {
  const someOps = () => buildSandboxTeardownOps(draftTargetsOf(rewriteDraftsForSandbox([paragraph()], SANDBOX, SESSION)), SANDBOX)

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
