/**
 * The brand frame against mockup v3: the band centres its logo inside antd's cover (antd draws
 * every cover child `display: block`, which left the logo at the band's top edge), the band has no
 * radius of its own (the card's clips it), and the frame's border is the sign-in card's hairline
 * (--line-color), not antd's stronger --border-color. Radius, elevation and padding stay
 * (Card.brandFrameUnchanged).
 *
 * jsdom applies no stylesheet, so this reads the module's rules.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

const css = readFileSync(join(__dirname, 'Card.module.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
const ruleOf = (selector: string) => [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
  .filter((match) => match[1].split(',').map((part) => part.trim()).includes(selector))
  .map((match) => match[2])
  .join('\n')

describe('the brand frame, as mockup v3 draws it', () => {
  it('the band is a flex row inside antd\'s cover, with no radius of its own', () => {
    const band = ruleOf('.panel.branded :global(.ant-card-cover) > :first-child')
    expect(band).toMatch(/display:\s*flex;/)
    expect(band).toMatch(/border-radius:\s*0;/)
  })

  it('the border is the sign-in card\'s hairline', () => {
    expect(ruleOf('.panel.branded')).toMatch(/border-color:\s*var\(--line-color\);/)
  })
})
