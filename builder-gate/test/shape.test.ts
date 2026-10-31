/**
 * Step 6, shape (frontend#473): the join between a RESTAction's real output and the widget
 * expression that consumes it.
 *
 * The example page is the right fixture for this: it already pairs a `Table` whose `dataSource` is
 * built from `.pods` with the RESTAction that emits them — the same pairing `event-health` got
 * wrong. Each test here changes ONE thing about it.
 */
/* eslint-disable no-template-curly-in-string -- the ${…} jq DSL is the subject under test */
import { describe, expect, it } from 'vitest'

import { arrAt, byKind, example, fakeSnowplow, json, liveCtx, objAt, recorder, resolveReply, run } from './helpers'

/** The example, with the Table's dataSource expression replaced. */
const withTableExpression = (expression: string) => {
  const draft = example()
  objAt(byKind(draft, 'Table'), 'spec', 'widgetDataTemplate', 0).expression = expression
  return draft
}

/** snowplow resolving the RESTAction to exactly these pods, and dry-running everything green. */
const pods = (items: unknown[]) => recorder(fakeSnowplow({
  resolve: (_url, body) => resolveReply(200, { ...(body.object as Record<string, unknown>), status: { pods: items } }, [{ name: 'pods', ok: true }]),
})).transport

const shapeOf = (envelope: { steps: { name: string; problems: string[]; notes: string[] }[] }) =>
  envelope.steps.find((step) => step.name === 'shape')!

