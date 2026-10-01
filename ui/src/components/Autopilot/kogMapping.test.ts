/**
 * FE-K1 — pure-logic coverage of the KOG RestDefinition mapper/validator:
 *   - parseOasPath admits EXACTLY the two live-CRD forms (configmap:// + http(s)://);
 *   - validateRestDefinitionDraft mirrors the live CRD (required fields, enums,
 *     findby-only fields, requestFieldMapping exactly-one-of, DNS names);
 *   - restDefImmutabilityWarnings surfaces every CEL-immutable field the draft sets;
 *   - the oasgen 0.23.0 fields (fieldMapping, transforms, async, pagination, headers/queries,
 *     status-code lists, compareScope, apiRefs) validate, and unknown keys are rejected.
 * Fixtures mirror the oasgen samples (mlflow URL path; a github-style configmap path).
 */
import { describe, expect, it } from 'vitest'

import {
  parseOasPath,
  restDefImmutabilityWarnings,
  validateRestDefinitionDraft,
} from './kogMapping'

/** The oasgen mlflow sample (URL-first path), verbatim shape. */
const mlflowDraft = {
  apiVersion: 'ogen.krateo.io/v1alpha1',
  kind: 'RestDefinition',
  metadata: { name: 'mlflow-experiments', namespace: 'krateo-system' },
  spec: {
    oasPath: 'https://raw.githubusercontent.com/krateoplatformops/mlflow-oas3/main/mlflow.yaml',
    resource: {
      identifiers: ['experiment_id'],
      kind: 'Experiment',
      verbsDescription: [
        { action: 'create', method: 'POST', path: '/api/2.0/mlflow/experiments/create' },
        { action: 'delete', method: 'POST', path: '/api/2.0/mlflow/experiments/delete' },
        { action: 'get', method: 'GET', path: '/api/2.0/mlflow/experiments/get' },
        { action: 'update', method: 'POST', path: '/api/2.0/mlflow/experiments/update' },
      ],
    },
    resourceGroup: 'local.mlflow.com',
  },
}

/** A github-style paste-path draft (configmap:// oasPath + requestFieldMapping + findby). */
const repoDraft = {
  apiVersion: 'ogen.krateo.io/v1alpha1',
  kind: 'RestDefinition',
  metadata: { name: 'repo', namespace: 'krateo-system' },
  spec: {
    oasPath: 'configmap://krateo-system/repo-oas/openapi.yaml',
    resource: {
      identifiers: ['id'],
      kind: 'Repo',
      verbsDescription: [
        { action: 'create', method: 'POST', path: '/orgs/{org}/repos' },
        {
          action: 'get',
          method: 'GET',
          path: '/repos/{owner}/{repo}',
          requestFieldMapping: [{ inCustomResource: 'spec.name', inPath: 'repo' }],
        },
        { action: 'findby', identifiersMatchPolicy: 'AND', method: 'GET', path: '/orgs/{org}/repos' },
      ],
    },
    resourceGroup: 'github.kog.example.org',
  },
}

/** Deep-clone + apply a mutation — fixtures stay pristine. */
const withDraft = (mutate: (draft: typeof repoDraft) => void): Record<string, unknown> => {
  const clone = JSON.parse(JSON.stringify(repoDraft)) as typeof repoDraft
  mutate(clone)
  return clone as unknown as Record<string, unknown>
}

