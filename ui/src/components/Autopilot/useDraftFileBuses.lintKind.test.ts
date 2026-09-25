// @vitest-environment jsdom
/**
 * The draft broadcast lints each held draft under ITS kind — the kind the store recorded, never a
 * guess from the files (both kinds carry a Chart.yaml and a values.schema.json now).
 *
 * The two kinds answer to different identity rules. A BLUEPRINT is held to the whole chart-identity
 * rule at the version its Chart.yaml carries NOW, because core-provider names its CRD and its
 * controller container after name + version, and a release can lengthen the version past what a name
 * that fit at Start leaves room for. A PAGE set keeps the name-label check only: its version is the
 * CHART_VERSION placeholder the release stamps, so there is no budget to measure yet.
 */
import { describe, expect, it } from 'vitest'

import { pageChartYaml } from './pageDraft'
import { type DraftChangedDetail, onDraftChanged } from './previewDraftChanged'
import { createBroadcastingDraftStore } from './useDraftFileBuses'

// Kind 42: inside the budget at 0.1.0, over it at 10.20.30. The same name, held as each kind.
const NAME = `a${'b'.repeat(41)}`
const SCHEMA = '{"type":"object"}'

const heldAs = (files: Record<string, string>, kind: 'blueprint' | 'page'): DraftChangedDetail => {
  const store = createBroadcastingDraftStore()
  const heard: DraftChangedDetail[] = []
  const stop = onDraftChanged((detail) => { heard.push(detail) })
  store.set(files, kind)
  stop()
  return heard[0]
}

describe('the broadcast lints each draft under ITS kind', () => {
  it('a page set\'s CHART_VERSION placeholder is no problem — a page is held to the name label only', () => {
    expect(heldAs({ 'Chart.yaml': pageChartYaml(NAME), 'values.schema.json': SCHEMA }, 'page').problems).toEqual([])
  })

  it('a blueprint whose version was bumped past its name\'s budget carries the refusal on the broadcast', () => {
    const detail = heldAs({ 'Chart.yaml': `apiVersion: v2\nname: ${NAME}\nversion: 10.20.30\n`, 'values.schema.json': SCHEMA }, 'blueprint')
    expect(detail.problems?.join('\n')).toContain('at version 10.20.30 the Kind (the name without dashes) can be at most 39 characters')
  })
})
