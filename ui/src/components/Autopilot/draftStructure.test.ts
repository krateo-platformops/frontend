/**
 * The agent was naming handles it had never been shown.
 *
 * `composeMove` / `composeAdd` address the held draft by CR name, and the page-context envelope
 * reported only the live widget cache — what the browser RENDERED. A draft under construction is
 * not in that cache, so the model proposed against a page it could not see, and "card-b is not in
 * this draft" was the predictable result rather than the surprising one.
 *
 * These pin what it is now told, and — as load-bearing as the content — that the delta budget
 * cannot quietly stop telling it.
 */
import { describe, expect, it } from 'vitest'

import { chartFingerprint, draftFingerprint, summarizeChart, summarizeDraft, withHeldDraft } from './draftStructure'
import { redactAutopilotContext } from './redact'
import type { DraftNodeSummary, PageContextEnvelope } from './types'
import { buildContextDelta } from './useAutopilotContext'

const cr = (kind: string, name: string, children: string[] = [], allowed: string[] = []): string => [
  `kind: ${kind}`,
  'apiVersion: widgets.templates.krateo.io/v1beta1',
  `metadata:\n  name: ${name}\n  namespace: krateo-system`,
  'spec:\n  widgetData:',
  allowed.length ? `    allowedResources:\n${allowed.map((one) => `      - ${one}`).join('\n')}` : '    allowedResources: []',
  children.length ? `    items:\n${children.map((ref) => `      - resourceRefId: ${ref}`).join('\n')}` : '    items: []',
  '  resourcesRefs:',
  children.length
    ? `    items:\n${children.map((ref) => `      - id: ${ref}\n        name: ${ref}\n        resource: cards\n        namespace: krateo-system`).join('\n')}`
    : '    items: []',
].join('\n')

/** Flex page-x (holds rows) > Row row-a > Card card-b */
const page = {
  'templates/card.card-b.yaml': cr('Card', 'card-b'),
  'templates/flex.page-x.yaml': cr('Flex', 'page-x', ['row-a'], ['rows']),
  'templates/row.row-a.yaml': cr('Row', 'row-a', ['card-b']),
}

const held = (files: Record<string, string>, kind: 'page' | 'blueprint' = 'page') =>
  ({ bytes: 0, files, kind })