describe('parseOasPath — exactly the two live-CRD forms', () => {
  it('parses configmap://<ns>/<name>/<key> and http(s):// URLs', () => {
    expect(parseOasPath('configmap://krateo-system/repo-oas/openapi.yaml'))
      .toEqual({ form: 'configmap', key: 'openapi.yaml', name: 'repo-oas', namespace: 'krateo-system' })
    expect(parseOasPath('https://example.org/oas.yaml')).toEqual({ form: 'url', url: 'https://example.org/oas.yaml' })
    // http is first-class per the live CRD pattern (https?://) — not https-only
    expect(parseOasPath('http://example.org/oas.yaml')).toEqual({ form: 'url', url: 'http://example.org/oas.yaml' })
    // the 0.23 key class [a-zA-Z0-9._-] admits a literal dash
    expect(parseOasPath('configmap://ns/name/open-api.yaml'))
      .toEqual({ form: 'configmap', key: 'open-api.yaml', name: 'name', namespace: 'ns' })
  })

  it('rejects every other form', () => {
    expect(parseOasPath('file:///tmp/oas.yaml')).toBeNull()
    expect(parseOasPath('ftp://example.org/oas.yaml')).toBeNull()
    expect(parseOasPath('configmap://only-two/segments')).toBeNull()
    expect(parseOasPath('configmap://a/b/c/d')).toBeNull()
    expect(parseOasPath('configmap://Bad_NS/name/key.yaml')).toBeNull()
    expect(parseOasPath('configmap://ns/name/bad key')).toBeNull()
    // the 0.23 pattern: namespace / name are [a-z0-9-]+ (no dots)
    expect(parseOasPath('configmap://ns/name.with.dots/key.yaml')).toBeNull()
    expect(parseOasPath('')).toBeNull()
    expect(parseOasPath(42)).toBeNull()
  })
})

