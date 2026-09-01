/**
 * FE-KOG-PR (item #30) — pure-logic coverage of the PR-based KOG publish:
 *   - buildKogPublishAsPrOps fans one `publishRestDef` verb into gitref → repocontents → pullrequest,
 *     URL case (RestDefinition only) + paste case (RestDefinition + OAS ConfigMap manifest);
 *   - the OAS document rides into the committed ConfigMap manifest VERBATIM (the held-in-portal
 *     guarantee), and the committed RestDefinition's oasPath is rewritten to that git-shipped ConfigMap;
 *   - resolveKogPublishDraft discriminates URL vs paste from the DRAFT's oasPath and refuses a
 *     paste-case publish with no held document;
 *   - the built set passes the applyResourceSet safety kernel and defaults/overrides the repo coords.
 */
import { load } from 'js-yaml'
import { describe, expect, it } from 'vitest'

import { isApplySetAllowed } from './applyResourceSet'
import {
  buildKogPublishAsPrOps,
  resolveKogPublishDraft,
} from './kogPublish'

const payloadOf = (op: { payload?: unknown }): Record<string, unknown> => op.payload as Record<string, unknown>
const specOf = (op: { payload?: unknown }): Record<string, unknown> => payloadOf(op).spec as Record<string, unknown>

/** A URL-oasPath RestDefinition draft (the URL-first case). */
const URL_DRAFT: Record<string, unknown> = {
  apiVersion: 'ogen.krateo.io/v1alpha1',
  kind: 'RestDefinition',
  metadata: { name: 'mlflow-experiments', namespace: 'krateo-system' },
  spec: {
    oasPath: 'https://raw.githubusercontent.com/x/mlflow-oas3/main/mlflow.yaml',
    resource: {
      identifiers: ['experiment_id'],
      kind: 'Experiment',
      verbsDescription: [{ action: 'get', method: 'GET', path: '/api/2.0/mlflow/experiments/get' }],
    },
    resourceGroup: 'local.mlflow.com',
  },
}

/** A configmap-oasPath RestDefinition draft (the paste case). */
const PASTE_DRAFT: Record<string, unknown> = {
  apiVersion: 'ogen.krateo.io/v1alpha1',
  kind: 'RestDefinition',
  metadata: { name: 'repo', namespace: 'krateo-system' },
  spec: {
    oasPath: 'configmap://krateo-system/repo-oas/openapi.yaml',
    resource: {
      identifiers: ['id'],
      kind: 'Repo',
      verbsDescription: [{ action: 'get', method: 'GET', path: '/repos/{owner}/{repo}' }],
    },
    resourceGroup: 'github.kog.example.org',
  },
}

const OAS_DOC = 'openapi: 3.0.0\ninfo:\n  title: Repo API\n  version: 1.0.0\npaths: {}\n'

/** base64 → utf-8 (Node) — to assert the committed file bytes round-trip. */
const decodeB64 = (b64: string): string => Buffer.from(b64, 'base64').toString('utf-8')

describe('resolveKogPublishDraft — URL vs paste discrimination from the draft oasPath', () => {
  it('URL oasPath → held draft, no OAS document needed', () => {
    const res = resolveKogPublishDraft(URL_DRAFT, null)
    expect(res.missingOasDocument).toBe(false)
    expect(res.held).toMatchObject({ kind: 'mlflow-experiments' })
    expect(res.held?.oasDocument).toBeUndefined()
  })

  it('configmap:// oasPath WITH a held document → held draft carrying the document', () => {
    const res = resolveKogPublishDraft(PASTE_DRAFT, OAS_DOC)
    expect(res.missingOasDocument).toBe(false)
    expect(res.held).toMatchObject({ kind: 'repo', oasDocument: OAS_DOC })
  })

  it('configmap:// oasPath WITHOUT a held document → refused (missingOasDocument)', () => {
    const res = resolveKogPublishDraft(PASTE_DRAFT, null)
    expect(res.held).toBeNull()
    expect(res.missingOasDocument).toBe(true)
  })

  it('a draft with no metadata.name or no valid oasPath → nothing publishable', () => {
    expect(resolveKogPublishDraft({ spec: { oasPath: 'https://x/y.yaml' } }, null).held).toBeNull()
    expect(resolveKogPublishDraft({ metadata: { name: 'x' }, spec: { oasPath: 'ftp://nope' } }, null).held).toBeNull()
    expect(resolveKogPublishDraft(null, null).held).toBeNull()
  })
})

