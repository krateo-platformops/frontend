/**
 * The node card's selection and fading, against the keyboard focus ring (WCAG 2.4.7, 1.4.11).
 *
 * THE FOCUS RING IS C3's, DEFINED ONCE: `*:focus-visible` in ui/index.css — 2px solid primary, 2px
 * offset. The card's `selected` state was drawn with exactly that outline, so after Enter on one
 * card and Tab to the next, both wore the same ring and nothing said which had focus. And a withheld
 * card faded by `opacity` on the card itself, which fades everything it paints — its focus outline
 * included, to about 1.7:1 on the light pane, under the 3:1 a focus indicator needs.
 *
 * So: selection is drawn by a shape of its own (never `outline`), and fading is applied to the
 * card's CONTENT, never to the card, so the outline the card draws keeps its full contrast.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

const css = readFileSync(join(__dirname, 'ArchitectureCanvas.module.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')

/** The declarations of every rule whose selector list includes exactly `selector`. */
const rulesFor = (selector: string): string[] => [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
  .filter((match) => match[1].split(',').map((part) => part.trim()).includes(selector))
  .map((match) => match[2])

describe('the architecture card — selection is not focus, and fading does not fade the focus ring', () => {
  it('draws the selected state without an outline — the outline is the focus ring', () => {
    const selected = rulesFor(".card[data-states~='selected']")
    expect(selected.length).toBeGreaterThan(0)
    expect(selected.join('\n')).not.toMatch(/\boutline\s*:/)
  })

  it('marks selection with a shape of its own that a focus ring does not draw', () => {
    expect(rulesFor(".card[data-states~='selected']::after").join('\n')).toMatch(/\bborder\s*:/)
  })

  it('fades withheld and orthogonal cards through their content, never the card itself', () => {
    for (const state of ['withheld', 'orthogonal']) {
      expect(rulesFor(`.card[data-states~='${state}']`).join('\n')).not.toMatch(/\bopacity\s*:/)
      expect(rulesFor(`.card[data-states~='${state}'] > *`).join('\n')).toMatch(/\bopacity\s*:/)
    }
  })

  it("draws a pending edge's two ends differently from a frontier card", () => {
    const shadow = (selector: string): string => rulesFor(selector).join('\n').match(/box-shadow\s*:\s*([^;]+)/)?.[1] ?? ''
    const frontier = shadow(".card[data-states~='frontier']")
    for (const end of [".card[data-states~='pendingFrom']", ".card[data-states~='pendingTo']"]) {
      expect(shadow(end)).not.toBe('')
      expect(shadow(end)).not.toBe(frontier)
    }
  })
})
