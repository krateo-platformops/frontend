/**
 * The reader behind the stage-reason drift check (test/drift/), offline: the network test can only
 * be as right as this parsing, and a parser that drops what it cannot read would pass by reading less.
 */
import { describe, expect, it } from 'vitest'

import { driftMessage, type GoTree, reasonDiff, snowplowPin, STAGE_OUTCOMES_GO, stageReasonsAt } from './snowplowSource'

const API_DIR = STAGE_OUTCOMES_GO.slice(0, STAGE_OUTCOMES_GO.lastIndexOf('/'))

const treeOf = (files: Record<string, string>): GoTree => ({
  list: (dir) => Promise.resolve(Object.keys(files).filter((path) => path.slice(0, path.lastIndexOf('/')) === dir).map((path) => path.slice(path.lastIndexOf('/') + 1))),
  read: (path) => (path in files ? Promise.resolve(files[path]) : Promise.reject(new Error(`no file ${path}`))),
})

// The shape of snowplow's stage_outcomes.go: a const block with trailing and leading comments, and
// one constant assigned from another package.
const stageOutcomes = (consts: string, imports = '\t"context"\n\n\t"github.com/krateo-platformops/snowplow/internal/credhttp"\n') => `package api

import (
${imports})

// Stage outcome reason codes (closed set). StageReasonFake is only mentioned in a comment.
const (
${consts}
)

var reasonRank = map[string]int{
\tStageReasonForbidden: 9,
}
`

const CREDHTTP = {
  'go/snowplow/internal/credhttp/destination.go': 'package credhttp\n\n// DestinationRefusedReason is the reason.\nconst DestinationRefusedReason = "DestinationRefused"\n',
  'go/snowplow/internal/credhttp/destination_test.go': 'package credhttp\n\nconst DestinationRefusedReason = "FromATestFile"\n',
  'go/snowplow/internal/credhttp/send.go': 'package credhttp\n\nconst (\n\tother = "x"\n)\n',
}

describe('snowplow stage reasons, read from Go source', () => {
  it('reads string constants, and RESOLVES one assigned from another snowplow package (ignoring _test.go)', async () => {
    const tree = treeOf({
      ...CREDHTTP,
      [STAGE_OUTCOMES_GO]: stageOutcomes([
        '\tStageReasonNotExecuted  = "StageNotExecuted" // write-verb stage refused',
        '\tStageReasonForbidden    = "Forbidden"',
        '\t// StageReasonTimeout (#1115) — a comment line between constants',
        '\tStageReasonTimeout = `Timeout`',
        '\tStageReasonDestinationRefused = credhttp.DestinationRefusedReason',
        '\tStageReasonAlias = StageReasonForbidden',
      ].join('\n')),
    })
    expect(Object.fromEntries(await stageReasonsAt(tree))).toEqual({
      StageReasonAlias: 'Forbidden',
      StageReasonDestinationRefused: 'DestinationRefused',
      StageReasonForbidden: 'Forbidden',
      StageReasonNotExecuted: 'StageNotExecuted',
      StageReasonTimeout: 'Timeout',
    })
  })

  it('resolves through an import alias', async () => {
    const tree = treeOf({
      ...CREDHTTP,
      [STAGE_OUTCOMES_GO]: stageOutcomes('\tStageReasonForbidden = "Forbidden"\n\tStageReasonDestinationRefused = ch.DestinationRefusedReason',
        '\tch "github.com/krateo-platformops/snowplow/internal/credhttp"\n'),
    })
    expect((await stageReasonsAt(tree)).get('StageReasonDestinationRefused')).toBe('DestinationRefused')
  })

  it.each([
    ['a package the file does not import', '\tStageReasonForbidden = "Forbidden"\n\tStageReasonX = other.Reason', /names package other, which the file does not import/],
    ['a package outside snowplow', '\tStageReasonForbidden = "Forbidden"\n\tStageReasonX = response.Reason', /outside snowplow's module/],
    ['a constant the package does not declare', '\tStageReasonForbidden = "Forbidden"\n\tStageReasonX = credhttp.Missing', /no constant Missing in go\/snowplow\/internal\/credhttp/],
    ['a multi-name declaration', '\tStageReasonForbidden, StageReasonX = "Forbidden", "X"', /the declaration of StageReasonForbidden is not `Name = value`/],
    ['an iota continuation', '\tStageReasonForbidden = "Forbidden"\n\tStageReasonX', /the declaration of StageReasonX is not `Name = value`/],
    ['an expression', '\tStageReasonForbidden = "Forbidden"\n\tStageReasonX = "a" + "b"', /a constant value this reader does not understand: "a" \+ "b"/],
  ])('%s fails, never skips', async (_what, consts, message) => {
    const imports = '\t"github.com/krateo-platformops/snowplow/internal/credhttp"\n\t"github.com/krateo-platformops/plumbing/http/response"\n'
    await expect(stageReasonsAt(treeOf({ ...CREDHTTP, [STAGE_OUTCOMES_GO]: stageOutcomes(consts, imports) }))).rejects.toThrow(message)
  })

  it('a StageReason* the file uses but another file declares fails: the closed set would be read short', async () => {
    const src = `${stageOutcomes('\tStageReasonForbidden = "Forbidden"')}\nfunc f() string { return StageReasonElsewhere }\n`
    await expect(stageReasonsAt(treeOf({ ...CREDHTTP, [STAGE_OUTCOMES_GO]: src, [`${API_DIR}/other.go`]: 'package api\n\nconst StageReasonElsewhere = "Elsewhere"\n' })))
      .rejects.toThrow(/uses StageReasonElsewhere but does not declare it/)
  })

  it('a file with no StageReason* constant fails: it moved or changed shape', async () => {
    await expect(stageReasonsAt(treeOf({ [STAGE_OUTCOMES_GO]: 'package api\n\nconst other = "x"\n' }))).rejects.toThrow(/declares no StageReason\* constant/)
  })

  it('a missing file fails', async () => {
    await expect(stageReasonsAt(treeOf({}))).rejects.toThrow(/no file go\/snowplow/)
  })
})

describe('the installer pin', () => {
  it('reads the `snowplow` entry, not snowplow-crd or snowplow-agent', () => {
    const pins = 'components:\n- name: snowplow-crd\n  version: 1.12.65\n- name: snowplow\n  version: 1.12.67\n- name: snowplow-agent\n  version: 1.2.2\n'
    expect(snowplowPin(pins)).toBe('1.12.67')
  })

  it.each([
    ['no snowplow entry', 'components:\n- name: snowplow-crd\n  version: 1.12.65\n', /found 0/],
    ['two snowplow entries', 'components:\n- name: snowplow\n  version: 1.12.65\n- name: snowplow\n  version: 1.12.67\n', /found 2/],
    ['no version', 'components:\n- name: snowplow\n', /no x\.y\.z version: undefined/],
    ['not a pins file', 'hello', /found 0 \(of 0 entries\)/],
  ])('%s fails', (_what, pins, message) => {
    expect(() => snowplowPin(pins)).toThrow(message)
  })
})

describe('the drift report', () => {
  it('names the codes missing on each side', () => {
    const diff = reasonDiff(['Forbidden', 'Timeout', 'NewCode'], ['Forbidden', 'Timeout', 'Gone'])
    expect(diff).toEqual({ onlyInGate: ['Gone'], onlyInSnowplow: ['NewCode'] })
    const message = driftMessage(diff, '1.12.99', 'installer main')
    expect(message).toContain('in snowplow 1.12.99, missing from builder-gate: NewCode')
    expect(message).toContain('in builder-gate, not in snowplow 1.12.99: Gone')
  })
})
