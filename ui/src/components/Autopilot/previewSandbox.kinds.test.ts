/**
 * The sandbox kind table matches the SHIPPED CRDs — pinned, because deny-by-default makes an
 * omission look exactly like a rejection.
 *
 * `WIDGET_KIND_PLURALS` decides whether a draft may be applied to the preview sandbox at all: a
 * kind absent from it is "not a widget", and the whole draft is refused before anything is written.
 * That is the right default. What it costs is diagnosability — a missing ROW and a genuinely bad
 * draft produce the same message, so the table can fall behind the CRDs and the symptom reads as
 * the feature being broken.
 *
 * It did. `PageHeader` and `Theme` were absent while both shipped as CRDs. Every page a person
 * starts carries a PageHeader (StartDraftModal emits one) and design rule P25 requires one on every
 * nav-declared page — so a hand-built page was rejected with "unknown kind" and no live preview ever
 * rendered. Found by dry-running a demo recorder, not by a test, because no test compared the table
 * to the thing it is a copy of.
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { WIDGET_KIND_PLURALS } from './previewSandbox'

/** The CRDs the frontend chart ships — the authority this table is copied from. */
const CRD_DIR = join(__dirname, '../../../../helm/frontend-crds/templates')

const shippedKinds = (): Record<string, string> => {
  const out: Record<string, string> = {}
  for (const file of readdirSync(CRD_DIR).filter((name) => name.endsWith('.crd.yaml'))) {
    const text = readFileSync(join(CRD_DIR, file), 'utf8')
    const kind = /^\s+kind:\s*(\w+)\s*$/m.exec(text)
    const plural = /^\s+plural:\s*(\w+)\s*$/m.exec(text)
    if (kind && plural) {
      out[kind[1]] = plural[1]
    }
  }
  return out
}

describe('WIDGET_KIND_PLURALS tracks the shipped CRDs', () => {
  it('reads the CRDs at all — a zero-length authority would make every assertion vacuous', () => {
    expect(Object.keys(shippedKinds()).length).toBeGreaterThan(30)
  })

  it('carries EVERY shipped kind — an absent one rejects every draft that uses it', () => {
    const missing = Object.keys(shippedKinds()).filter((kind) => !(kind in WIDGET_KIND_PLURALS))
    expect(missing).toEqual([])
  })

  it('carries PageHeader specifically — P25 puts one on every nav-declared page', () => {
    // Named rather than left to the sweep above: this is the row whose absence broke the composer,
    // and a regression here has a bigger blast radius than any other single kind.
    expect(WIDGET_KIND_PLURALS.PageHeader).toBe('pageheaders')
  })

  it('maps each kind to the CRD’s OWN plural — the irregulars are why this is a table', () => {
    const wrong = Object.entries(shippedKinds())
      .filter(([kind, plural]) => kind in WIDGET_KIND_PLURALS && WIDGET_KIND_PLURALS[kind] !== plural)
      .map(([kind, plural]) => `${kind}: ${WIDGET_KIND_PLURALS[kind]} != ${plural}`)
    expect(wrong).toEqual([])
  })

  it('invents no kind the chart does not ship', () => {
    const shipped = shippedKinds()
    expect(Object.keys(WIDGET_KIND_PLURALS).filter((kind) => !(kind in shipped))).toEqual([])
  })
})
