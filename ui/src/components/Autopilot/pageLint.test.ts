/**
 * pageLint — the pure page-draft lint, driven the way the builder gate will drive it: schemas read
 * from disk and plurals from a table, both INJECTED. Nothing here stubs `fetch` or primes a
 * resolver, because the module must not need either. Proves each rule: unknown kind, DNS-1123,
 * apiVersion, spec, ajv over the co-located schemas (including the 2026-10-02 field no widget
 * accepts), the RESTAction structural checks, duplicates, the fail-closed missing schema, and the
 * page-root rule.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import Ajv from 'ajv'
import { describe, expect, it, vi } from 'vitest'

import {
  isPageRoot,
  lintPageDrafts,
  pageRootProblem,
  type PageLintDeps,
  RESTACTION_API_VERSION,
  WIDGETS_API_VERSION,
} from './pageLint'

const WIDGETS_DIR = join(__dirname, '..', '..', 'widgets')

/** Every co-located widget schema, read with fs — the way a Node host loads them. */
const SCHEMAS = new Map<string, Record<string, unknown>>(
  readdirSync(WIDGETS_DIR).flatMap((dir) => {
    const file = join(WIDGETS_DIR, dir, `${dir}.schema.json`)
    try {
      return [[dir, JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>] as const]
    } catch {
      return []
    }
  }),
)

const PLURALS: Record<string, string> = { Flex: 'flexes', PageHeader: 'pageheaders', Paragraph: 'paragraphs', Table: 'tables' }

const deps: PageLintDeps = {
  pluralOf: (kind) => PLURALS[kind] ?? null,
  schemaFor: (kind) => SCHEMAS.get(kind) ?? null,
}

const flexRoot = (name = 'page-pod-sizing'): Record<string, unknown> => ({
  apiVersion: WIDGETS_API_VERSION,
  kind: 'Flex',
  metadata: { name },
  spec: {
    resourcesRefs: {
      items: [{ allowed: true, apiVersion: WIDGETS_API_VERSION, id: 'p1', name: 'pod-sizing-title', namespace: 'krateo-system', resource: 'paragraphs', verb: 'GET' }],
    },
    widgetData: { allowedResources: ['paragraphs'], items: [{ resourceRefId: 'p1' }] },
  },
})

const paragraph = (name = 'pod-sizing-title'): Record<string, unknown> => ({
  kind: 'Paragraph',
  metadata: { name },
  spec: { widgetData: { text: 'Pod sizing' } },
})

const restAction = (name = 'pod-sizing'): Record<string, unknown> => ({
  apiVersion: RESTACTION_API_VERSION,
  kind: 'RESTAction',
  metadata: { name },
  spec: { api: [{ name: 'pods', path: '/api/v1/pods' }] },
})

describe('the injected schemas', () => {
  it('are the co-located ones, read from disk', () => {
    expect(SCHEMAS.has('Flex')).toBe(true)
    expect(SCHEMAS.has('Paragraph')).toBe(true)
  })
})

