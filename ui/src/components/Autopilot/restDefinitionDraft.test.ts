/**
 * UI-NATIVE KOG BUILDER (item C) — pure-logic coverage of the RestDefinition-draft constructor:
 *   - buildRestDefinitionDraft assembles the SAME CR shape the Autopilot previewRestDef/publish
 *     path consumes (apiVersion/kind/metadata/spec.resource.verbsDescription), trims + drops empty
 *     verb/identifier rows, and omits the optional identifiers list when it has no content;
 *   - buildAndValidateRestDefinition delegates correctness to the SAME validateRestDefinitionDraft
 *     the preview drawer uses (a complete draft is clean; missing required fields/bad enums error).
 */
import { describe, expect, it } from 'vitest'

import {
  buildAndValidateRestDefinition,
  buildRestDefinitionDraft,
  emptyRestDefinitionInput,
  type RestDefinitionDraftInput,
} from './restDefinitionDraft'

const URL_INPUT: RestDefinitionDraftInput = {
  identifiers: ['experiment_id'],
  name: 'mlflow-experiments',
  namespace: 'krateo-system',
  oasPath: 'https://raw.githubusercontent.com/x/mlflow-oas3/main/mlflow.yaml',
  resourceGroup: 'local.mlflow.com',
  resourceKind: 'Experiment',
  verbs: [{ action: 'get', method: 'GET', path: '/api/2.0/mlflow/experiments/get' }],
}

describe('buildRestDefinitionDraft — assembles the RestDefinition CR shape', () => {
  it('produces the apiVersion/kind/metadata/spec the publish machinery consumes', () => {
    const draft = buildRestDefinitionDraft(URL_INPUT)
    expect(draft).toMatchObject({
      apiVersion: 'ogen.krateo.io/v1alpha1',
      kind: 'RestDefinition',
      metadata: { name: 'mlflow-experiments', namespace: 'krateo-system' },
      spec: {
        oasPath: URL_INPUT.oasPath,
        resource: {
          identifiers: ['experiment_id'],
          kind: 'Experiment',
          verbsDescription: [{ action: 'get', method: 'GET', path: '/api/2.0/mlflow/experiments/get' }],
        },
        resourceGroup: 'local.mlflow.com',
      },
    })
  })

  it('trims fields and DROPS empty verb + identifier rows', () => {
    const draft = buildRestDefinitionDraft({
      ...URL_INPUT,
      identifiers: [' experiment_id ', '', '  '],
      name: '  spacey  ',
      verbs: [
        { action: 'get', method: 'GET', path: ' /get ' },
        { action: '', method: '', path: '' },
      ],
    })
    const spec = draft.spec as Record<string, unknown>
    const resource = spec.resource as Record<string, unknown>
    expect((draft.metadata as Record<string, unknown>).name).toBe('spacey')
    expect(resource.identifiers).toEqual(['experiment_id'])
    expect(resource.verbsDescription).toEqual([{ action: 'get', method: 'GET', path: '/get' }])
  })

  it('OMITS identifiers entirely when none are meaningful', () => {
    const draft = buildRestDefinitionDraft({ ...URL_INPUT, identifiers: ['', '  '] })
    const resource = (draft.spec as Record<string, unknown>).resource as Record<string, unknown>
    expect('identifiers' in resource).toBe(false)
  })
})

describe('buildAndValidateRestDefinition — delegates to the shared validator', () => {
  it('a complete URL draft validates clean', () => {
    const { errors } = buildAndValidateRestDefinition(URL_INPUT)
    expect(errors).toEqual([])
  })

  it('a complete configmap:// (paste) draft validates clean', () => {
    const { errors } = buildAndValidateRestDefinition({
      ...URL_INPUT,
      oasPath: 'configmap://krateo-system/mlflow-experiments-oas/openapi.yaml',
    })
    expect(errors).toEqual([])
  })

  it('an empty draft reports the required-field errors (name/group/kind/verbs/oasPath)', () => {
    const { errors } = buildAndValidateRestDefinition(emptyRestDefinitionInput())
    expect(errors.length).toBeGreaterThan(0)
    expect(errors.join('\n')).toMatch(/oasPath/)
    expect(errors.join('\n')).toMatch(/resourceGroup/)
  })

  it('a bad verb action/method is rejected by the shared enum check', () => {
    const { errors } = buildAndValidateRestDefinition({
      ...URL_INPUT,
      verbs: [{ action: 'fetch', method: 'get', path: '/x' }],
    })
    expect(errors.join('\n')).toMatch(/action must be one of/)
    expect(errors.join('\n')).toMatch(/method must be one of/)
  })
})
