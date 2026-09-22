/**
 * THE HEADER ACTION MUST NOT PRINT OVER THE CARD'S CONTENT.
 *
 * #86 §0.9b pinned the `extraRefId` action against `.panel` so it centred against the FULL panel
 * height. That suited the alert-detail card — three short rows of body — and the rule shipped with
 * a note saying "single-consumer today".
 *
 * It gained a second consumer and broke. Centring against the panel means the taller the body, the
 * further the action travels into it. On the portal-builder card (a four-step Steps, ~200px of
 * body) the "Ask Autopilot" button landed on top of step four and overprinted it, legibly:
 * "Publishing commits every file — the page ro̶o̶t̶, e̶a̶c̶h̶". Caught in a recording of the live
 * page, and invisible to every test and lint in either repo.
 *
 * A SOURCE ASSERTION, because the defect is geometry produced by a stylesheet, and jsdom computes
 * no layout — a mounted Card reports zero for every box. This is a tripwire: it asserts the
 * containing block is the HEAD, which is the one region that cannot contain body text.
 */
import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

const css = (): string => readFileSync(new URL('./Card.module.css', import.meta.url), 'utf-8')

/** The `.hasExtraAction` block, which is the only place the action is positioned. */
const extraRules = (): string => {
  const source = css()
  const start = source.indexOf('&.hasExtraAction')
  expect(start, 'the .hasExtraAction rules are gone — re-point this tripwire').toBeGreaterThan(-1)
  return source.slice(start, source.indexOf('&.clickable'))
}

describe('the card header action', () => {
  it('makes the HEAD its containing block, not the panel', () => {
    // Without this, `top: 0; bottom: 0` stretches the action across head + body and centres it in
    // the middle of the card — which is inside the content for any card with more than a line or
    // two to say.
    expect(extraRules()).toMatch(/\.ant-card-head\)\s*\{[^}]*position:\s*relative/s)
  })

  it('still stretches and centres the action within that block', () => {
    // The centring itself was never the bug — only what it centred against. Keeping it means the
    // alert-detail card still reads as intended, aligned with its title rather than its body.
    const rules = extraRules()
    const extra = rules.slice(rules.indexOf('.ant-card-extra'))
    for (const declaration of ['position: absolute', 'top: 0', 'bottom: 0', 'align-items: center']) {
      expect(extra, declaration).toContain(declaration)
    }
  })

  it('does not reintroduce panel-height centring', () => {
    // `.panel` is position:relative for its own reasons (the floated icon), so an absolutely
    // positioned extra silently re-anchors to it the moment the head stops being positioned.
    // That is the exact regression, and it is a one-line deletion away.
    expect(css()).toMatch(/&\.hasExtraAction\s*:global\(\.ant-card-head\)/)
  })
})
