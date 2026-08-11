/**
 * Reproduction + regression guard for krateo-platformops/frontend#42 (W3-2 `ops[]` dispatches
 * SCALAR instead of the N-object set) — AND its sibling W3-1 `fanOutPath` (never confirmed
 * live either; same set-fabric family, so this pins BOTH).
 *
 * ROOT CAUSE of the live incident (investigated, not a frontend logic bug): the cluster ran
 * the UPSTREAM image `ghcr.io/krateoplatformops/frontend:1.3.19` (KrateoFrontend CR
 * `spec.image.repository` was overridden away from the fork `ghcr.io/krateo-platformops/frontend`),
 * whose 1.3.19 predates the ops feature → it takes the scalar path. Served-data + fork-source
 * were BOTH correct; the runtime was simply a DIFFERENT image (the version number 1.3.19
 * collided). This test is the CI guard that the fork's dispatch keeps working end-to-end, so a
 * future normalization/strip/type-regen that quietly drops `ops`/`fanOutPath` between the served
 * JSON and dispatch is caught here (runRestOps.test.ts / useHandleActions.test.ts cover the
 * dispatch semantics at the boundary; THIS covers the served-JSON → parse → select → dispatch
 * plumbing a boundary test cannot see).
 *
 * It feeds the EXACT served Widget JSON through WidgetRenderer.parseWidget (the same destructure
 * the runtime uses), then Form's real submit-action selection
 * (`Object.values(actions).flat().find(id===submitActionId)`), then the REAL
 * dispatchAction → runRest with a mocked ActionContext — asserting the SET path fires (N writes,
 * resolved names), never a scalar empty-name write.
 */
/* eslint-disable no-template-curly-in-string -- fixtures intentionally use literal ${...} (the authored jq-override DSL). */
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { ResourcesRefs, Widget, WidgetAction } from '../types/Widget'
import type { FormWidgetData } from '../widgets/Form/Form'

import { dispatchAction, type ActionContext } from './useHandleActions'

// The EXACT served access-grant Widget snowplow returns for the CR at
// krateo-portal-chart chart/templates/form.access-grant.yaml. rest[0] has
// ops:[create-role, create-rolebinding]; each op carries its own payload +
// payloadToOverride; the top-level payloadToOverride is ABSENT (the ops carry it).
const makeAccessGrantWidget = (): Widget => ({
  apiVersion: 'widgets.templates.krateo.io/v1beta1',
  kind: 'Form',
  metadata: { annotations: {}, creationTimestamp: '2026-01-01T00:00:00Z', generation: 1, name: 'access-grant', namespace: 'krateo-system', resourceVersion: '1', uid: 'uid-access-grant' },
  spec: {} as never,
  status: {
    actions: {},
    resourcesRefs: {
      items: [
        { allowed: true, id: 'create-role', path: '/call?apiVersion=rbac.authorization.k8s.io%2Fv1&resource=roles', payload: {}, verb: 'POST' },
        { allowed: true, id: 'create-rolebinding', path: '/call?apiVersion=rbac.authorization.k8s.io%2Fv1&resource=rolebindings', payload: {}, verb: 'POST' },
      ],
    },
    widgetData: {
      actions: {
        rest: [
          {
            errorMessage: 'Grant failed',
            headers: ['Content-Type: application/json'],
            id: 'submit',
            loading: { display: true },
            ops: [
              {
                payload: { apiVersion: 'rbac.authorization.k8s.io/v1', kind: 'Role' },
                payloadToOverride: [
                  { name: 'metadata.name', value: '${ "krateo-access-" + .json.subjectName + "-" + .json.namespace }' },
                  { name: 'metadata.namespace', value: '${ .json.namespace }' },
                ],
                resourceRefId: 'create-role',
              },
              {
                payload: { apiVersion: 'rbac.authorization.k8s.io/v1', kind: 'RoleBinding' },
                payloadToOverride: [
                  { name: 'metadata.name', value: '${ "krateo-access-" + .json.subjectName + "-" + .json.namespace }' },
                  { name: 'metadata.namespace', value: '${ .json.namespace }' },
                ],
                resourceRefId: 'create-rolebinding',
              },
            ],
            resourceRefId: 'create-role',
            successMessage: 'Access granted',
            type: 'rest',
          },
        ],
      },
      buttonConfig: { primary: { label: 'Grant access' } },
      layout: 'vertical',
      submitActionId: 'submit',
    },
  },
} as unknown as Widget)