describe('summarizeDraft', () => {
  it('describes the containment the agent has to address by name', () => {
    const summary = summarizeDraft(held(page))
    expect(summary?.files).toBe(3)
    expect(summary?.roots).toHaveLength(1)
    const [root] = summary!.roots
    expect(root).toMatchObject({ kind: 'Flex', name: 'page-x' })
    expect(root.children?.[0]).toMatchObject({ kind: 'Row', name: 'row-a' })
    expect(root.children?.[0].children?.[0]).toMatchObject({ kind: 'Card', name: 'card-b' })
  })

  it('carries what a container SAYS it holds, so a refusal is predictable rather than surprising', () => {
    const summary = summarizeDraft(held(page))
    expect(summary?.roots[0].allows).toEqual(['rows'])
    // Empty is "the author has not said", not "holds nothing" — reported as absent, not as [].
    expect(summary?.roots[0].children?.[0].allows).toBeUndefined()
  })

  it('does NOT report a list the composer grew — the agent must not believe a fence the canvas ignores', () => {
    /*
     * `placeChild` appends each child's plural because the CRD requires the container to list it,
     * so a container the composer created ends up with a non-empty list that DESCRIBES what it
     * holds. `canAccept` stopped treating those as rules (they are annotated at creation), and this
     * summary is what the model reasons from — so reporting one would have the agent decline a
     * placement, and explain that decision to the user, while a person dragging the same widget
     * succeeds. A constraint the agent honours and the canvas does not is worse than none.
     */
    const derived = {
      'templates/flex.page-x.yaml': cr('Flex', 'page-x', ['row-a'], ['rows'])
        .replace('  name: page-x', '  annotations:\n    krateo.io/allowed-resources: derived\n  name: page-x'),
      'templates/row.row-a.yaml': cr('Row', 'row-a'),
    }
    expect(summarizeDraft(held(derived))?.roots[0].allows).toBeUndefined()

    // …while the SAME list, written by an author, is still reported.
    expect(summarizeDraft(held({
      'templates/flex.page-x.yaml': cr('Flex', 'page-x', ['row-a'], ['rows']),
      'templates/row.row-a.yaml': cr('Row', 'row-a'),
    }))?.roots[0].allows).toEqual(['rows'])
  })

  it('names the plural the PARENT declares, which is what addExisting has to say', () => {
    expect(summarizeDraft(held(page))?.roots[0].children?.[0].resource).toBe('cards')
  })

  it('marks a referenced widget the draft does not carry as external', () => {
    const summary = summarizeDraft(held({
      'templates/flex.page-x.yaml': cr('Flex', 'page-x', ['fleet-card']),
    }))
    expect(summary?.roots[0].children?.[0]).toMatchObject({ external: true, name: 'fleet-card' })
  })

  it('says nothing about a BLUEPRINT draft even when it CARRIES widget CRs', () => {
    // A page-set chart's templates ARE widget CRs, so "it parses as a tree" does not make a draft
    // a page. `composeMove` / `composeAdd` address the page composer's held draft; describing a
    // chart's containment to the model invites proposals against something it cannot restructure.
    // The fixture is deliberately a draft that WOULD parse — a non-widget one proves only that
    // buildObjectTree found nothing, which the empty-draft case already covers.
    expect(summarizeDraft(held(page, 'blueprint'))).toBeUndefined()
  })

  it('says nothing about a draft whose files carry no widget CRs at all', () => {
    expect(summarizeDraft(held({ 'templates/deploy.yaml': 'kind: Deployment' }))).toBeUndefined()
  })

  it('describes nothing when no draft is held', () => {
    expect(summarizeDraft(null)).toBeUndefined()
  })

  it('spends the budget on NODES, not roots — a deep page is cut too', () => {
    // The normal page shape is ONE root with everything under it. A cap on the root list would
    // describe such a page in full and still stamp it truncated, which is a false statement about
    // the summary in the same breath as the summary.
    const deep: Record<string, string> = { 'templates/flex.page-x.yaml': cr('Flex', 'page-x', ['n0']) }
    for (let index = 0; index < 100; index += 1) {
      deep[`templates/row.n${index}.yaml`] = cr('Row', `n${index}`, index < 99 ? [`n${index + 1}`] : [])
    }
    const summary = summarizeDraft(held(deep))
    expect(summary?.truncated).toBe(true)
    const depth = (node: DraftNodeSummary | undefined): number => (node ? 1 + depth(node.children?.[0]) : 0)
    expect(depth(summary?.roots[0])).toBeLessThanOrEqual(80)
    expect(summary?.roots).toHaveLength(1)
  })

  it('flags truncation instead of presenting a partial page as the whole one', () => {
    const many = Object.fromEntries(
      Array.from({ length: 90 }, (_, index) => [`templates/card.c${index}.yaml`, cr('Card', `c${index}`)]),
    )
    const summary = summarizeDraft(held(many))
    expect(summary?.truncated).toBe(true)
    expect(summary?.roots.length).toBeLessThanOrEqual(80)
  })
})

describe('withHeldDraft', () => {
  const envelope: PageContextEnvelope = { route: '/portal-builder/compose', widgets: [] }

  it('adds the draft the collector cannot see', () => {
    expect(withHeldDraft(envelope, held(page)).draft?.roots[0].name).toBe('page-x')
  })

  it('leaves the envelope alone when nothing is held', () => {
    expect(withHeldDraft(envelope, null)).toBe(envelope)
  })
})

describe('the delta budget cannot stop describing the draft', () => {
  const base = (draft: PageContextEnvelope['draft']): PageContextEnvelope => ({
    draft, pageStatus: 'ready', route: '/portal-builder/compose', widgets: [],
  })

  it('re-sends the full envelope after the agent RESTRUCTURES the page', () => {
    // A compose turn moves no route and need not change the on-screen widget set — the composer's
    // live render is one endpoint whether the page holds three widgets or thirty. Collapsing here
    // would describe the draft exactly once, and every following turn would reason about the
    // containment the page had BEFORE the agent's own edit.
    const before = base(summarizeDraft(held(page)))
    const moved = {
      ...page,
      'templates/flex.page-x.yaml': cr('Flex', 'page-x', ['row-a', 'card-b'], ['rows']),
      'templates/row.row-a.yaml': cr('Row', 'row-a'),
    }
    const after = base(summarizeDraft(held(moved)))
    expect(buildContextDelta(after, before)).toContain('page-x')
    expect(buildContextDelta(after, before)).not.toContain('Unchanged:')
  })

  it('still collapses when only the draft\'s CONTENT changed', () => {
    // A widgetData edit changes no handle and no placement rule, so it buys the model nothing and
    // should not spend the budget the collapse exists to protect.
    const before = base(summarizeDraft(held(page)))
    const retitled = { ...page, 'templates/card.card-b.yaml': `${cr('Card', 'card-b')}\n    title: Fleet` }
    expect(buildContextDelta(base(summarizeDraft(held(retitled))), before)).toContain('Unchanged:')
  })

  it('re-sends when a draft is STARTED, and when one is dropped', () => {
    const empty = base(undefined)
    const withDraft = base(summarizeDraft(held(page)))
    expect(buildContextDelta(withDraft, empty)).not.toContain('Unchanged:')
    expect(buildContextDelta(empty, withDraft)).not.toContain('Unchanged:')
  })
})