describe('validateRestDefinitionDraft — mirrors the live CRD shape', () => {
  it('accepts the mlflow (URL) and repo (configmap + findby + mapping) fixtures', () => {
    expect(validateRestDefinitionDraft(mlflowDraft)).toEqual([])
    expect(validateRestDefinitionDraft(repoDraft as unknown as Record<string, unknown>)).toEqual([])
  })

  it('requires the envelope: apiVersion, kind, DNS-1123 metadata name + namespace', () => {
    expect(validateRestDefinitionDraft({})).toEqual(expect.arrayContaining([
      expect.stringContaining('apiVersion must be ogen.krateo.io/v1alpha1'),
      expect.stringContaining('kind must be RestDefinition'),
      expect.stringContaining('metadata.name is required'),
      expect.stringContaining('metadata.namespace is required'),
      expect.stringContaining('spec is required'),
    ]))
    expect(validateRestDefinitionDraft(withDraft((draft) => {
      draft.metadata.name = 'Not_A_DNS_Name'
    }))).toContainEqual(expect.stringContaining('metadata.name'))
  })

  it('requires oasPath / resourceGroup / resource.kind / a non-empty verbsDescription', () => {
    const errors = validateRestDefinitionDraft({
      apiVersion: 'ogen.krateo.io/v1alpha1',
      kind: 'RestDefinition',
      metadata: { name: 'x', namespace: 'krateo-system' },
      spec: { resource: { verbsDescription: [] } },
    })
    expect(errors).toEqual(expect.arrayContaining([
      expect.stringContaining('spec.oasPath is required'),
      expect.stringContaining('spec.resourceGroup is required'),
      expect.stringContaining('spec.resource.kind is required'),
      expect.stringContaining('verbsDescription requires at least one'),
    ]))
  })

  it('rejects a non-form oasPath and a non-subdomain resourceGroup', () => {
    expect(validateRestDefinitionDraft(withDraft((draft) => {
      draft.spec.oasPath = 'file:///oas.yaml'
    }))).toContainEqual(expect.stringContaining('spec.oasPath must be configmap://'))
    expect(validateRestDefinitionDraft(withDraft((draft) => {
      draft.spec.resourceGroup = 'Not A Group'
    }))).toContainEqual(expect.stringContaining('resourceGroup must be a DNS subdomain'))
  })

  it('enforces the verb enums (uppercase methods) and the required path', () => {
    const errors = validateRestDefinitionDraft(withDraft((draft) => {
      draft.spec.resource.verbsDescription = [
        { action: 'list', method: 'GET', path: '/x' } as never,
        { action: 'get', method: 'get', path: '/x' } as never,
        { action: 'get', method: 'GET' } as never,
      ]
    }))
    expect(errors).toEqual(expect.arrayContaining([
      expect.stringContaining('verbsDescription[0]: action must be one of create|update|get|delete|findby'),
      expect.stringContaining('verbsDescription[1]: method must be one of GET|POST|PUT|DELETE|PATCH'),
      expect.stringContaining('verbsDescription[2]: path is required'),
    ]))
  })

  it('confines identifiersMatchPolicy + pagination to findby actions (the CRD CEL rules)', () => {
    const errors = validateRestDefinitionDraft(withDraft((draft) => {
      draft.spec.resource.verbsDescription = [
        { action: 'create', identifiersMatchPolicy: 'AND', method: 'POST', pagination: { type: 'continuationToken' }, path: '/x' } as never,
        { action: 'findby', identifiersMatchPolicy: 'XOR', method: 'GET', path: '/x' } as never,
      ]
    }))
    expect(errors).toEqual(expect.arrayContaining([
      expect.stringContaining('verbsDescription[0]: identifiersMatchPolicy can only be set on a findby action'),
      expect.stringContaining('verbsDescription[0]: pagination can only be set on a findby action'),
      expect.stringContaining('verbsDescription[1]: identifiersMatchPolicy must be AND or OR'),
    ]))
  })

  it('enforces requestFieldMapping: exactly one of inPath|inQuery|inBody + inCustomResource', () => {
    const errors = validateRestDefinitionDraft(withDraft((draft) => {
      draft.spec.resource.verbsDescription = [{
        action: 'get',
        method: 'GET',
        path: '/x',
        requestFieldMapping: [
          { inCustomResource: 'spec.a' },
          { inCustomResource: 'spec.b', inPath: 'b', inQuery: 'b' },
          { inQuery: 'c' },
        ],
      } as never]
    }))
    expect(errors).toEqual(expect.arrayContaining([
      expect.stringContaining('requestFieldMapping[0]: exactly one of inPath|inQuery|inBody must be set (got 0)'),
      expect.stringContaining('requestFieldMapping[1]: exactly one of inPath|inQuery|inBody must be set (got 2)'),
      expect.stringContaining('requestFieldMapping[2]: inCustomResource is required'),
    ]))
  })

  it('validates configurationFields entries (fromOpenAPI{name,in} + fromRestDefinition.actions ≥ 1)', () => {
    const errors = validateRestDefinitionDraft(withDraft((draft) => {
      (draft.spec.resource as Record<string, unknown>).configurationFields = [
        { fromOpenAPI: { name: 'api_url' }, fromRestDefinition: { actions: [] } },
      ]
    }))
    expect(errors).toEqual(expect.arrayContaining([
      expect.stringContaining('configurationFields[0]: fromOpenAPI{name, in} is required'),
      expect.stringContaining('configurationFields[0]: fromRestDefinition.actions requires at least one entry'),
    ]))
  })
})

