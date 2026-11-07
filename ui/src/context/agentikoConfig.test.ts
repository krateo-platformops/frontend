/**
 * AGENTIKO_<KEY> FIRST, AUTOPILOT_<KEY> AS THE FALLBACK — for every one of the 17 keys.
 *
 * Every deployed cluster sets only the AUTOPILOT_ names today, so the "old name only" column is the
 * one that protects them: it must read exactly what it read before the rename. The names are written
 * out in full, never built from a prefix, so a typo in the resolver's prefix cannot pass by being
 * repeated here. The table is typed against `AgentikoKey`, so a key added to the config type and not
 * here fails to compile.
 */
import { describe, expect, it } from 'vitest'

import { resolveStructuredTarget } from '../components/Agentiko/builderPublishClaim'
import { builderTargetFor, resolveBuilderTargets } from '../components/Agentiko/builderTargets'

import { agentikoConfig, agentikoKeyOf, configValueByName, type AgentikoKey } from './agentikoConfig'
import type { Config } from './ConfigContext'

type Api = Record<string, unknown>

/** The two literal names of each key. */
const NAMES: Record<AgentikoKey, readonly [current: string, deprecated: string]> = {
  API_BASE_URL: ['AGENTIKO_API_BASE_URL', 'AUTOPILOT_API_BASE_URL'],
  AVAILABLE: ['AGENTIKO_AVAILABLE', 'AUTOPILOT_AVAILABLE'],
  BLUEPRINT_BUILDER_REPO: ['AGENTIKO_BLUEPRINT_BUILDER_REPO', 'AUTOPILOT_BLUEPRINT_BUILDER_REPO'],
  BLUEPRINT_BUILDER_TEMPLATE: ['AGENTIKO_BLUEPRINT_BUILDER_TEMPLATE', 'AUTOPILOT_BLUEPRINT_BUILDER_TEMPLATE'],
  GIT_HOST: ['AGENTIKO_GIT_HOST', 'AUTOPILOT_GIT_HOST'],
  GIT_SCM: ['AGENTIKO_GIT_SCM', 'AUTOPILOT_GIT_SCM'],
  KOG_BUILDER_REPO: ['AGENTIKO_KOG_BUILDER_REPO', 'AUTOPILOT_KOG_BUILDER_REPO'],
  KOG_BUILDER_TEMPLATE: ['AGENTIKO_KOG_BUILDER_TEMPLATE', 'AUTOPILOT_KOG_BUILDER_TEMPLATE'],
  PAGE_BUILDER_REPO: ['AGENTIKO_PAGE_BUILDER_REPO', 'AUTOPILOT_PAGE_BUILDER_REPO'],
  PAGE_BUILDER_TEMPLATE: ['AGENTIKO_PAGE_BUILDER_TEMPLATE', 'AUTOPILOT_PAGE_BUILDER_TEMPLATE'],
  VOICE_MODEL: ['AGENTIKO_VOICE_MODEL', 'AUTOPILOT_VOICE_MODEL'],
  VOICE_NAME: ['AGENTIKO_VOICE_NAME', 'AUTOPILOT_VOICE_NAME'],
  VOICE_SPEAK_BACK: ['AGENTIKO_VOICE_SPEAK_BACK', 'AUTOPILOT_VOICE_SPEAK_BACK'],
  VOICE_STYLE_PROMPT: ['AGENTIKO_VOICE_STYLE_PROMPT', 'AUTOPILOT_VOICE_STYLE_PROMPT'],
  VOICE_TRANSCRIBE_URL: ['AGENTIKO_VOICE_TRANSCRIBE_URL', 'AUTOPILOT_VOICE_TRANSCRIBE_URL'],
  VOICE_TTS_MODEL: ['AGENTIKO_VOICE_TTS_MODEL', 'AUTOPILOT_VOICE_TTS_MODEL'],
  VOICE_TTS_URL: ['AGENTIKO_VOICE_TTS_URL', 'AUTOPILOT_VOICE_TTS_URL'],
}

const ROWS = Object.entries(NAMES) as Array<[AgentikoKey, readonly [string, string]]>

const read = (api: Api | undefined, key: AgentikoKey): unknown => agentikoConfig(api as Partial<Config['api']>, key)

