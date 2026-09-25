/**
 * What a publish COMMITS besides the chart, and where it is seeded from — for both builders.
 *
 * A published chart is inert until a CompositionDefinition registers it, and a chart in a bare repo
 * has no workflow to release it. The page builder wrote a registration file and seeded its repo;
 * the blueprint builder did neither, so a blueprint could be composed, previewed, published and
 * merged, and still never be installable. And the page's file never landed: its template brought a
 * CompositionDefinition of its own, and the publish never overwrites a file.
 *
 * `buildClaimPublish` is mocked: what is under test is what this function hands it.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./builderClaimPublish', () => ({
  buildClaimPublish: vi.fn(() => Promise.resolve({ branch: 'builder/x', compiled: { denial: null, ops: [] }, deepLink: null })),
}))

import { startChart } from '../../pages/BlueprintComposer/startChart'

import { createBlueprintDraftStore } from './blueprintDraftStore'
import { buildClaimPublish } from './builderClaimPublish'
import type { BuilderTargets } from './builderTargets'
import { pageDraftFiles } from './pageDraft'
import { REGISTRATION_PATH, runDraftPublish, type PublishDraftDeps } from './publishDraft'

const SCAFFOLD = { owner: 'krateo-blueprints', repo: 'builder-scaffold' }
const NONE = { owner: '', repo: '' }

const targets = (over: Partial<BuilderTargets> = {}): BuilderTargets => ({
  blueprint: { owner: 'Krateo-Blueprints', repo: '<chart>' },
  blueprintTemplate: SCAFFOLD,
  kog: NONE,
  page: { owner: 'acme', repo: 'portal' },
  pageTemplate: SCAFFOLD,
  ...over,
})

const blueprintDeps = (builderTargets = targets()): PublishDraftDeps => {
  const store = createBlueprintDraftStore()
  const started = startChart({ description: '', name: 'orders-api', version: '1.4.2' })
  if (!started.ok) { throw new Error('fixture chart refused') }
  store.set(started.files, 'blueprint')
  return {
    blueprintGate: { evaluate: () => ({ allowed: true, reason: null }) },
    blueprintStore: store,
    builderTargets,
    config: { api: { AUTOPILOT_GIT_HOST: 'github.com' } },
    origin: { prompt: null, sessionId: null },
  } as unknown as PublishDraftDeps
}

const pageDeps = (builderTargets = targets()): PublishDraftDeps => {
  const store = createBlueprintDraftStore()
  const files = pageDraftFiles([{ apiVersion: 'widgets.templates.krateo.io/v1beta1', kind: 'Flex', metadata: { name: 'page-fleet-health', namespace: 'krateo-system' }, spec: { widgetData: { items: [] } } }])
  if (!files) { throw new Error('fixture page refused') }
  store.set(files, 'page')
  return { ...blueprintDeps(builderTargets), blueprintStore: store }
}

/** The one call's arguments, and the registration file it carried (or undefined). */
const claimArgs = () => {
  expect(buildClaimPublish).toHaveBeenCalledTimes(1)
  const [[args]] = vi.mocked(buildClaimPublish).mock.calls
  return { args, registration: args.files.find((file) => file.path === REGISTRATION_PATH)?.content }
}

beforeEach(() => { vi.mocked(buildClaimPublish).mockClear() })

describe('a BLUEPRINT publish registers and seeds', () => {
  it('commits compositiondefinition.yaml at the root — Chart.yaml\'s version, literally', async () => {
    await runDraftPublish(blueprintDeps(), { verb: 'publishBlueprint' })
    const { registration } = claimArgs()
    expect(registration).toBeDefined()
    expect(registration).toContain('  name: orders-api\n  namespace: krateo-system\n')
    // The owner lower-cased, as the registry's is: the release workflow refuses any other url.
    expect(registration).toContain('    url: oci://ghcr.io/krateo-blueprints/charts/orders-api\n')
    expect(registration).toContain('    version: 1.4.2\n')
    expect(registration).not.toContain('CHART_VERSION')
    expect(registration).toContain('https://github.com/krateo-blueprints/orders-api/releases/tag/1.4.2')
  })

  it('is seeded from the BLUEPRINT template', async () => {
    await runDraftPublish(blueprintDeps(targets({ pageTemplate: { owner: 'acme', repo: 'page-only' } })), { verb: 'publishBlueprint' })
    expect(claimArgs().args.sourceUrl).toBe('https://github.com/krateo-blueprints/builder-scaffold.git')
  })

  it('is not seeded when no blueprint template is configured — and still registers', async () => {
    await runDraftPublish(blueprintDeps(targets({ blueprintTemplate: NONE })), { verb: 'publishBlueprint' })
    const { args, registration } = claimArgs()
    expect(args.sourceUrl).toBeNull()
    expect(registration).toContain('version: 1.4.2')
  })

  it('publishes to the chart\'s own repository, whatever repo the proposal named', async () => {
    // Headless, the destination is the prefill — and the prefill is the slug now, not the model's
    // repo and not the install's `<chart>` placeholder.
    await runDraftPublish(blueprintDeps(), { label: 'Publish', owner: 'krateo-blueprints', repo: 'blueprints', verb: 'publishBlueprint' })
    expect(claimArgs().args.dest).toMatchObject({ owner: 'krateo-blueprints', repo: 'orders-api' })
  })

  it('writes no registration file when no owner is known — a url with no owner is not a url', async () => {
    const deps = blueprintDeps(targets({ blueprint: NONE }))
    await runDraftPublish(deps, { owner: '', verb: 'publishBlueprint' })
    // The claim itself is then refused for having no destination; what matters here is that no
    // half-addressed CompositionDefinition was put in it.
    expect(claimArgs().registration).toBeUndefined()
  })
})

describe('a PAGE publish registers and seeds', () => {
  it('commits its compositiondefinition.yaml with the release placeholder and the confirmed repository', async () => {
    await runDraftPublish(pageDeps(), { verb: 'publishPage' })
    const { registration } = claimArgs()
    expect(registration).toContain('  name: fleet-health\n')
    expect(registration).toContain('    url: oci://ghcr.io/acme/charts/fleet-health\n')
    expect(registration).toContain('    version: CHART_VERSION\n')
    expect(registration).toContain('https://github.com/acme/fleet-health/releases/tag/<tag>')
  })

  it('is seeded from the PAGE template, not the blueprint one', async () => {
    await runDraftPublish(pageDeps(targets({ blueprintTemplate: { owner: 'acme', repo: 'blueprint-only' } })), { verb: 'publishPage' })
    expect(claimArgs().args.sourceUrl).toBe('https://github.com/krateo-blueprints/builder-scaffold.git')
  })

  it('publishes to the page set\'s own repository, not the install\'s fallback the rail re-prompt emits', async () => {
    await runDraftPublish(pageDeps(), { repo: 'portal', verb: 'publishPage' })
    expect(claimArgs().args.dest).toMatchObject({ repo: 'fleet-health' })
  })
})