describe('frontend#473: an empty result set must not read as a working widget', () => {
  it('REFUSES a pass-through dataSource while the query is empty — the shape that shipped', async () => {
    // `${ .sites }` in event-health; `${ .pods }` here. With no items it yields [], the API server
    // has no dataSource[0] to judge, and every other step is green.
    const envelope = await run(withTableExpression('${ .pods }'), liveCtx(pods([])))
    expect(envelope.failedStep).toBe('shape')
    expect(shapeOf(envelope).problems[0]).toMatch(/pod-sizing returned no items, and this expression does not build the items Table requires at dataSource/)
    // It must name what the API server would have said, so the author sees the real consequence.

    expect(shapeOf(envelope).problems[0]).toMatch(/in body must be of type array/)
    expect(shapeOf(envelope).problems[0]).toMatch(/frontend#473/)
  })

  it('CATCHES the same expression outright once one row exists, in the API server\'s words', async () => {
    // The authoritative case: real data, so no stand-in and no hedging.
    const envelope = await run(withTableExpression('${ .pods }'), liveCtx(pods([{ name: 'a', phase: 'Running' }])))
    expect(envelope.failedStep).toBe('shape')
    expect(shapeOf(envelope).problems[0]).toContain('dataSource[0]: Invalid value: "object": dataSource[0] in body must be of type array: "object"')
  })

  it('PASSES the real page unchanged: its expression builds its own cells', async () => {
    // Empty result, constructor expression — judged against one stand-in and green, with the
    // stand-in declared rather than implied.
    const envelope = await run(example(), liveCtx(pods([])))
    expect(envelope.ok).toBe(true)
    expect(shapeOf(envelope).notes.join(' | ')).toMatch(/Table\/pod-sizing-table\): dataSource: pod-sizing returned no items; the expression builds its own items, so it was judged against ONE STAND-IN/)
  })

  it('PASSES the real page with data too, and says it matched the live output', async () => {
    const envelope = await run(example(), liveCtx(pods([{ name: 'a', phase: 'Running' }])))
    expect(envelope.ok).toBe(true)
    expect(shapeOf(envelope).notes.join(' | ')).toMatch(/dataSource: resolved against pod-sizing's live output and matches the CRD/)
  })
})

describe('what it refuses to call a defect', () => {
  it('leaves a chart alone: every chart\'s data accepts any item, so a pass-through is correct', async () => {
    // The first version of this step used a text test for `valueKey` — Table's marker — and went
    // red on this very PieChart. The rule is now the CRD's own item schema.
    const envelope = await run(example(), liveCtx(pods([])))
    expect(envelope.ok).toBe(true)
    const chart = shapeOf(envelope).notes.find((note) => note.includes('PieChart'))
    expect(chart).toMatch(/not exercised — but PieChart lets any item stand at data/)
  })

  it('is DISABLED offline, rather than reporting silence per widget', async () => {
    const envelope = await run(example())
    expect(shapeOf(envelope).notes[0]).toMatch(/^DISABLED: offline run/)
    expect(envelope.ok).toBe(true)
  })

  it('does not judge a widget whose RESTAction never resolved — another step owns that', async () => {
    const { transport } = recorder(fakeSnowplow({ resolve: () => json(400, { code: 400, kind: 'Status', message: 'nope' }) }))
    const envelope = await run(example(), liveCtx(transport))
    // The data step is red for it; the shape step says only that it could not judge.
    expect(shapeOf(envelope).notes.join(' | ')).toMatch(/not judged — pod-sizing was not resolved in this call/)
    expect(shapeOf(envelope).problems).toEqual([])
  })

  it('flags an expression that is not a ${ … } expression at all — it would reach the widget as text', async () => {
    const envelope = await run(withTableExpression('.pods'), liveCtx(pods([])))
    expect(envelope.failedStep).toBe('shape')
    expect(shapeOf(envelope).problems[0]).toMatch(/is not a \$\{ … \} expression, so it would reach the widget as literal text/)
  })

  it('tolerates the folded-YAML trailing newline the portal\'s own resolver trims (portal#226)', async () => {
    const envelope = await run(withTableExpression('${ [ .pods[]? | [ { valueKey: "name", kind: "jsonSchemaType", type: "string", stringValue: .name } ] ] }\n'), liveCtx(pods([{ name: 'a' }])))
    expect(envelope.ok).toBe(true)
  })
})

describe('a column that names a cell no row carries (frontend#541, author-time)', () => {
  /** The example's Table, with one extra column whose valueKey the RESTAction never emits. */
  const withExtraColumn = (valueKey: string) => {
    const draft = example()
    arrAt(byKind(draft, 'Table'), 'spec', 'widgetData', 'columns').push({ title: 'Owner', valueKey })
    return draft
  }

  it('NOTES the unbacked column, with both explanations, and stays green', async () => {
    // Blank-exporting is not an error — snowplow emits an empty cell rather than refusing — so
    // this must not fail the draft. It must also not be silent, because the person who sees the
    // blank column is whoever downloaded the file.
    const envelope = await run(withExtraColumn('owner'), liveCtx(pods([{ name: 'a', phase: 'Running' }])))
    expect(envelope.ok).toBe(true)
    const note = shapeOf(envelope).notes.find((note) => note.includes('"owner"'))
    expect(note).toMatch(/column "owner" names a cell no row carries/)
    expect(note).toMatch(/empty in csv\/pdf, null in labelled json/)
    // It offers both readings rather than asserting the author is wrong.
    expect(note).toMatch(/only you can tell which/)
  })

  it('says NOTHING when every column is backed', async () => {
    const envelope = await run(example(), liveCtx(pods([{ name: 'a', phase: 'Running' }])))
    expect(envelope.ok).toBe(true)
    expect(shapeOf(envelope).notes.join(' | ')).not.toMatch(/names a cell no row carries/)
  })

  it('says NOTHING when the result is empty — then every column is unbacked and nothing follows', async () => {
    // The empty case is already reported as a stand-in judgement; adding "all your columns are
    // unbacked" there would be noise derived from the absence of data.
    const envelope = await run(withExtraColumn('owner'), liveCtx(pods([])))
    expect(shapeOf(envelope).notes.join(' | ')).not.toMatch(/names a cell no row carries/)
  })

  it('names several unbacked columns together', async () => {
    const draft = example()
    arrAt(byKind(draft, 'Table'), 'spec', 'widgetData', 'columns').push({ title: 'Owner', valueKey: 'owner' }, { title: 'Team', valueKey: 'team' })
    const envelope = await run(draft, liveCtx(pods([{ name: 'a', phase: 'Running' }])))
    const note = shapeOf(envelope).notes.find((note) => note.includes('"owner"'))
    expect(note).toMatch(/columns "owner", "team" name a cell no row carries/)
  })
})