// A fleet-rollout-shaped served Form (W3-1 `fanOutPath`): one submit fans out over the
// `clusters` array field into ONE ordered write per element via the SAME set fabric. Same
// served-JSON → parse → select → dispatch chain as the access-grant fixture, so it guards
// the sibling set-fabric path #42 flagged as also never confirmed live.
const makeFleetRolloutWidget = (): Widget => ({
  apiVersion: 'widgets.templates.krateo.io/v1beta1',
  kind: 'Form',
  metadata: { annotations: {}, creationTimestamp: '2026-01-01T00:00:00Z', generation: 1, name: 'fleet-rollout', namespace: 'krateo-system', resourceVersion: '1', uid: 'uid-fleet' },
  spec: {} as never,
  status: {
    actions: {},
    resourcesRefs: {
      items: [
        { allowed: true, id: 'create-composition', path: '/call?apiVersion=core.krateo.io%2Fv1alpha1&resource=compositiondefinitions', payload: {}, verb: 'POST' },
      ],
    },
    widgetData: {
      actions: {
        rest: [
          {
            fanOutPath: 'clusters',
            headers: ['Content-Type: application/json'],
            id: 'rollout',
            onSuccessNavigateTo: '/compositions',
            payload: { apiVersion: 'core.krateo.io/v1alpha1', kind: 'CompositionDefinition' },
            payloadToOverride: [
              { name: 'metadata.name', value: '${ .json.name + "-" + .json.clusters }' },
              { name: 'metadata.namespace', value: 'krateo-system' },
              { name: 'spec.deploy.targetRef.name', value: '${ .json.clusters }' },
            ],
            resourceRefId: 'create-composition',
            type: 'rest',
          },
        ],
      },
      layout: 'vertical',
      submitActionId: 'rollout',
    },
  },
} as unknown as Widget)

/**
 * The runtime destructure WidgetRenderer.parseWidget performs to feed the Form widget:
 * `widgetData` comes from `status.widgetData`, `resourcesRefs.items` is FILTERED to the
 * allowed refs (parseWidget line ~66). Mirroring it here proves ops survives THAT step.
 */
const parseForForm = (widget: Widget): { widgetData: FormWidgetData; resourcesRefs: ResourcesRefs } => {
  if (typeof widget.status === 'string') { throw new Error('string status') }
  const { resourcesRefs, widgetData } = widget.status
  return {
    resourcesRefs: { ...resourcesRefs, items: resourcesRefs?.items?.filter(({ allowed }) => allowed) ?? [] } as ResourcesRefs,
    widgetData: widgetData as FormWidgetData,
  }
}

/** Form's exact submit-action selection (Form.tsx). */
const selectSubmitAction = (widgetData: FormWidgetData): WidgetAction | undefined =>
  Object.values(widgetData.actions).flat().find(({ id }) => id === widgetData.submitActionId) as WidgetAction | undefined

// Fully-mocked ActionContext (same shape as runRestOps.test.ts) so dispatch runs headless.
const makeCtx = (over: Partial<ActionContext> = {}): ActionContext => ({
  apiBaseUrl: 'http://sp',
  closeDrawer: vi.fn(),
  confirm: vi.fn(() => Promise.resolve(true)),
  eventsBaseUrl: 'http://ev',
  getAccessToken: vi.fn(() => 'tok'),
  invalidateQueries: vi.fn(() => Promise.resolve()),
  message: { destroy: vi.fn(), loading: vi.fn() } as unknown as ActionContext['message'],
  navigate: vi.fn(),
  notification: { error: vi.fn(), success: vi.fn() } as unknown as ActionContext['notification'],
  openDrawer: vi.fn(),
  openModal: vi.fn(),
  provenanceEnabled: false,
  registerCleanup: vi.fn(),
  reloadRoutes: vi.fn(),
  resolveJq: vi.fn((expr: string, vals: Record<string, unknown>) => {
    const json = (vals.json ?? {}) as Record<string, string>
    // access-grant expressions
    if (expr.includes('krateo-access')) { return Promise.resolve(`krateo-access-${json.subjectName}-${json.namespace}`) }
    if (expr.includes('.json.namespace')) { return Promise.resolve(json.namespace) }
    // fleet-rollout expressions: name = <name>-<cluster>, targetRef = <cluster>
    if (expr.includes('.json.name')) { return Promise.resolve(`${json.name}-${json.clusters}`) }
    if (expr.includes('.json.clusters')) { return Promise.resolve(json.clusters) }
    return Promise.resolve('')
  }),
  setLoading: vi.fn(),
  ...over,
})

const fakeResponse = (ok: boolean, body: string): Response =>
  ({ ok, status: ok ? 201 : 400, text: () => Promise.resolve(body) } as unknown as Response)

afterEach(() => { vi.unstubAllGlobals() })