describe.each(ROWS)('%s', (key, [current, deprecated]) => {
  it('the new name only: read', () => {
    expect(read({ [current]: 'new-value' }, key)).toBe('new-value')
  })

  it('the old name only: read, exactly as before the rename', () => {
    expect(read({ [deprecated]: 'old-value' }, key)).toBe('old-value')
  })

  it('both set: the new name wins', () => {
    expect(read({ [current]: 'new-value', [deprecated]: 'old-value' }, key)).toBe('new-value')
  })

  it('neither set: undefined, which the reader turns into its existing default', () => {
    expect(read({}, key)).toBeUndefined()
    expect(read(undefined, key)).toBeUndefined()
  })

  it('an empty new name is a value, and wins over a non-empty old one', () => {
    expect(read({ [current]: '', [deprecated]: 'old-value' }, key)).toBe('')
  })

  it('an empty old name alone passes through as "", not as absent', () => {
    expect(read({ [deprecated]: '' }, key)).toBe('')
  })

  it('a null new name is absent, so the old name is read', () => {
    expect(read({ [current]: null, [deprecated]: 'old-value' }, key)).toBe('old-value')
  })

  it('names the key under either spelling', () => {
    expect(agentikoKeyOf(current)).toBe(key)
    expect(agentikoKeyOf(deprecated)).toBe(key)
  })
})

