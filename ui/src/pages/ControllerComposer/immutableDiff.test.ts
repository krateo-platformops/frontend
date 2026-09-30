/**
 * immutableFieldDiff — against the live github-provider-kog-label RestDefinition (krateo-057).
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { IMMUTABLE_REST_DEF_FIELDS, immutableFieldDiff } from './immutableDiff'

type RestDefinition = { spec: { resourceGroup: string; resource: Record<string, unknown> } }

const live = (): RestDefinition & Record<string, unknown> =>
  JSON.parse(readFileSync(join(__dirname, '__fixtures__', 'github-kog-label.restdefinition.json'), 'utf8')) as RestDefinition & Record<string, unknown>

const edited = (edit: (draft: RestDefinition) => void): Record<string, unknown> => {
  const draft = live()
  edit(draft)
  return draft
}

describe('immutableFieldDiff', () => {
  it('locks the six fields the CRD marks immutable', () => {
    expect(IMMUTABLE_REST_DEF_FIELDS).toEqual(['kind', 'resourceGroup', 'identifiers', 'configurationFields', 'additionalStatusFields', 'excludedSpecFields'])
  })

  it('an unchanged republish, and one that changes only verbs or compareScope, is clean', () => {
    expect(immutableFieldDiff(live(), live())).toEqual([])
    expect(immutableFieldDiff(live(), edited((draft) => {
      draft.spec.resource.verbsDescription = []
      draft.spec.resource.compareScope = 'fullSpec'
    }))).toEqual([])
  })

  it('an absent list equals an empty one (configurationFields: [] on the live CR)', () => {
    expect(immutableFieldDiff(live(), edited((draft) => { delete draft.spec.resource.configurationFields }))).toEqual([])
    expect(immutableFieldDiff(live(), edited((draft) => { draft.spec.resource.excludedSpecFields = [] }))).toEqual([])
  })

  it('names each locked field that would change, with before and after', () => {
    const changes = immutableFieldDiff(live(), edited((draft) => {
      draft.spec.resource.kind = 'IssueLabel'
      draft.spec.resourceGroup = 'labels.github.krateo.io'
      draft.spec.resource.identifiers = ['id']
      draft.spec.resource.excludedSpecFields = ['color']
    }))
    expect(changes.map(({ after, before, field }) => ({ after, before, field }))).toEqual([
      { after: 'IssueLabel', before: 'Label', field: 'kind' },
      { after: 'labels.github.krateo.io', before: 'github.krateo.io', field: 'resourceGroup' },
      { after: ['id'], before: ['name'], field: 'identifiers' },
      { after: ['color'], before: [], field: 'excludedSpecFields' },
    ])
    expect(changes[0].sentence).toBe('kind is immutable once published: "Label" → "IssueLabel" would be rejected; changing it means deleting the RestDefinition (and every resource of the Kind) and recreating it.')
  })

  it('compares lists in order, as the apiserver does', () => {
    const changes = immutableFieldDiff(live(), edited((draft) => { draft.spec.resource.additionalStatusFields = ['node_id', 'id', 'url', 'default'] }))
    expect(changes.map((change) => change.field)).toEqual(['additionalStatusFields'])
  })

  it('compares configurationFields structurally, not by key order', () => {
    const entry = { fromOpenAPI: { in: 'header', name: 'X-GitHub-Api-Version' }, fromRestDefinition: { actions: ['*'] } }
    // Parsed from text so the key order is the reverse of `entry`'s (a literal would be key-sorted by lint).
    const reordered: unknown = JSON.parse('{"fromRestDefinition":{"actions":["*"]},"fromOpenAPI":{"name":"X-GitHub-Api-Version","in":"header"}}')
    expect(Object.keys(reordered as object)).toEqual(['fromRestDefinition', 'fromOpenAPI'])
    const published = edited((draft) => { draft.spec.resource.configurationFields = [entry] })
    expect(immutableFieldDiff(published, edited((draft) => { draft.spec.resource.configurationFields = [reordered] }))).toEqual([])
    expect(immutableFieldDiff(published, live()).map((change) => change.field)).toEqual(['configurationFields'])
  })
})
