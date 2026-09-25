/**
 * The controller (KOG) publish — what a `publishRestDef` commits, through the one BuilderPublish claim:
 *   - kogPublishFiles: the controller chart — URL case (RestDefinition only) + paste case
 *     (RestDefinition + OAS ConfigMap manifest);
 *   - the OAS document rides into the committed ConfigMap manifest VERBATIM (the held-in-portal
 *     guarantee), and the committed RestDefinition's oasPath is rewritten to that ConfigMap;
 *   - resolveKogPublishDraft discriminates URL vs paste from the DRAFT's oasPath and refuses a
 *     paste-case publish with no held document;
 *   - dispatchKogPublish appends the registration file only when the destination owner is known.
 */
import { load } from 'js-yaml'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./builderClaimPublish', () => ({
  buildClaimPublish: vi.fn(() => Promise.resolve({ branch: 'builder/pet', compiled: { denial: null, ops: [] }, deepLink: null })),
}))

import { buildClaimPublish } from './builderClaimPublish'
import { kogPublishFiles, resolveKogPublishDraft } from './kogPublish'
import { dispatchKogPublish } from './kogPublishDispatch'
import type { PreviewGate } from './previewGate'

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

/** The committed body of one file, by path — a chart commits several and their order is not the contract. */
const fileAt = (files: { content: string; path: string }[], path: string): Record<string, unknown> => {
  const found = files.find((file) => file.path === path)
  if (!found) { throw new Error(`no committed file ${path}`) }
  return load(found.content) as Record<string, unknown>
}

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

describe('kogPublishFiles — URL case (RestDefinition only)', () => {
  const held = resolveKogPublishDraft(URL_DRAFT, null).held!
  const files = kogPublishFiles(held)

  it('commits the controller as its own chart', () => {
    expect(files.map((file) => file.path).sort()).toEqual([
      'Chart.yaml', 'templates/restdefinition.yaml', 'values.schema.json', 'values.yaml',
    ])
  })

  it('commits the RestDefinition as a chart TEMPLATE (URL oasPath unchanged)', () => {
    const committed = fileAt(files, 'templates/restdefinition.yaml')
    expect(committed.kind).toBe('RestDefinition')
    expect((committed.spec as Record<string, unknown>).oasPath).toBe((URL_DRAFT.spec as Record<string, unknown>).oasPath)
  })
})

describe('kogPublishFiles — paste case (RestDefinition + OAS ConfigMap manifest)', () => {
  const held = resolveKogPublishDraft(PASTE_DRAFT, OAS_DOC).held!
  const files = kogPublishFiles(held)

  it('adds the OAS ConfigMap to the chart', () => {
    expect(files.map((file) => file.path).sort()).toEqual([
      'Chart.yaml', 'templates/configmap-oas.yaml', 'templates/restdefinition.yaml',
      'values.schema.json', 'values.yaml',
    ])
  })

  it('embeds the OAS document VERBATIM in the committed ConfigMap manifest (held-in-portal guarantee)', () => {
    const manifest = fileAt(files, 'templates/configmap-oas.yaml')
    expect(manifest.kind).toBe('ConfigMap')
    expect((manifest.metadata as Record<string, unknown>).name).toBe('repo-oas')
    expect((manifest.metadata as Record<string, unknown>).labels).toEqual({ 'krateo.io/managed-by': 'kog-builder' })
    // The document bytes round-trip EXACTLY — never a token, never a summary.
    expect((manifest.data as Record<string, unknown>)['openapi.yaml']).toBe(OAS_DOC)
  })

  it('rewrites the committed oasPath to the chart\'s ConfigMap, in the SAME namespace it lands in', () => {
    const committed = fileAt(files, 'templates/restdefinition.yaml')
    const cm = fileAt(files, 'templates/configmap-oas.yaml')
    const oasPath = String((committed.spec as Record<string, unknown>).oasPath)
    const cmNs = String((cm.metadata as Record<string, unknown>).namespace)
    // THE INVARIANT, not a literal: the RestDefinition resolves its document out of the ConfigMap the
    // same chart ships, so the two namespaces must be the same string — and that string is TEMPLATED,
    // so the chart installs wherever its release lands rather than where its author was working.
    expect(oasPath).toBe(`configmap://${cmNs}/repo-oas/openapi.yaml`)
    expect(cmNs).toBe('{{ .Release.Namespace }}')
  })

  it('does NOT mutate the input draft (oasPath rewrite is on a copy)', () => {
    expect((PASTE_DRAFT.spec as Record<string, unknown>).oasPath).toBe('configmap://krateo-system/repo-oas/openapi.yaml')
    expect((held.draft.spec as Record<string, unknown>).oasPath).toBe('configmap://krateo-system/repo-oas/openapi.yaml')
  })
})

describe('dispatchKogPublish — the registration file that makes a controller chart installable', () => {
  const draft = { apiVersion: 'ogen.krateo.io/v1alpha1', kind: 'RestDefinition', metadata: { name: 'pet' }, spec: { oasPath: 'https://example.test/openapi.yaml' } }
  const previewGate = { evaluate: () => ({ allowed: true }), lastDraft: () => draft } as unknown as PreviewGate
  const committedPaths = () => vi.mocked(buildClaimPublish).mock.calls[0][0].files.map((file) => file.path)

  beforeEach(() => { vi.mocked(buildClaimPublish).mockClear() })

  it('commits compositiondefinition.yaml when the destination owner is known', async () => {
    // Without it the chart releases to OCI and nothing installs it: core-provider builds the CRD from
    // values.schema.json, and only then can a claim create the RestDefinition oasgen materialises.
    await dispatchKogPublish({ owner: 'acme', repo: 'pet' }, { config: undefined, kogTarget: { owner: '', repo: '' }, oasText: null, origin: { prompt: null, sessionId: null }, previewGate })
    expect(committedPaths()).toContain('compositiondefinition.yaml')
    const cd = vi.mocked(buildClaimPublish).mock.calls[0][0].files.find((file) => file.path === 'compositiondefinition.yaml')!
    // The OCI url is <owner>/charts/<kind> — the owner half is why this file waits for the destination.
    expect(cd.content).toContain('url: oci://ghcr.io/acme/charts/pet')
  })

  it('OMITS it when no owner was confirmed, rather than guessing one', async () => {
    // #163: the frontend carries no hardcoded owner; an invented one would point at someone else's registry.
    await dispatchKogPublish({ repo: 'pet' }, { config: undefined, kogTarget: { owner: '', repo: '' }, oasText: null, origin: { prompt: null, sessionId: null }, previewGate })
    expect(committedPaths()).not.toContain('compositiondefinition.yaml')
    expect(committedPaths().sort()).toEqual(kogPublishFiles(resolveKogPublishDraft(draft, null).held!).map((file) => file.path).sort())
  })
})
