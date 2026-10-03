/**
 * The portal's secrets rule (scripts/lint-ra-secrets.py at portal#290), ported in
 * src/pages/secrets.ts. Every case in secrets/cases.json — the portal's own PLANTED bypasses and
 * CLEAN shapes among them — is judged here by the port, and in CI by the portal's own lint at
 * secrets/PORTAL_REF (secrets/conformance.py): both must give the verdict the case records.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { secretsProblems } from '../src/pages/secrets'
import { byKind, example, fakeSnowplow, json, liveCtx, recorder, run } from './helpers'

const cases = JSON.parse(readFileSync(join(__dirname, 'secrets', 'cases.json'), 'utf8')) as { name: string; step: Record<string, unknown>; refused: boolean; source: string }[]

describe('the secrets rule, case by case (the same corpus the portal lint replays)', () => {
  it.each(cases.map((c) => [c.name, c] as const))('%s', (_name, c) => {
    const problems = secretsProblems({ kind: 'RESTAction', spec: { api: [c.step] } }, 'ra')
    expect(problems.length > 0).toBe(c.refused)
  })
})

describe('the corpus', () => {
  it('carries the portal\'s 22 planted bypasses and 6 clean shapes', () => {
    expect(cases.filter((c) => c.source.includes('PLANTED'))).toHaveLength(22)
    expect(cases.filter((c) => c.source.includes('CLEAN'))).toHaveLength(6)
    expect(cases.filter((c) => c.source.includes('PLANTED')).every((c) => c.refused)).toBe(true)
    expect(cases.filter((c) => c.source.includes('CLEAN')).every((c) => !c.refused)).toBe(true)
  })
})

describe('the review\'s bypasses (#446), each refused for its own reason', () => {
  const problemsOf = (name: string): string[] => {
    const c = cases.find((x) => x.name === name)!
    return secretsProblems({ kind: 'RESTAction', spec: { api: [c.step] } }, 'ra')
  }
  it('#1 a guard that is not portal.fetchableDefs verbatim, or not applied to the path\'s field', () => {
    expect(problemsOf('review #1: implode-built core path, self-defined fetchablePath = identity')[0])
      .toMatch(/not a single field of the iterator item/)
    expect(problemsOf('portal planted: a self-defined guard on a field path')[0]).toMatch(/does not begin with portal.fetchableDefs exactly/)
    expect(problemsOf('portal planted: the canonical guard, then redefined')[0]).toMatch(/redefines the fetchable guard/)
    expect(problemsOf('portal planted: a def ahead of the canonical guard')[0]).toMatch(/does not begin with portal.fetchableDefs/)
    expect(problemsOf('portal planted: the canonical guard, applied to a field the path does not read')[0]).toMatch(/never applies fetchablePath to \.other/)
    expect(problemsOf('portal planted: the canonical guard, but the path builds its own resource')[0]).toMatch(/not a single field of the iterator item/)
    expect(problemsOf('portal planted: the canonical guard, then characters built after it')[0]).toMatch(/builds characters after portal.fetchableDefs/)
    expect(problemsOf('portal clean: a guarded data-driven path')).toEqual([])
  })
  it('#2 a path that climbs: "..", %2e in any case, \\u escapes, joined literals', () => {
    for (const name of ['review #2: /apis/ prefix climbing back with ..', 'portal planted: %2E', 'portal planted: a \\u-escaped ..', 'portal planted: "." + "."']) {
      expect(problemsOf(name).join(), name).toMatch(/climb/)
    }
    expect(problemsOf('portal clean: a dot beside a field')).toEqual([])
  })
  it('#3 lists and objects are read as their JSON', () => {
    expect(problemsOf('review #3: an object-valued resourcesFrom')[0]).toMatch(/"secret" in userAccessFilter.resourcesFrom/)
    expect(problemsOf('portal planted: resource an object')[0]).toMatch(/"secret" in userAccessFilter.resource/)
    expect(problemsOf('portal clean: resourcesFrom a list')).toEqual([])
  })
})

describe('in the gate', () => {
  it('builder-lint refuses a draft RESTAction that reads Secrets, naming the step and why', async () => {
    const draft = example()
    byKind(draft, 'RESTAction').spec.api[0].path = '/api/v1/namespaces/krateo-system/%73ecrets'
    const envelope = await run(draft)
    expect(envelope.failedStep).toBe('builder-lint')
    expect(envelope.steps[1].problems).toEqual(['widgets[3] (RESTAction/pod-sizing): spec.api[0] (pods) may read Secrets: "secret" in path'])
  })

  it('builder-lint refuses a data-driven path without the fetchablePath allowlist', async () => {
    const draft = example()
    byKind(draft, 'RESTAction').spec.api.push({ name: 'any', path: '${ .path }', dependsOn: { name: 'pods', iterator: '[.pods.items[] | {path: .metadata.selfLink}]' } })
    const envelope = await run(draft)
    expect(envelope.steps[1].problems[0]).toMatch(/spec.api\[1\] \(any\) may read Secrets: data-driven path \$\{ \.path \} — its iterator does not begin with portal.fetchableDefs/)
  })

  it('references refuses binding an EXISTING RESTAction that reads Secrets', async () => {
    const draft = example().filter((cr) => cr.kind !== 'RESTAction')
    byKind(draft, 'PieChart').spec.apiRef = { name: 'leaky', namespace: 'krateo-system' }
    byKind(draft, 'Table').spec.apiRef = { name: 'leaky', namespace: 'krateo-system' }
    const { transport } = recorder(fakeSnowplow({
      read: () => json(200, { kind: 'RESTAction', metadata: { name: 'leaky' }, spec: { api: [{ name: 'all', path: '/api/v1/secrets' }] } }),
    }))
    const envelope = await run(draft, liveCtx(transport))
    expect(envelope.failedStep).toBe('references')
    expect(envelope.steps.find((s) => s.name === 'references')?.problems).toContain(
      'widgets[1] (PieChart/pod-phase-pie): spec.apiRef krateo-system/leaky: spec.api[0] (all) may read Secrets: "secret" in path',
    )
  })
})
