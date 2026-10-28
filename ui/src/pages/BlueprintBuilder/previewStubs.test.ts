import { describe, expect, it } from 'vitest'

import { ARCHITECTURE_TEMPLATE_PATH, wrapAsConfigMapTemplate } from './architecture'
import { previewLookupStubs, standInSummary } from './previewStubs'

const tree = (descriptor: string): Record<string, string> => ({
  [ARCHITECTURE_TEMPLATE_PATH]: wrapAsConfigMapTemplate(descriptor, 'demo'),
  'Chart.yaml': 'apiVersion: v2\nname: demo\nversion: 0.1.0\n',
})

const descriptor = (resources: string): string => `apiVersion: architecture.krateo.io/v1alpha1
kind: ChartArchitecture
chart: demo
resources:
${resources}`

const stubsOf = (resources: string) => previewLookupStubs(tree(descriptor(resources)))

describe('previewLookupStubs', () => {
  it('stands in for each kind an edge depends on — the dependent itself needs none', () => {
    const stubs = stubsOf(`  - { id: config, class: native, apiVersion: v1, kind: ConfigMap, template: templates/configmap.yaml, name: demo-config }
  - id: app
    class: native
    apiVersion: apps/v1
    kind: Deployment
    template: templates/deployment.yaml
    name: demo-app
    dependsOn: [{ ref: config }]
`)
    expect(stubs).toEqual([{ apiVersion: 'v1', kind: 'ConfigMap', object: {} }])
  })

  it('shapes a field readyWhen so its guard reads it as set', () => {
    const stubs = stubsOf(`  - { id: repo, class: custom, apiVersion: github.krateo.io/v1alpha1, kind: Repository, template: templates/repo.yaml, name: demo-repo, readyWhen: .status.default_branch }
  - { id: app, class: native, apiVersion: apps/v1, kind: Deployment, template: templates/app.yaml, name: demo-app, dependsOn: [{ ref: repo, ready: true }] }
`)
    expect(stubs).toEqual([{ apiVersion: 'github.krateo.io/v1alpha1', kind: 'Repository', object: { status: { default_branch: 'preview' } } }])
  })

  it('shapes a condition readyWhen, and a composition by Ready and Synced', () => {
    const stubs = stubsOf(`  - { id: db, class: composition, apiVersion: composition.krateo.io/v0-1-0, kind: Database, template: templates/db.yaml, name: db }
  - id: bucket
    class: custom
    apiVersion: s3.aws.krateo.io/v1
    kind: Bucket
    template: templates/bucket.yaml
    name: b
    readyWhen: '.status.conditions[] | select(.type == "Available") | .status == "True"'
  - { id: app, class: native, apiVersion: apps/v1, kind: Deployment, template: templates/app.yaml, name: app, dependsOn: [{ ref: db, ready: true }, { ref: bucket, ready: true }] }
`)
    expect(stubs).toEqual([
      { apiVersion: 'composition.krateo.io/v0-1-0', kind: 'Database', object: { status: { conditions: [{ status: 'True', type: 'Ready' }, { status: 'True', type: 'Synced' }] } } },
      { apiVersion: 's3.aws.krateo.io/v1', kind: 'Bucket', object: { status: { conditions: [{ status: 'True', type: 'Available' }] } } },
    ])
  })

  it('shapes each native kstatus readiness, and a ready Service brings its Endpoints', () => {
    const stubs = stubsOf(`  - { id: web, class: native, apiVersion: apps/v1, kind: Deployment, template: templates/web.yaml, name: web }
  - { id: sts, class: native, apiVersion: apps/v1, kind: StatefulSet, template: templates/sts.yaml, name: sts }
  - { id: svc, class: native, apiVersion: v1, kind: Service, template: templates/svc.yaml, name: svc }
  - { id: pvc, class: native, apiVersion: v1, kind: PersistentVolumeClaim, template: templates/pvc.yaml, name: pvc }
  - { id: job, class: native, apiVersion: batch/v1, kind: Job, template: templates/job.yaml, name: job }
  - { id: ing, class: native, apiVersion: networking.k8s.io/v1, kind: Ingress, template: templates/ing.yaml, name: ing }
  - id: tail
    class: native
    apiVersion: v1
    kind: ConfigMap
    template: templates/tail.yaml
    name: tail
    dependsOn: [{ ref: web, ready: true }, { ref: sts, ready: true }, { ref: svc, ready: true }, { ref: pvc, ready: true }, { ref: job, ready: true }, { ref: ing, ready: true }]
`)
    const byKind = Object.fromEntries(stubs.map((stub) => [stub.kind, stub.object]))
    expect(byKind).toEqual({
      Deployment: { status: { conditions: [{ status: 'True', type: 'Available' }] } },
      Endpoints: { subsets: [{ addresses: [{ ip: '192.0.2.1' }] }] },
      Ingress: { status: { loadBalancer: { ingress: [{ ip: '192.0.2.1' }] } } },
      Job: { status: { conditions: [{ status: 'True', type: 'Complete' }] } },
      PersistentVolumeClaim: { status: { phase: 'Bound' } },
      Service: {},
      StatefulSet: { spec: { replicas: 1 }, status: { readyReplicas: 1 } },
    })
  })

  it('merges two nodes of one kind into one stub that satisfies both', () => {
    const stubs = stubsOf(`  - { id: a, class: custom, apiVersion: x.io/v1, kind: Thing, template: templates/a.yaml, name: a, readyWhen: .status.url }
  - { id: b, class: custom, apiVersion: x.io/v1, kind: Thing, template: templates/b.yaml, name: b, readyWhen: .status.phase }
  - { id: app, class: native, apiVersion: v1, kind: ConfigMap, template: templates/app.yaml, name: app, dependsOn: [{ ref: a, ready: true }, { ref: b, ready: true }] }
`)
    expect(stubs).toEqual([{ apiVersion: 'x.io/v1', kind: 'Thing', object: { status: { phase: 'preview', url: 'preview' } } }])
  })

  it('stands in for nothing without a descriptor, with one that does not parse, or with no edges', () => {
    expect(previewLookupStubs({ 'Chart.yaml': 'apiVersion: v2\nname: demo\nversion: 0.1.0\n' })).toEqual([])
    expect(previewLookupStubs(tree('resources: [\n'))).toEqual([])
    expect(stubsOf('  - { id: only, class: native, apiVersion: v1, kind: ConfigMap, template: templates/only.yaml, name: only }\n')).toEqual([])
  })
})

describe('standInSummary', () => {
  it('names what was stood in for, and what stayed gated', () => {
    const lines = standInSummary([
      { apiVersion: 'v1', kind: 'ConfigMap', name: 'demo-config', namespace: 'ns', stubbed: true },
      { apiVersion: 'x.io/v1', kind: 'Thing', name: '', namespace: 'ns', stubbed: true },
      { apiVersion: 'v1', kind: 'Secret', name: 'creds', namespace: 'ns', stubbed: false },
    ])
    expect(lines).toEqual([
      'Gates opened for this preview: the render stood in for ConfigMap demo-config, every Thing, so what waits on them is shown. Stand-ins only — nothing was read from or applied to the cluster.',
      'Still gated: nothing stood in for Secret creds, so what waits on them is not shown.',
    ])
  })

  it('says nothing when the render made no lookups', () => {
    expect(standInSummary(undefined)).toEqual([])
    expect(standInSummary([])).toEqual([])
  })
})