describe('draftFingerprint', () => {
  it('is empty for no draft, so an absent draft and an empty one are not confused', () => {
    expect(draftFingerprint(undefined)).toBe('')
  })

  it('changes when a widget MOVES between containers', () => {
    const before = draftFingerprint(summarizeDraft(held(page)))
    const after = draftFingerprint(summarizeDraft(held({
      ...page,
      'templates/flex.page-x.yaml': cr('Flex', 'page-x', ['row-a', 'card-b'], ['rows']),
      'templates/row.row-a.yaml': cr('Row', 'row-a'),
    })))
    expect(after).not.toBe(before)
  })

  it('does NOT change when only a container\'s declaration changes', () => {
    // allowedResources is reported to the model but is not a handle: widening it must not cost a
    // full envelope. (If that trade ever looks wrong, change this test deliberately, not silently.)
    const widened = { ...page, 'templates/flex.page-x.yaml': cr('Flex', 'page-x', ['row-a'], ['rows', 'cards']) }
    expect(draftFingerprint(summarizeDraft(held(widened))))
      .toBe(draftFingerprint(summarizeDraft(held(page))))
  })
})

describe('summarizeChart — the bytes chartPut rewrites', () => {
  const chart = {
    'Chart.yaml': 'apiVersion: v2\nname: orders\nversion: 0.1.0\n',
    'templates/architecture.yaml': 'kind: ConfigMap\n',
    'templates/b.yaml': 'kind: B\n',
    'templates/username-secret.yaml': 'kind: Secret\nstringData:\n  username: {{ .Values.user }}\n',
    'values.schema.json': '{}',
    'values.yaml': 'user: x\n',
  }

  it('sends every file, in reading order, under the chart\'s name — and nothing for a page', () => {
    const summary = summarizeChart(held(chart, 'blueprint'))
    expect(summary?.name).toBe('orders')
    expect(summary?.files.map((file) => file.path)).toEqual([
      'Chart.yaml', 'templates/architecture.yaml', 'values.schema.json', 'values.yaml', 'templates/b.yaml', 'templates/username-secret.yaml',
    ])
    expect(summary?.withheld).toBeUndefined()
    expect(summarizeChart(held(page))).toBeUndefined()
    expect(summarizeChart(null)).toBeUndefined()
  })

  it('survives the redactor intact — a path naming a secret is not a secret\'s value', () => {
    // The redactor blanks the VALUE of a key containing "secret"; keyed by path, this file would
    // reach the model as "[redacted]" and a whole-file rewrite would write that back.
    const envelope = withHeldDraft({ route: '/blueprint-builder/compose', widgets: [] }, held(chart, 'blueprint'))
    const sent = redactAutopilotContext(envelope).chart?.files.find((file) => file.path === 'templates/username-secret.yaml')
    expect(sent?.content).toBe(chart['templates/username-secret.yaml'])
  })

  it('withholds — and names — a file the redactor would alter, and what does not fit', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4In0.c2lnbmF0dXJlc2lnbmF0dXJl'
    const big = { ...chart, 'templates/huge.yaml': 'a: 1\n'.repeat(25 * 1024), 'templates/token.yaml': `token: ${jwt}\n` }
    const summary = summarizeChart(held(big, 'blueprint'))
    expect(summary?.files.map((file) => file.path)).not.toContain('templates/token.yaml')
    expect(summary?.files.map((file) => file.path)).not.toContain('templates/huge.yaml')
    expect(summary?.withheld).toEqual([
      { path: 'templates/huge.yaml', reason: 'the chart is larger than the context budget' },
      { path: 'templates/token.yaml', reason: 'it holds a value shaped like a credential, which the portal never sends' },
    ])
  })

  it('is re-sent whenever a byte changes — a chart verb addresses the bytes', () => {
    const base = (files: Record<string, string>): PageContextEnvelope =>
      withHeldDraft({ pageStatus: 'ready', route: '/blueprint-builder/compose', widgets: [] }, held(files, 'blueprint'))
    const before = base(chart)
    expect(buildContextDelta(base(chart), before)).toContain('Unchanged:')
    const after = base({ ...chart, 'values.yaml': 'user: y\n' })
    expect(chartFingerprint(after.chart)).not.toBe(chartFingerprint(before.chart))
    expect(buildContextDelta(after, before)).toContain('user: y')
  })
})