describe('validateRestDefinitionDraft — the oasgen 0.23.0 fields', () => {
  /** Set `patch` on verbsDescription[index] of the repo fixture. */
  const withVerb = (index: number, patch: Record<string, unknown>): Record<string, unknown> => withDraft((draft) => {
    Object.assign(draft.spec.resource.verbsDescription[index], patch)
  })
  /** Set `patch` on spec.resource of the repo fixture. */
  const withResource = (patch: Record<string, unknown>): Record<string, unknown> => withDraft((draft) => {
    Object.assign(draft.spec.resource, patch)
  })

  it('accepts a draft using every 0.23 field correctly', () => {
    const draft = withDraft((draft) => {
      const resource = draft.spec.resource as Record<string, unknown>
      resource.compareScope = 'identifiersAndStatus'
      resource.observeApiRef = {
        extras: { apiVersion: '2024-01-01' },
        name: 'repo-observe',
        namespace: 'krateo-system',
        notFoundExpr: { inline: '.status.id == null' },
        upToDateExpr: { entrypoint: 'upToDate', ref: 'configmap://krateo-system/repo-jq/checks.jq' },
      }
      resource.createApiRef = { name: 'repo-create', namespace: 'krateo-system' }
      const [create, get, findby] = draft.spec.resource.verbsDescription as Record<string, unknown>[]
      Object.assign(create, {
        async: {
          mode: 'requeue',
          operationRef: { in: 'header', jq: { inline: 'split("/") | last' }, path: 'Location' },
          poll: {
            failureValues: ['FAILED'],
            handleParam: 'id',
            intervalSeconds: 2,
            maxAttempts: 30,
            method: 'GET',
            path: '/operations/{id}',
            statusPath: '$.status',
            successValues: ['DONE'],
            timeoutSeconds: 600,
          },
          postGet: true,
        },
        fieldMapping: [
          {
            inBody: 'visibility',
            inCustomResource: 'spec.visibility',
            valueMapping: { aliases: [{ apiValue: 'private', customResourceValue: 'hidden' }], type: 'alias' },
          },
          {
            inBody: 'token',
            resolver: { secretRef: { keyFromCustomResource: 'spec.tokenKey', nameFromCustomResource: 'spec.tokenSecret' }, type: 'secretRef' },
          },
          {
            defaultIfAbsent: false,
            inCustomResource: 'status.archived',
            inResponse: 'archived',
            valueMapping: { jq: { inline: '. // false' }, type: 'jq' },
          },
        ],
        headers: [{ name: 'Accept', value: 'application/vnd.github+json' }],
        queries: [{ name: 'api-version', value: '2024-01-01' }],
        requestTransform: { inline: '.' },
        successCodes: [201, 202],
      })
      Object.assign(get, {
        notFoundBody: { inline: '.deleted == true' },
        notFoundCodes: [410],
        responseTransform: { inline: '.data' },
        tolerateCodes: [404],
      })
      Object.assign(findby, {
        pagination: {
          continuationToken: { request: { tokenIn: 'query', tokenPath: 'page' }, response: { tokenIn: 'header', tokenPath: 'Link' } },
          type: 'continuationToken',
        },
      })
    })
    expect(validateRestDefinitionDraft(draft)).toEqual([])
  })

  it('rejects unknown fields at every object level (the apiserver would prune them)', () => {
    const errors = validateRestDefinitionDraft(withDraft((draft) => {
      const verbs = draft.spec.resource.verbsDescription as Record<string, unknown>[]
      ;(draft.spec as Record<string, unknown>).oasVersion = '3'
      ;(draft.spec.resource as Record<string, unknown>).drift = 'off'
      verbs[0].retries = 3
      verbs[1].fieldMapping = [{ inPath: 'repo', transform: 'x' }]
      verbs[1].responseTransform = { inline: '.', lang: 'jq' }
    }))
    expect(errors).toEqual(expect.arrayContaining([
      expect.stringContaining('spec: unknown field "oasVersion"'),
      expect.stringContaining('spec.resource: unknown field "drift"'),
      expect.stringContaining('verbsDescription[0]: unknown field "retries"'),
      expect.stringContaining('verbsDescription[1].fieldMapping[0]: unknown field "transform"'),
      expect.stringContaining('verbsDescription[1].responseTransform: unknown field "lang"'),
    ]))
  })

  it('fieldMapping: exactly one anchor, resolver request-only, valueMapping tiers', () => {
    const errors = validateRestDefinitionDraft(withVerb(1, {
      fieldMapping: [
        { inCustomResource: 'spec.a' },
        { inPath: 'a', inResponse: 'a' },
        { inResponse: 'id', resolver: { secretRef: { keyFromCustomResource: 'k', nameFromCustomResource: 'n' }, type: 'secretRef' } },
        { inBody: 'b', valueMapping: { type: 'alias' } },
        { inBody: 'c', valueMapping: { type: 'jq' } },
        { inBody: 'd', valueMapping: { type: 'lookup' } },
        { inBody: 'e', resolver: { type: 'secretRef' } },
        { inBody: 'f', valueMapping: { aliases: [{ apiValue: 'x' }], type: 'alias' } },
      ],
    }))
    expect(errors).toEqual(expect.arrayContaining([
      expect.stringContaining('fieldMapping[0]: exactly one of inPath|inQuery|inBody|inResponse must be set (got 0)'),
      expect.stringContaining('fieldMapping[1]: exactly one of inPath|inQuery|inBody|inResponse must be set (got 2)'),
      expect.stringContaining('fieldMapping[2]: resolver is only valid on a request-direction entry'),
      expect.stringContaining('fieldMapping[3].valueMapping: aliases must be set when type is alias'),
      expect.stringContaining('fieldMapping[4].valueMapping: jq must be set when type is jq'),
      expect.stringContaining('fieldMapping[5].valueMapping.type must be one of alias|jq'),
      expect.stringContaining('fieldMapping[6].resolver: secretRef must be set when type is secretRef'),
      expect.stringContaining('fieldMapping[7].valueMapping.aliases[0].customResourceValue is required'),
    ]))
  })

  it('transforms: a jq program needs exactly one of inline|ref, entrypoint only with ref, a valid ref URI', () => {
    const errors = validateRestDefinitionDraft(withVerb(1, {
      notFoundBody: { entrypoint: 'f', inline: 'true' },
      requestTransform: {},
      responseTransform: { inline: '.', ref: 'https://example.org/t.jq' },
    }))
    expect(errors).toEqual(expect.arrayContaining([
      expect.stringContaining('verbsDescription[1].requestTransform: exactly one of inline|ref must be set'),
      expect.stringContaining('verbsDescription[1].responseTransform: exactly one of inline|ref must be set'),
      expect.stringContaining('verbsDescription[1].notFoundBody: entrypoint is only valid together with ref'),
    ]))
    expect(validateRestDefinitionDraft(withVerb(1, { responseTransform: { ref: 'file:///t.jq' } })))
      .toContainEqual(expect.stringContaining('verbsDescription[1].responseTransform.ref must be configmap://'))
  })

  it('async: required operationRef + poll, enums, the {handleParam} token, mutating verbs only', () => {
    const errors = validateRestDefinitionDraft(withVerb(0, {
      async: { mode: 'eventually', operationRef: { in: 'cookie' }, poll: { path: '/operations/{id}', statusPath: 'status', successValues: [] } },
    }))
    expect(errors).toEqual(expect.arrayContaining([
      expect.stringContaining('verbsDescription[0].async.mode must be one of blocking|requeue'),
      expect.stringContaining('verbsDescription[0].async.operationRef.in must be one of body|header'),
      expect.stringContaining('verbsDescription[0].async.operationRef.path is required'),
      expect.stringContaining('verbsDescription[0].async.poll.successValues requires at least 1 entry'),
      expect.stringContaining('verbsDescription[0].async.poll.path must contain the {operationId} token'),
    ]))
    expect(validateRestDefinitionDraft(withVerb(0, { async: {} }))).toEqual(expect.arrayContaining([
      expect.stringContaining('verbsDescription[0].async.operationRef is required'),
      expect.stringContaining('verbsDescription[0].async.poll is required'),
    ]))
    expect(validateRestDefinitionDraft(withVerb(1, {
      async: { operationRef: { in: 'body', path: '$.id' }, poll: { path: '/ops/{operationId}', statusPath: 'status', successValues: ['ok'] } },
    }))).toContainEqual(expect.stringContaining('verbsDescription[1]: async can only be set on a create, update or delete action'))
  })

  it('pagination: continuationToken shape (request query, response header)', () => {
    expect(validateRestDefinitionDraft(withVerb(2, { pagination: { type: 'continuationToken' } })))
      .toContainEqual(expect.stringContaining('verbsDescription[2].pagination: continuationToken must be set when type is continuationToken'))
    const errors = validateRestDefinitionDraft(withVerb(2, {
      pagination: { continuationToken: { request: { tokenIn: 'header', tokenPath: 'p' }, response: { tokenIn: 'header' } }, type: 'offset' },
    }))
    expect(errors).toEqual(expect.arrayContaining([
      expect.stringContaining('verbsDescription[2].pagination.type must be one of continuationToken'),
      expect.stringContaining('pagination.continuationToken.request.tokenIn must be one of query'),
      expect.stringContaining('pagination.continuationToken.response.tokenPath is required'),
    ]))
  })

  it('headers / queries need {name, value}; the status-code lists must be integers', () => {
    const errors = validateRestDefinitionDraft(withVerb(1, {
      headers: [{ name: 'Accept' }],
      notFoundCodes: ['410'],
      queries: [{ value: 'v' }],
      successCodes: [201.5],
      tolerateCodes: 404,
    }))
    expect(errors).toEqual(expect.arrayContaining([
      expect.stringContaining('verbsDescription[1].headers[0].value is required'),
      expect.stringContaining('verbsDescription[1].queries[0].name is required'),
      expect.stringContaining('verbsDescription[1].successCodes must be a list of integers'),
      expect.stringContaining('verbsDescription[1].tolerateCodes must be a list of integers'),
      expect.stringContaining('verbsDescription[1].notFoundCodes must be a list of integers'),
    ]))
  })

  it('compareScope: enum, identifiersAndStatus needs identifiers/status fields, updatable needs an update verb', () => {
    expect(validateRestDefinitionDraft(withResource({ compareScope: 'everything' })))
      .toContainEqual(expect.stringContaining('resource.compareScope must be one of fullSpec|identifiersAndStatus|updatable'))
    expect(validateRestDefinitionDraft(withResource({ compareScope: 'identifiersAndStatus', identifiers: [] })))
      .toContainEqual(expect.stringContaining('compareScope identifiersAndStatus requires at least one identifier or additionalStatusField'))
    expect(validateRestDefinitionDraft(withResource({ compareScope: 'updatable' })))
      .toContainEqual(expect.stringContaining('compareScope updatable requires an update verb'))
    expect(validateRestDefinitionDraft(withResource({ compareScope: 'fullSpec' }))).toEqual([])
  })

  it('apiRefs: name + namespace required, the createApiRef CEL preconditions, observe-only predicates', () => {
    const errors = validateRestDefinitionDraft(withResource({
      createApiRef: { name: 'c', namespace: 'krateo-system', upToDateExpr: { inline: 'true' } },
      deleteApiRef: 'd',
      observeApiRef: { name: 'o' },
      verbsDescription: [{ action: 'create', method: 'POST', path: '/x' }],
    }))
    expect(errors).toEqual(expect.arrayContaining([
      expect.stringContaining('resource.createApiRef requires a get or findby verb'),
      expect.stringContaining('resource.createApiRef with observeApiRef requires observeApiRef.notFoundExpr'),
      expect.stringContaining('resource.observeApiRef.namespace is required'),
      expect.stringContaining('resource.createApiRef: notFoundExpr and upToDateExpr are only evaluated on observeApiRef'),
      expect.stringContaining('resource.deleteApiRef: must be an object'),
    ]))
  })
})

describe('restDefImmutabilityWarnings — the CEL-immutable fields, surfaced BEFORE publish', () => {
  it('always warns on kind + resourceGroup, plus each optional immutable list the draft sets', () => {
    const warnings = restDefImmutabilityWarnings(withDraft((draft) => {
      (draft.spec.resource as Record<string, unknown>).excludedSpecFields = ['tags']
    }))
    expect(warnings).toEqual([
      'immutable once generated: resource.kind (Repo) — changing it later means delete + recreate',
      'immutable once generated: resourceGroup (github.kog.example.org)',
      'immutable once generated: identifiers (id)',
      'immutable once generated: excludedSpecFields (tags)',
    ])
  })

  it('still warns (without echoes) on an empty draft — the duty to warn never disappears', () => {
    expect(restDefImmutabilityWarnings({})).toEqual([
      'immutable once generated: resource.kind — changing it later means delete + recreate',
      'immutable once generated: resourceGroup',
    ])
  })
})
