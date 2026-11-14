/**
 * The brand frame's radius, elevation and padding. RECORDED ON MAIN (after #724), before the frame's
 * border took the sign-in card's line colour: these already match mockup v3 and the sign-in card
 * (12px radius, the small elevation, a 24/32/32px body), and the commit that changes the border must
 * keep them.
 *
 * jsdom applies no stylesheet, so this reads the module's rules.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

const css = readFileSync(join(__dirname, 'Card.module.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
const wide = css.replace(/@media[^{]*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, '')
const ruleOf = (selector: string) => [...wide.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
  .filter((match) => match[1].split(',').map((part) => part.trim()).includes(selector))
  .map((match) => match[2])
  .join('\n')

describe('the brand frame, as today', () => {
  it('the sign-in card\'s radius and elevation', () => {
    expect(ruleOf('.panel.branded')).toMatch(/border-radius:\s*var\(--radius-xl\);/)
    expect(ruleOf('.panel.branded')).toMatch(/box-shadow:\s*var\(--elevation-sm\);/)
  })

  it('the sign-in card\'s body padding', () => {
    expect(ruleOf('.panel.branded .brandBody')).toMatch(/padding:\s*var\(--spacing-lg\) var\(--spacing-xl\) var\(--spacing-xl\);/)
  })
})
