/**
 * Full-bleed on a phone. At 480px and under (the sign-in page's breakpoint, mockup v3 "Phone ·
 * 400") the public page drops its gutter, as /login does, and a centred, capped Card drops its cap,
 * border, radius and shadow, so a sign-in style frame runs edge to edge with its band at the top
 * of the screen; a branded one also stretches to the screen's height on its own surface, as the
 * sign-in card does, while the page keeps its ground. The gutter is removed in ONE place, the page: the Card only stops being a boxed
 * column. Above 480px nothing changes (PublicPage.paddingUnchanged).
 *
 * jsdom applies no stylesheet and evaluates no media query, so this reads the modules' rules.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

const read = (path: string) => readFileSync(join(__dirname, path), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')

/** The declarations of `selector` inside the `@media (width <= Npx)` blocks of `css`. */
const ruleInMedia = (css: string, maxWidth: number, selector: string): string => {
  const blocks = [...css.matchAll(new RegExp(`@media \\(width <= ${maxWidth}px\\)\\s*\\{((?:[^{}]*\\{[^{}]*\\})*[^{}]*)\\}`, 'g'))].map((match) => match[1])
  return blocks.flatMap((block) => [...block.matchAll(/([^{}]+)\{([^{}]*)\}/g)])
    .filter((match) => match[1].split(',').map((part) => part.trim()).includes(selector))
    .map((match) => match[2])
    .join('\n')
}

describe('a public page on a phone', () => {
  it('the page has no gutter at 480px and under', () => {
    expect(ruleInMedia(read('PublicPage.module.css'), 480, '.page')).toMatch(/padding:\s*0;/)
  })

  it('a centred, capped Card fills the width with no border, radius or shadow', () => {
    const rule = ruleInMedia(read('../widgets/Card/Card.module.css'), 480, '.panel.centered.capped')
    for (const declaration of [/max-width:\s*none;/, /border:\s*0;/, /border-radius:\s*0;/, /box-shadow:\s*none;/]) {
      expect(rule).toMatch(declaration)
    }
    // …and it does not remove the page gutter itself: no negative margin, no viewport width.
    expect(rule).not.toMatch(/margin|100vw/)
  })

  it('a branded one fills the screen\'s height on its own surface; the page keeps its ground', () => {
    expect(ruleInMedia(read('../widgets/Card/Card.module.css'), 480, '.panel.branded.centered.capped')).toMatch(/min-height:\s*100dvh;/)
    expect(ruleInMedia(read('PublicPage.module.css'), 480, '.page')).not.toMatch(/background/)
  })
})
