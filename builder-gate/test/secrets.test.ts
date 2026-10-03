/**
 * The portal's secrets rule (scripts/lint-ra-secrets.py), ported in src/pages/secrets.ts. Every
 * case in secrets/cases.json is judged here by the port, and in CI by the portal's own lint at
 * secrets/PORTAL_REF (secrets/conformance.py) — both must give the verdict the case records.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { secretsProblems } from '../src/pages/secrets'
import { byKind, example, fakeSnowplow, json, liveCtx, recorder, run } from './helpers'

const cases = JSON.parse(readFileSync(join(__dirname, 'secrets', 'cases.json'), 'utf8')) as { name: string; step: Record<string, unknown>; refused: boolean }[]

describe('the secrets rule, case by case (the same corpus the portal lint replays)', () => {
  it.each(cases.map((c) => [c.name, c] as const))('%s', (_name, c) => {
    const problems = secretsProblems({ kind: 'RESTAction', spec: { api: [c.step] } }, 'ra')
    expect(problems.length > 0).toBe(c.refused)
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
    expect(envelope.steps[1].problems[0]).toMatch(/spec.api\[1\] \(any\) may read Secrets: data-driven path \$\{ \.path \} — no fetchablePath allowlist in its iterator/)
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
