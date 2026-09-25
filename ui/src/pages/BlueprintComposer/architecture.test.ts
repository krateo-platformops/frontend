import { describe, expect, it } from 'vitest'

import {
  ARCHITECTURE_API_VERSION,
  deriveStates,
  parseArchitecture,
  serializeArchitecture,
  unwrapFromConfigMapTemplate,
  wrapAsConfigMapTemplate,
  type ChartArchitecture,
} from './architecture'

const base = (over: Partial<ChartArchitecture> = {}): ChartArchitecture => ({
  apiVersion: ARCHITECTURE_API_VERSION,
  chart: 'demo',
  kind: 'ChartArchitecture',
  resources: [
    { apiVersion: 'composition.krateo.io/v0-4-2', class: 'composition', id: 'db', kind: 'MongoDB', template: 'templates/db.yaml' },
    { apiVersion: 'v1', class: 'native', id: 'cfg', kind: 'ConfigMap', template: 'templates/cfg.yaml' },
    { apiVersion: 'apps/v1', class: 'native', dependsOn: [{ ready: true, ref: 'db' }, { ref: 'cfg' }], id: 'web', kind: 'Deployment', template: 'templates/web.yaml' },
    { apiVersion: 'v1', class: 'native', dependsOn: [{ ref: 'web' }], id: 'svc', kind: 'Service', template: 'templates/svc.yaml' },
  ],
  ...over,
})

describe('deriveStates — levels are the longest path, never authored', () => {
  it('an existence edge orders the same as a readiness edge', () => {
    const derived = deriveStates(base())
    expect(derived.ok).toBe(true)
    if (!derived.ok) { return }
    expect(derived.levels).toEqual({ cfg: 0, db: 0, svc: 2, web: 1 })
    expect(derived.states).toHaveLength(3)
    expect(derived.states[1].withheld).toEqual(['svc'])
  })

  it('states[] may only NAME levels; extra names are ignored, missing ones fall back', () => {
    const derived = deriveStates(base({ states: [{ name: 'foundations' }] }))
    if (!derived.ok) { throw new Error('unexpected cycle') }
    expect(derived.states.map((state) => state.name)).toEqual(['foundations', 'level-1', 'level-2'])
  })

  it('refuses a cycle and names its members', () => {
    const arch = base()
    arch.resources[0].dependsOn = [{ ref: 'svc' }]
    const derived = deriveStates(arch)
    // The trail follows dependsOn: db waits on svc, svc on web, web on db.
    expect(derived).toEqual({ cycle: ['db', 'svc', 'web', 'db'], ok: false })
  })

  it('a shim is orthogonal: it is in no state', () => {
    const arch = base()
    arch.resources.push({ apiVersion: 'v1', class: 'native', id: 'legacy', kind: 'Secret', lifecycle: 'shim', template: 'templates/legacy.yaml' })
    const derived = deriveStates(arch)
    if (!derived.ok) { throw new Error('unexpected cycle') }
    expect(derived.levels).not.toHaveProperty('legacy')
  })
})

describe('parseArchitecture — every fault by path, nothing guessed', () => {
  it('round-trips through serialise', () => {
    const text = serializeArchitecture(base())
    const parsed = parseArchitecture(text)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) { return }
    expect(serializeArchitecture(parsed.architecture)).toBe(text)
  })

  it('refuses ready: true onto a custom resource with no readyWhen', () => {
    const parsed = parseArchitecture(`apiVersion: ${ARCHITECTURE_API_VERSION}
kind: ChartArchitecture
chart: x
resources:
  - { id: first, class: custom, apiVersion: g/v1, kind: A, template: t/a.yaml }
  - { id: second, class: custom, apiVersion: g/v1, kind: B, template: t/b.yaml, dependsOn: [{ ref: first, ready: true }] }
`)
    expect(parsed.ok).toBe(false)
    if (parsed.ok) { return }
    expect(parsed.problems.map((problem) => problem.path)).toEqual(['resources[1].dependsOn[0]'])
    expect(parsed.problems[0].message).toMatch(/readyWhen/)
  })

  it('refuses an unknown ref, a self edge, a duplicate id and a bad class', () => {
    const parsed = parseArchitecture(`apiVersion: ${ARCHITECTURE_API_VERSION}
kind: ChartArchitecture
chart: x
resources:
  - { id: dup, class: widget, apiVersion: v1, kind: ConfigMap, template: t/a.yaml, dependsOn: [{ ref: dup }, { ref: ghost }] }
  - { id: dup, class: native, apiVersion: v1, kind: Secret, template: t/b.yaml }
`)
    expect(parsed.ok).toBe(false)
    if (parsed.ok) { return }
    expect(parsed.problems.map((problem) => problem.path).sort()).toEqual(
      ['resources[0].class', 'resources[0].dependsOn[0]', 'resources[0].dependsOn[1]', 'resources[1].id'].sort(),
    )
  })

  it('not YAML is one problem at the root, not a throw', () => {
    const parsed = parseArchitecture('resources: [\n')
    expect(parsed.ok).toBe(false)
    if (parsed.ok) { return }
    expect(parsed.problems[0].path).toBe('')
  })
})

describe('the ConfigMap template packaging', () => {
  it('wraps and unwraps byte-stable, keeping .Values references verbatim for Helm to render', () => {
    const arch = base()
    arch.resources[2].when = '.Values.web.enabled'
    const descriptor = serializeArchitecture(arch)
    const template = wrapAsConfigMapTemplate(descriptor, 'demo')
    expect(template).toContain('kind: ConfigMap')
    expect(template).toContain('krateo.io/architecture: demo')
    expect(template).toContain('    when: .Values.web.enabled')
    expect(unwrapFromConfigMapTemplate(template)).toBe(descriptor)
  })

  it('a template that is not ours unwraps to null, not to garbage', () => {
    expect(unwrapFromConfigMapTemplate('apiVersion: v1\nkind: Secret\n')).toBeNull()
  })
})