describe('buildKogPublishAsPrOps — URL case (RestDefinition only)', () => {
  const held = resolveKogPublishDraft(URL_DRAFT, null).held!
  const ops = buildKogPublishAsPrOps({}, held)

  it('fans into gitref → ONE repocontents (restdefinition.yaml) → pullrequest, all POST github.krateo.io', () => {
    expect(ops.map((op) => op.gvr.resource)).toEqual(['gitrefs', 'repocontents', 'pullrequests'])
    expect(ops.every((op) => op.verb === 'POST')).toBe(true)
    expect(ops.every((op) => op.gvr.group === 'github.krateo.io' && op.gvr.version === 'v1alpha1')).toBe(true)
    expect(ops.every((op) => op.namespace === 'krateo-system')).toBe(true)
  })

  it('each op payload is a FULL CR (apiVersion + kind + metadata.name + spec)', () => {
    expect(ops.map((op) => payloadOf(op).kind)).toEqual(['GitRef', 'RepoContent', 'PullRequest'])
    for (const op of ops) {
      const pl = payloadOf(op)
      expect(pl.apiVersion).toBe('github.krateo.io/v1alpha1')
      const md = pl.metadata as Record<string, unknown>
      expect((md.name as string).length).toBeGreaterThan(0)
      expect(pl.spec).toBeTypeOf('object')
    }
  })

  it('cuts the builder branch from the kind and OMITS sha', () => {
    const spec = specOf(ops[0])
    expect(spec.ref).toBe('refs/heads/builder/mlflow-experiments')
    expect(spec).not.toHaveProperty('sha')
  })

  it('commits the RestDefinition YAML at apis/<kind>/restdefinition.yaml (URL oasPath unchanged)', () => {
    const [, rc] = ops
    const spec = specOf(rc)
    expect(spec.path).toBe('apis/mlflow-experiments/restdefinition.yaml')
    expect(spec.branch).toBe('builder/mlflow-experiments')
    const committed = load(decodeB64(spec.content as string)) as Record<string, unknown>
    expect(committed.kind).toBe('RestDefinition')
    expect((committed.spec as Record<string, unknown>).oasPath).toBe(URL_DRAFT.spec && (URL_DRAFT.spec as Record<string, unknown>).oasPath)
  })

  it('opens the PR from the builder branch into base', () => {
    const spec = specOf(ops[ops.length - 1])
    expect(spec.head).toBe('builder/mlflow-experiments')
    expect(spec.base).toBe('main')
  })

  it('passes the applyResourceSet safety kernel', () => {
    expect(isApplySetAllowed(ops)).toBe(true)
  })
})

describe('buildKogPublishAsPrOps — paste case (RestDefinition + OAS ConfigMap manifest)', () => {
  const held = resolveKogPublishDraft(PASTE_DRAFT, OAS_DOC).held!
  const ops = buildKogPublishAsPrOps({}, held)

  it('fans into gitref → TWO repocontents (restdefinition + oas configmap) → pullrequest', () => {
    expect(ops.map((op) => op.gvr.resource)).toEqual(['gitrefs', 'repocontents', 'repocontents', 'pullrequests'])
    const paths = ops.filter((op) => op.gvr.resource === 'repocontents').map((op) => specOf(op).path)
    expect(paths).toEqual(['apis/repo/restdefinition.yaml', 'configmaps/repo-oas.yaml'])
  })

  it('embeds the OAS document VERBATIM in the committed ConfigMap manifest (held-in-portal guarantee)', () => {
    const cmOp = ops.find((op) => specOf(op).path === 'configmaps/repo-oas.yaml')!
    const manifest = load(decodeB64(specOf(cmOp).content as string)) as Record<string, unknown>
    expect(manifest.kind).toBe('ConfigMap')
    expect((manifest.metadata as Record<string, unknown>).name).toBe('repo-oas')
    expect((manifest.metadata as Record<string, unknown>).labels).toEqual({ 'krateo.io/managed-by': 'kog-builder' })
    // The document bytes round-trip EXACTLY — never a token, never a summary.
    expect((manifest.data as Record<string, unknown>)['openapi.yaml']).toBe(OAS_DOC)
  })

  it('rewrites the committed RestDefinition oasPath to the git-shipped ConfigMap (internally consistent)', () => {
    const rdOp = ops.find((op) => specOf(op).path === 'apis/repo/restdefinition.yaml')!
    const committed = load(decodeB64(specOf(rdOp).content as string)) as Record<string, unknown>
    expect((committed.spec as Record<string, unknown>).oasPath).toBe('configmap://krateo-system/repo-oas/openapi.yaml')
  })

  it('unique RepoContent metadata.names per file + passes the safety kernel', () => {
    const rcNames = ops.filter((op) => op.gvr.resource === 'repocontents').map((op) => (payloadOf(op).metadata as { name: string }).name)
    expect(new Set(rcNames).size).toBe(rcNames.length)
    expect(isApplySetAllowed(ops)).toBe(true)
  })

  it('does NOT mutate the input draft (oasPath rewrite is on a copy)', () => {
    expect((PASTE_DRAFT.spec as Record<string, unknown>).oasPath).toBe('configmap://krateo-system/repo-oas/openapi.yaml')
    // The held draft object is the same reference; its spec must be untouched.
    expect((held.draft.spec as Record<string, unknown>).oasPath).toBe('configmap://krateo-system/repo-oas/openapi.yaml')
  })
})

describe('buildKogPublishAsPrOps — repo coordinates', () => {
  const held = resolveKogPublishDraft(URL_DRAFT, null).held!

  it('emits EMPTY owner/repo when the verb omits them — no hardcoded fallback (#163)', () => {
    const spec = specOf(buildKogPublishAsPrOps({}, held)[0])
    expect(spec.owner).toBe('')
    expect(spec.repo).toBe('')
  })

  it('honors overrides supplied by the verb', () => {
    const ops = buildKogPublishAsPrOps(
      { base: 'develop', body: 'b', configurationRef: 'other-config', message: 'm', namespace: 'kr', owner: 'acme', repo: 'my-oas', title: 't' },
      held,
    )
    const prSpec = specOf(ops[ops.length - 1])
    expect(prSpec.owner).toBe('acme')
    expect(prSpec.repo).toBe('my-oas')
    expect(prSpec.base).toBe('develop')
    expect(prSpec.title).toBe('t')
    expect(prSpec.body).toBe('b')
    expect(ops.every((op) => op.namespace === 'kr')).toBe(true)
  })
})
