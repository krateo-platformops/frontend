/**
 * THE FENCE, ASSERTED BY RUNNING IT.
 *
 * `voice/speak/` may make no network call at all — that is what turns FR 68's "the spoken
 * words are the written words" from a promise into something a reader can check by grep,
 * and it is why the Cloud TTS client lives one directory up in `voice/speakTts.ts` and
 * arrives injected as a `Speaker`. The rule enforcing it is a `no-restricted-imports`
 * pattern in eslint.config.js, and a rule nobody runs is a comment: this drives the real
 * ESLint over the real config and asserts that the banned import is REPORTED, that the
 * bans it joined are still reported beside it, and that the file as committed is clean —
 * so a fence that silently stops matching (a moved file, a rewritten glob, a `patterns`
 * entry lost in a merge) fails here rather than a year later.
 *
 * Deliberately linted against `speakBackStore.ts`'s real path: the config block is
 * path-scoped, so the path IS the thing under test, and a hypothetical path would prove
 * nothing about the directory the store actually lives in.
 */
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { ESLint } from 'eslint'
import { beforeAll, describe, expect, it } from 'vitest'

const uiRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..')
const fencedFile = path.join(uiRoot, 'src/components/Autopilot/voice/speak/speakBackStore.ts')

// One instance for the file: the first lint builds the type-aware program the config asks
// for, which is the whole cost here — rebuilding it per test triples a slow test for nothing.
const eslint = new ESLint({ cwd: uiRoot })

/** Lint `source` AS IF it were `speakBackStore.ts`, and return only the fence's verdicts. */
const fenceVerdicts = async (source: string): Promise<string[]> => {
  const [result] = await eslint.lintText(source, { filePath: fencedFile })
  return result.messages
    .filter((message) => message.ruleId === 'no-restricted-imports')
    .map((message) => message.message)
}

/**
 * WARM THE INSTANCE BEFORE ANYTHING IS ASSERTED.
 *
 * This suite failed in CI on its FIRST case and passed on the later ones — including the case that
 * lints the same module under its `.ts` spelling — while passing locally in every ordering I could
 * produce. The one thing the first call does that the others do not is what the comment above
 * already names: it builds the type-aware program the config asks for. A rule set that is not yet
 * fully resolved on that first pass reports nothing, and "reports nothing" is indistinguishable
 * from "the fence is open" to an assertion counting verdicts.
 *
 * So the warm-up is not a workaround for a slow machine: it removes an ordering dependency from
 * tests that are supposed to be about the config. It also means a future reader who adds a case at
 * the top of this describe does not silently inherit the failure.
 *
 * HONESTLY LABELLED: I could not reproduce the CI failure locally, so this is reasoned from the
 * evidence (first-case-only, extension-independent, environment-dependent) rather than observed. If
 * CI still fails here, the next thing to suspect is `patterns.group` matching a RELATIVE specifier,
 * and the discriminator is in issue #335.
 */
beforeAll(async () => {
  await eslint.lintText('export {}\n', { filePath: fencedFile })
}, 120_000)

describe('speak-back cannot make a network call (voice spec FR 65/68)', () => {
  it('refuses an import of the Cloud TTS client from inside voice/speak/', async () => {
    const verdicts = await fenceVerdicts('import { createTtsSpeaker } from \'../speakTts\'\nvoid createTtsSpeaker\n')
    expect(verdicts).toHaveLength(1)
    expect(verdicts[0]).toContain('speakBackStore.installSpeaker()')
  }, 120_000)

  it('still refuses the transport and the transcription client it was added beside', async () => {
    const verdicts = await fenceVerdicts([
      'import { a2aAuthHeader } from \'../../transport\'',
      'import { transcribe } from \'../transcribe\'',
      'void a2aAuthHeader; void transcribe',
      '',
    ].join('\n'))
    expect(verdicts).toHaveLength(2)
  }, 120_000)

  it('refuses the .ts spelling too — tsconfig allows it, so an extensionless pattern is a hole', async () => {
    // `allowImportingTsExtensions` is on, so `'../speakTts.ts'` compiles and Vite resolves it.
    // A fence that only matches one accepted spelling of the same module is not a fence.
    const verdicts = await fenceVerdicts([
      'import { createTtsSpeaker } from \'../speakTts.ts\'',
      'import { a2aAuthHeader } from \'../../transport.ts\'',
      'void createTtsSpeaker; void a2aAuthHeader',
      '',
    ].join('\n'))
    expect(verdicts).toHaveLength(2)
  }, 120_000)

  it('lets the store as committed through — the fence bans the import, not the feature', async () => {
    expect(await fenceVerdicts(await readFile(fencedFile, 'utf8'))).toHaveLength(0)
  }, 120_000)
})
