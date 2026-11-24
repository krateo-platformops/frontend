/**
 * "BUILDER" IS THE WORD (Diego, 2026-10-28 and 2026-11-24): the authoring pages are Builders. "Compose" is what a person
 * does in one. "Composer" is one thing only, Agentiko's chat input, and it says so: "chat composer" (or the
 * files that are the chat input).
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'

import { describe, expect, it } from 'vitest'

const ROOT = join(__dirname, '../../..')
const SCANNED = ['builder-gate/src', 'docs', 'helm', 'scripts', 'ui/docs', 'ui/e2e', 'ui/scripts', 'ui/src', 'ui/visual']
const TEXT = /\.(?:cjs|css|js|json|md|mjs|mts|sh|tpl|ts|tsx|ya?ml)$/

/** The chat input itself: its files use the word for it throughout. */
const CHAT_INPUT = /Agentiko\/(?:voice\/|composerDraftStore|useComposerAutoGrow|speakBack|dictation\.test|AgentikoRail\.|railFocus)/
/** Text the Blueprint Builder writes into published charts, byte for byte: changing it would make an existing chart read as edited. */
const PUBLISHED = /BlueprintBuilder\/architectureStateJq\.ts$/
const SELF = /builderWording\.test\.ts$/

const filesUnder = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
  const path = join(dir, entry.name)
  if (entry.name === 'node_modules') { return [] }
  if (entry.isDirectory()) { return filesUnder(path) }
  return TEXT.test(entry.name) ? [path] : []
})

const offending = (text: string): string[] => text.split('\n')
  .filter((line) => /(?<![A-Za-z])composers?(?![A-Za-z])/i.test(line.replace(/chat composers?/gi, '')) || /(?:Blueprint|Controller|Page|Portal)Composer|ComposerHost/.test(line))

describe('the authoring pages are Builders', () => {
  it('finds the word it looks for', () => {
    expect(offending('the composer\nComposerHost\nthe chat composer\ncomposerDraftStore\ncomposeRequest')).toEqual(['the composer', 'ComposerHost'])
  })

  it('nothing but Agentiko\'s chat input is called a composer', () => {
    const scanned = SCANNED.flatMap((dir) => filesUnder(join(ROOT, dir))).filter((path) => !CHAT_INPUT.test(path) && !PUBLISHED.test(path) && !SELF.test(path))
    expect(scanned.length, 'the files are there to scan').toBeGreaterThan(500)
    const found = scanned.flatMap((path) => offending(readFileSync(path, 'utf8')).map((line) => `${relative(ROOT, path)}: ${line.trim().slice(0, 120)}`))
    expect(found).toEqual([])
  })
})