describe('lintPageDrafts', () => {
  it('a valid set (root Flex + Paragraph + RESTAction) has no problems', async () => {
    expect(await lintPageDrafts([flexRoot(), paragraph(), restAction()], deps)).toEqual([])
  })

  it('an unknown kind is refused, and nothing else is said about that draft', async () => {
    expect(await lintPageDrafts([{ kind: 'Gadget', metadata: { name: 'Not DNS' } }], deps)).toEqual([
      'widgets[0] (Gadget/Not DNS): unknown kind — not a registered widget kind or RESTAction',
    ])
    expect(await lintPageDrafts([{ metadata: { name: 'x' }, spec: {} }], deps)).toEqual([
      'widgets[0] (?/x): unknown kind — not a registered widget kind or RESTAction',
    ])
  })

  it('RESTAction is known without asking pluralOf', async () => {
    const pluralOf = vi.fn(() => null)
    expect(await lintPageDrafts([restAction()], { ...deps, pluralOf })).toEqual([])
    expect(pluralOf).not.toHaveBeenCalled()
  })

  it('metadata.name is required and must be DNS-1123', async () => {
    expect(await lintPageDrafts([{ kind: 'Paragraph', spec: { widgetData: { text: 'x' } } }], deps)).toEqual([
      'widgets[0] (Paragraph/?): metadata.name is required and must be a DNS-1123 name',
    ])
    expect(await lintPageDrafts([paragraph('Not-DNS')], deps)).toEqual([
      'widgets[0] (Paragraph/Not-DNS): metadata.name is required and must be a DNS-1123 name',
    ])
  })

  it('a wrong apiVersion is refused; an absent one is left to the rewrite', async () => {
    expect(await lintPageDrafts([{ ...paragraph(), apiVersion: 'widgets.templates.krateo.io/v1' }], deps)).toEqual([
      `widgets[0] (Paragraph/pod-sizing-title): apiVersion must be ${WIDGETS_API_VERSION}`,
    ])
    expect(await lintPageDrafts([{ ...restAction(), apiVersion: WIDGETS_API_VERSION }], deps)).toEqual([
      `widgets[0] (RESTAction/pod-sizing): apiVersion must be ${RESTACTION_API_VERSION}`,
    ])
    expect(await lintPageDrafts([paragraph()], deps)).toEqual([])
  })

  it('spec is required, for widgets and RESTActions alike', async () => {
    expect(await lintPageDrafts([{ kind: 'Paragraph', metadata: { name: 'p' } }], deps)).toEqual([
      'widgets[0] (Paragraph/p): spec is required',
    ])
    expect(await lintPageDrafts([{ kind: 'RESTAction', metadata: { name: 'ra' }, spec: [] }], deps)).toEqual([
      'widgets[0] (RESTAction/ra): spec is required',
    ])
  })

  it('a RESTAction gets the structural checks only — its spec is not schema-checked here', async () => {
    expect(await lintPageDrafts([{ ...restAction(), spec: { anything: true } }], deps)).toEqual([])
  })

  it('a schema violation surfaces the ajv path', async () => {
    expect(await lintPageDrafts([{ kind: 'Paragraph', metadata: { name: 'p' }, spec: { widgetData: {} } }], deps)).toEqual([
      "widgets[0] (Paragraph/p): /spec/widgetData must have required property 'text'",
    ])
  })

  it('spec.allowedResources on a Flex is refused — the field no widget accepts (krateo-057, 2026-10-02)', async () => {
    const root = flexRoot()
    const spec = root.spec as Record<string, unknown>
    const draft = { ...root, spec: { ...spec, allowedResources: ['paragraphs'] } }
    expect(await lintPageDrafts([draft], deps)).toEqual([
      'widgets[0] (Flex/page-pod-sizing): /spec must NOT have additional properties',
    ])
  })

  it('a served kind with no schema fails CLOSED', async () => {
    expect(await lintPageDrafts([paragraph()], { ...deps, schemaFor: () => null })).toEqual([
      'widgets[0] (Paragraph/pod-sizing-title): no co-located schema found for kind Paragraph — draft not validated, refusing to apply',
    ])
  })

  it('takes an async schemaFor (the portal loads schemas lazily)', async () => {
    const schemaFor = (kind: string) => Promise.resolve(SCHEMAS.get(kind) ?? null)
    expect(await lintPageDrafts([flexRoot(), paragraph()], { ...deps, schemaFor })).toEqual([])
  })

  it('compiles with an injected ajv when one is given', async () => {
    const ajv = new Ajv({ allErrors: true, strict: false })
    const compile = vi.spyOn(ajv, 'compile')
    await lintPageDrafts([paragraph('a'), paragraph('b')], { ...deps, ajv })
    expect(compile).toHaveBeenCalledTimes(1)
  })

  it('a duplicate (resource, name) is refused once, on the second draft', async () => {
    expect(await lintPageDrafts([paragraph('twin'), paragraph('twin')], deps)).toEqual([
      'widgets[1] (Paragraph/twin): duplicate draft — paragraphs/twin appears twice in the set',
    ])
    // Same name, different resource: not a duplicate.
    expect(await lintPageDrafts([paragraph('same'), restAction('same')], deps)).toEqual([])
  })

  it('reports every draft\'s problems in set order', async () => {
    expect(await lintPageDrafts([
      paragraph('Bad'),
      { kind: 'Gadget', metadata: { name: 'g' } },
      { kind: 'RESTAction', metadata: { name: 'ra' } },
    ], deps)).toEqual([
      'widgets[0] (Paragraph/Bad): metadata.name is required and must be a DNS-1123 name',
      'widgets[1] (Gadget/g): unknown kind — not a registered widget kind or RESTAction',
      'widgets[2] (RESTAction/ra): spec is required',
    ])
  })
})

describe('pageRootProblem — the root rule', () => {
  it('a set with a Flex named page-* has a root', () => {
    expect(pageRootProblem([paragraph(), flexRoot()])).toBeNull()
  })

  it('no root: no Flex, a Flex not named page-*, or a page-* that is not a Flex', () => {
    const expected = 'no page-<slug> root Flex (the page entry) in the draft set — author the root Flex named page-<slug> listing the children'
    expect(pageRootProblem([])).toBe(expected)
    expect(pageRootProblem([paragraph(), restAction()])).toBe(expected)
    expect(pageRootProblem([flexRoot('pod-sizing')])).toBe(expected)
    expect(pageRootProblem([paragraph('page-pod-sizing')])).toBe(expected)
  })

  it('isPageRoot is the predicate the preview mounts by', () => {
    expect(isPageRoot('Flex', 'page-x')).toBe(true)
    expect(isPageRoot('Flex', 'x-page')).toBe(false)
    expect(isPageRoot('Card', 'page-x')).toBe(false)
  })
})
