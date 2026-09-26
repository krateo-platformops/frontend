/**
 * The work area's one scroller per pane, from the width the two columns had it before the palette
 * came (900px). jsdom evaluates no container query, so the rule is read from the stylesheet: at
 * 900–1100px the panes used to stand side by side, and a placement's template reveal must scroll
 * the files pane alone — not the palette and the inspector off-screen.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

const css = readFileSync(join(__dirname, 'BlueprintComposer.module.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')

/** Every `@container blueprint-composer (min-width: Npx) { … }` block, by N. */
const containerBlocks = (): Map<number, string> => {
  const blocks = new Map<number, string>()
  for (const match of css.matchAll(/@container blueprint-composer \(min-width: (\d+)px\)\s*\{/g)) {
    let depth = 1
    let at = (match.index ?? 0) + match[0].length
    const start = at
    while (depth > 0 && at < css.length) {
      if (css[at] === '{') { depth += 1 }
      if (css[at] === '}') { depth -= 1 }
      at += 1
    }
    blocks.set(Number(match[1]), css.slice(start, at - 1))
  }
  return blocks
}

/** The declarations of the rules in `text` whose selector list includes exactly `selector`. */
const rulesFor = (text: string, selector: string): string => [...text.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
  .filter((match) => match[1].split(',').map((part) => part.trim()).includes(selector))
  .map((match) => match[2])
  .join('\n')

describe('the work area — each pane scrolls itself from 900px', () => {
  it('stops wrapping from 900px, where the two columns did before the palette came', () => {
    const blocks = containerBlocks()
    const wide = [...blocks.entries()].filter(([, block]) => /flex-wrap:\s*nowrap/.test(rulesFor(block, '.body')))
    expect(wide.map(([width]) => width)).toEqual([900])
  })

  it('gives the palette, the side column and the files pane each its own scroller there', () => {
    const block = containerBlocks().get(900) ?? ''
    expect(rulesFor(block, '.body')).toMatch(/overflow:\s*hidden/)
    expect(rulesFor(block, '.palettePane')).toMatch(/overflow-y:\s*auto/)
    expect(rulesFor(block, '.side')).toMatch(/overflow-y:\s*auto/)
    expect(rulesFor(block, '.centre > .filesPane')).toMatch(/overflow-y:\s*auto/)
  })

  it('lets the canvas column narrow to make room, rather than the panes overflow', () => {
    expect(rulesFor(css, '.centre')).toMatch(/min-width:\s*0/)
    expect(rulesFor(css, '.palettePane')).toMatch(/flex:\s*0 0 200px/)
  })
})