describe('access-grant Form dispatches the ops[] SET, not a scalar write (issue #42)', () => {
  it('ops survives served-JSON → parseWidget → submit-action select, and dispatches TWO POSTs (Role + RoleBinding), not a scalar empty-name Role', async () => {
    // 1. Served JSON → parseWidget destructure (widgetData from status, refs filtered to allowed).
    const widget = makeAccessGrantWidget()
    const { resourcesRefs, widgetData } = parseForForm(widget)

    // 2. Form's submit-action selection. The selected action MUST still carry ops (the shape seam).
    const action = selectSubmitAction(widgetData)
    expect(action, 'submit action resolved').toBeTruthy()
    expect(action!.type).toBe('rest')
    expect((action as WidgetAction & { ops?: unknown[] }).ops, 'ops[] survived served-JSON → parse → select').toBeTruthy()
    expect((action as WidgetAction & { ops?: unknown[] }).ops).toHaveLength(2)

    // 3. Real dispatch through dispatchAction → runRest with the submitted form values.
    const fetchMock = vi.fn(() => Promise.resolve(fakeResponse(true, '{}')))
    vi.stubGlobal('fetch', fetchMock)
    const confirm = vi.fn(() => Promise.resolve(true))
    const ctx = makeCtx({ confirm })

    await dispatchAction(
      action!,
      { customPayload: { namespace: 'team-a', subjectName: 'alice' }, resourcesRefs },
      ctx,
    )

    // ONE aggregated set confirm, TWO POSTs (roles + rolebindings) — the ops[] path.
    expect(confirm).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    const urls = fetchMock.mock.calls.map((call) => (call as unknown as [string])[0])
    const roleUrl = urls.find((url) => url.includes('resource=roles'))
    const bindingUrl = urls.find((url) => url.includes('resource=rolebindings'))
    expect(roleUrl, 'a POST to roles fired').toBeTruthy()
    expect(bindingUrl, 'a POST to rolebindings fired').toBeTruthy()

    // Resolved names (NOT the empty-name scalar symptom).
    expect(roleUrl).toContain('name=krateo-access-alice-team-a')
    expect(roleUrl).not.toContain('name=&')
    const bodies = fetchMock.mock.calls.map((call) => JSON.parse(((call as unknown as [string, { body: string }])[1]).body) as { kind: string; metadata: { name: string } })
    const roleBody = bodies.find((body) => body.kind === 'Role')
    const bindingBody = bodies.find((body) => body.kind === 'RoleBinding')
    expect(roleBody?.metadata.name).toBe('krateo-access-alice-team-a')
    expect(bindingBody?.metadata.name).toBe('krateo-access-alice-team-a')
  })
})

describe('fleet-rollout Form dispatches the fanOutPath SET, not a scalar write (issue #42, shared set-fabric)', () => {
  it('fanOutPath survives served-JSON → parseWidget → submit-action select, and fans out ONE POST per cluster (resolved names)', async () => {
    const widget = makeFleetRolloutWidget()
    const { resourcesRefs, widgetData } = parseForForm(widget)

    const action = selectSubmitAction(widgetData)
    expect(action, 'submit action resolved').toBeTruthy()
    expect(action!.type).toBe('rest')
    // The fanOutPath field must survive the served-JSON → parse → select chain (the shape seam).
    expect((action as WidgetAction & { fanOutPath?: string }).fanOutPath, 'fanOutPath survived served-JSON → parse → select').toBe('clusters')

    const fetchMock = vi.fn(() => Promise.resolve(fakeResponse(true, '{}')))
    vi.stubGlobal('fetch', fetchMock)
    const confirm = vi.fn(() => Promise.resolve(true))
    const ctx = makeCtx({ confirm })

    await dispatchAction(
      action!,
      { customPayload: { clusters: ['spoke-a', 'spoke-b'], name: 'demo' }, resourcesRefs },
      ctx,
    )

    // ONE aggregated set confirm, ONE POST per cluster element — the fanOutPath SET path,
    // not a single scalar write of the raw (array-valued) submit.
    expect(confirm).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    const urls = fetchMock.mock.calls.map((call) => (call as unknown as [string])[0])
    expect(urls[0]).toContain('name=demo-spoke-a')
    expect(urls[1]).toContain('name=demo-spoke-b')
    expect(urls[0]).not.toContain('name=&')
    const bodies = fetchMock.mock.calls.map((call) => JSON.parse(((call as unknown as [string, { body: string }])[1]).body) as { metadata: { name: string }; spec: { deploy: { targetRef: { name: string } } } })
    expect(bodies[0].metadata.name).toBe('demo-spoke-a')
    expect(bodies[0].spec.deploy.targetRef.name).toBe('spoke-a')
    expect(bodies[1].spec.deploy.targetRef.name).toBe('spoke-b')
    // Full success → the set redirect (fanOut goes through runRestFanOut → runRestSet).
    expect(ctx.navigate).toHaveBeenCalledWith('/compositions')
  })
})
