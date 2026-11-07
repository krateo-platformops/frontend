/**
 * NO AGENTIKO CONFIG KEY IS READ AROUND THE RESOLVER.
 *
 * Every read of an Agentiko config key goes through `agentikoConfig()` (agentikoConfig.ts), because
 * that is where the AUTOPILOT_ fallback lives, and the fallback must be ONE deletion when the last
 * cluster stops setting the old names. A read that names a key directly — `api.AUTOPILOT_X`, or
 * `api.AGENTIKO_X`, which would silently ignore an install that still sets only the old name — is
 * the regression this guards against.
 *
 * It scans the source of ui/src for the shapes a read takes: a property access (`.X`, `?.X`), an
 * exact quoted key (`'X'`, the shape of a key held in a map and indexed later), and an object key
 * or destructured name (`X:` / `{ X }`). Comment lines are skipped — prose about a key is not a read
 * — and so are tests and test harnesses, which SET config rather than read it. The two files that
 * own the names, the resolver and the config type, are the only exemptions.
 *
 * For AUTOPILOT_ every name counts, so a new AUTOPILOT_ key read directly fails too. For AGENTIKO_
 * only the config keys count, because AGENTIKO_ is also the prefix of ordinary constants
 * (`AGENTIKO_PREVIEW_EVENT`).
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

import { describe, expect, it } from 'vitest'

import type { AgentikoKey } from './agentikoConfig'

const SRC = join(__dirname, '..')

/** The config keys, in full. Typed against AgentikoKey so a key added to the type and not here fails to compile. */
const KEYS: Record<AgentikoKey, true> = {
  API_BASE_URL: true,
  AVAILABLE: true,
  BLUEPRINT_BUILDER_REPO: true,
  BLUEPRINT_BUILDER_TEMPLATE: true,
  GIT_HOST: true,
  GIT_SCM: true,
  KOG_BUILDER_REPO: true,
  KOG_BUILDER_TEMPLATE: true,
  PAGE_BUILDER_REPO: true,
  PAGE_BUILDER_TEMPLATE: true,
  VOICE_MODEL: true,
  VOICE_NAME: true,
  VOICE_SPEAK_BACK: true,
  VOICE_STYLE_PROMPT: true,
  VOICE_TRANSCRIBE_URL: true,
  VOICE_TTS_MODEL: true,
  VOICE_TTS_URL: true,
}

/** The files that own the names: the resolver and the config type. */
const EXEMPT = new Set(['context/agentikoConfig.ts', 'context/ConfigContext.tsx'])

/** Tests and harnesses set config; they do not read it. */
const isTestFile = (rel: string): boolean => /\.test\.tsx?$/.test(rel) || /[Tt]est[Hh]arness/.test(rel) || /(^|\/)__tests__\//.test(rel)

const NAME = `(?:AUTOPILOT_[A-Z0-9_]+|AGENTIKO_(?:${Object.keys(KEYS).join('|')}))\\b`

/** The shapes a read of a config key takes in source. */
const READ_SHAPES: ReadonlyArray<[label: string, pattern: RegExp]> = [
  ['property access', new RegExp(`\\??\\.${NAME}`)],
  ['quoted key', new RegExp(`['"\`]${NAME}['"\`]`)],
  ['object key or destructured name', new RegExp(`(?:^\\s*|[{,]\\s*)${NAME}\\s*[:,}]`)],
]

/** A line that is only comment. */
const isCommentLine = (line: string): boolean => /^\s*(\*|\/\*|\/\/)/.test(line)

/** The reads in one file's source, as `line: text` (empty when there are none). */
const readsIn = (source: string): string[] =>
  source.split('\n').flatMap((line, index) => {
    if (isCommentLine(line)) { return [] }
    const code = line.replace(/\s\/\/.*$/, '')
    return READ_SHAPES.some(([, pattern]) => pattern.test(code)) ? [`${index + 1}: ${line.trim()}`] : []
  })

const sourceFiles = (dir: string): string[] =>
  readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) { return sourceFiles(path) }
    return /\.(ts|tsx)$/.test(entry) ? [path] : []
  })

describe('the scanner sees the shapes it looks for (its own control)', () => {
  it.each([
    'const a = config.api.AUTOPILOT_GIT_HOST',
    'const a = config?.api?.AUTOPILOT_SOME_NEW_KEY',
    'const a = api.AGENTIKO_VOICE_TTS_URL',
    "const key = 'AUTOPILOT_PAGE_BUILDER_REPO'",
    'type K = "AGENTIKO_GIT_SCM"',
    'const { AUTOPILOT_AVAILABLE } = api',
    '  AGENTIKO_API_BASE_URL: value,',
    'const a = api.AUTOPILOT_GIT_HOST // trailing comment',
  ])('flags %s', (line) => {
    expect(readsIn(line)).toHaveLength(1)
  })

  it.each([
    ' * reads AUTOPILOT_GIT_HOST, in a comment',
    '// config.api.AUTOPILOT_GIT_HOST',
    "const message = 'set AUTOPILOT_VOICE_TRANSCRIBE_URL to enable dictation'",
    "const reason = 'turned off by AUTOPILOT_VOICE_SPEAK_BACK'",
    // The denial's template literal, as source text: the key is assembled, never spelled whole.
    ['const denial = `set AUTOPILOT_', '{name}_BUILDER_REPO or enter an owner/repo`'].join('$'),
    "import { AGENTIKO_PREVIEW_EVENT, isBuilderPayload } from './previewBus'",
    'const env = import.meta.env.VITE_AUTOPILOT_ECHO',
    "const value = agentikoConfig(api, 'GIT_HOST')",
  ])('does not flag %s', (line) => {
    expect(readsIn(line)).toEqual([])
  })
})

describe('ui/src reads Agentiko config keys only through agentikoConfig()', () => {
  it('finds no direct read outside the resolver and the config type', () => {
    const offenders = sourceFiles(SRC).flatMap((path) => {
      const rel = relative(SRC, path).split('\\').join('/')
      if (EXEMPT.has(rel) || isTestFile(rel)) { return [] }
      return readsIn(readFileSync(path, 'utf8')).map((hit) => `${rel}:${hit}`)
    })
    expect(offenders, 'read these through agentikoConfig(api, KEY) in context/agentikoConfig.ts').toEqual([])
  })

  it('actually scanned the files that read the keys', () => {
    // A scan of the wrong directory finds nothing and passes; these are the readers it must cover.
    const scanned = new Set(sourceFiles(SRC).map((path) => relative(SRC, path).split('\\').join('/')))
    for (const reader of [
      'components/Agentiko/AgentikoProvider.tsx',
      'components/Agentiko/builderPublishClaim.ts',
      'components/Agentiko/builderTargets.ts',
      'components/Agentiko/voiceWiring.ts',
    ]) {
      expect(scanned.has(reader), reader).toBe(true)
      expect(readFileSync(join(SRC, reader), 'utf8')).toContain('agentikoConfig(')
    }
  })
})