describe('agentikoKeyOf / configValueByName — a key named by data (a Builder CR)', () => {
  it('a name with neither prefix is no Agentiko key, and is read as it is', () => {
    expect(agentikoKeyOf('SNOWPLOW_API_BASE_URL')).toBeNull()
    expect(configValueByName({ SNOWPLOW_API_BASE_URL: 'http://snowplow' }, 'SNOWPLOW_API_BASE_URL')).toBe('http://snowplow')
  })

  it('the deployed Builders\' AUTOPILOT_ spelling still finds a value set only under the new name', () => {
    const api = { AGENTIKO_BLUEPRINT_BUILDER_REPO: 'acme/blueprints' } as Partial<Config['api']>
    expect(configValueByName(api, 'AUTOPILOT_BLUEPRINT_BUILDER_REPO')).toBe('acme/blueprints')
    expect(configValueByName(api, 'AGENTIKO_BLUEPRINT_BUILDER_REPO')).toBe('acme/blueprints')
  })

  it('and an old-name-only install reads the same as it did', () => {
    const api = { AUTOPILOT_BLUEPRINT_BUILDER_REPO: 'acme/blueprints' } as Partial<Config['api']>
    expect(configValueByName(api, 'AUTOPILOT_BLUEPRINT_BUILDER_REPO')).toBe('acme/blueprints')
  })

  it('a non-string value is no slug', () => {
    expect(configValueByName({ AUTOPILOT_GIT_HOST: 42 } as unknown as Partial<Config['api']>, 'AUTOPILOT_GIT_HOST')).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------------------------
// The readers that are pure, through their own entry points: the existing defaults for "neither".
// ---------------------------------------------------------------------------------------------

const cfg = (api: Api): Config => ({ api, params: { DELAY_SAVE_NOTIFICATION: '', FRONTEND_NAMESPACE: '' } }) as unknown as Config

describe('GIT_HOST / GIT_SCM as resolveStructuredTarget reads them', () => {
  it('new only', () => {
    expect(resolveStructuredTarget('page', cfg({ AGENTIKO_GIT_HOST: 'gitlab.new', AGENTIKO_GIT_SCM: 'gitlab' }))).toMatchObject({ host: 'gitlab.new', scm: 'gitlab' })
  })
  it('old only', () => {
    expect(resolveStructuredTarget('page', cfg({ AUTOPILOT_GIT_HOST: 'gitlab.old', AUTOPILOT_GIT_SCM: 'bitbucket' }))).toMatchObject({ host: 'gitlab.old', scm: 'bitbucket' })
  })
  it('both: new wins', () => {
    expect(resolveStructuredTarget('page', cfg({
      AGENTIKO_GIT_HOST: 'gitlab.new',
      AGENTIKO_GIT_SCM: 'gitlab',
      AUTOPILOT_GIT_HOST: 'gitlab.old',
      AUTOPILOT_GIT_SCM: 'bitbucket',
    }))).toMatchObject({ host: 'gitlab.new', scm: 'gitlab' })
  })
  it('neither: github / github.com, the existing default', () => {
    expect(resolveStructuredTarget('page', cfg({}))).toMatchObject({ host: 'github.com', scm: 'github' })
  })
  it('an empty new name means what an empty old name always meant here: the default', () => {
    // The reader is `|| 'github.com'`, so "" has always meant the default; the resolver hands it ""
    // and does not reinterpret it as "absent, try the old name".
    expect(resolveStructuredTarget('page', cfg({ AGENTIKO_GIT_HOST: '', AUTOPILOT_GIT_HOST: 'gitlab.old' })).host).toBe('github.com')
    expect(resolveStructuredTarget('page', cfg({ AUTOPILOT_GIT_HOST: '' })).host).toBe('github.com')
  })
})

describe('the three per-builder repo keys as resolveStructuredTarget reads them', () => {
  it.each([
    ['blueprint', 'AGENTIKO_BLUEPRINT_BUILDER_REPO', 'AUTOPILOT_BLUEPRINT_BUILDER_REPO'],
    ['controller', 'AGENTIKO_KOG_BUILDER_REPO', 'AUTOPILOT_KOG_BUILDER_REPO'],
    ['page', 'AGENTIKO_PAGE_BUILDER_REPO', 'AUTOPILOT_PAGE_BUILDER_REPO'],
  ] as const)('%s: %s, then %s', (builder, current, deprecated) => {
    expect(resolveStructuredTarget(builder, cfg({ [current]: 'new/repo' }))).toMatchObject({ namespace: 'new', repo: 'repo' })
    expect(resolveStructuredTarget(builder, cfg({ [deprecated]: 'old/repo' }))).toMatchObject({ namespace: 'old', repo: 'repo' })
    expect(resolveStructuredTarget(builder, cfg({ [current]: 'new/repo', [deprecated]: 'old/repo' }))).toMatchObject({ namespace: 'new', repo: 'repo' })
    expect(resolveStructuredTarget(builder, cfg({}))).toMatchObject({ namespace: '', repo: '' })
  })
})

describe('the six builder target keys as resolveBuilderTargets reads them', () => {
  const cases = [
    ['blueprint', 'AGENTIKO_BLUEPRINT_BUILDER_REPO', 'AUTOPILOT_BLUEPRINT_BUILDER_REPO'],
    ['blueprintTemplate', 'AGENTIKO_BLUEPRINT_BUILDER_TEMPLATE', 'AUTOPILOT_BLUEPRINT_BUILDER_TEMPLATE'],
    ['kog', 'AGENTIKO_KOG_BUILDER_REPO', 'AUTOPILOT_KOG_BUILDER_REPO'],
    ['kogTemplate', 'AGENTIKO_KOG_BUILDER_TEMPLATE', 'AUTOPILOT_KOG_BUILDER_TEMPLATE'],
    ['page', 'AGENTIKO_PAGE_BUILDER_REPO', 'AUTOPILOT_PAGE_BUILDER_REPO'],
    ['pageTemplate', 'AGENTIKO_PAGE_BUILDER_TEMPLATE', 'AUTOPILOT_PAGE_BUILDER_TEMPLATE'],
  ] as const
  const targets = (api: Api) => resolveBuilderTargets(api)

  it.each(cases)('%s: new only, old only, both, neither', (target, current, deprecated) => {
    expect(targets({ [current]: 'new/repo' })[target]).toEqual({ owner: 'new', repo: 'repo' })
    expect(targets({ [deprecated]: 'old/repo' })[target]).toEqual({ owner: 'old', repo: 'repo' })
    expect(targets({ [current]: 'new/repo', [deprecated]: 'old/repo' })[target]).toEqual({ owner: 'new', repo: 'repo' })
    expect(targets({})[target]).toEqual({ owner: '', repo: '' })
  })

  it.each(cases)('a Builder may name %s\'s key under either spelling', (target, current, deprecated) => {
    const resolved = targets({ [deprecated]: 'old/repo' })
    expect(builderTargetFor(resolved, deprecated)).toEqual(resolved[target])
    expect(builderTargetFor(resolved, current)).toEqual(resolved[target])
  })

  it('a key it does not resolve stays an empty target', () => {
    const resolved = targets({ AUTOPILOT_PAGE_BUILDER_REPO: 'old/repo' })
    expect(builderTargetFor(resolved, 'AUTOPILOT_GIT_HOST')).toEqual({ owner: '', repo: '' })
    expect(builderTargetFor(resolved, 'PAGE_BUILDER_REPO')).toEqual({ owner: '', repo: '' })
  })
})
