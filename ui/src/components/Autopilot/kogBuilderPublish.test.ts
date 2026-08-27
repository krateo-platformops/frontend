/**
 * UI-NATIVE KOG BUILDER (item C) — pure-logic coverage of the build→publish WIRING
 * (compileKogBuilderPublish). Proves the UI-native path reuses the EXACT Autopilot machinery:
 *   - a valid URL draft compiles to the SAME gitref → repocontents(restdefinition) → pullrequest
 *     op set buildKogPublishAsPrOps produces, and that set passes the applyResourceSet scoping kernel;
 *   - a valid paste draft (configmap:// oasPath) additionally commits the OAS ConfigMap manifest with
 *     the held document embedded VERBATIM (the held-client-side guarantee), and rewrites the committed
 *     RestDefinition's oasPath to that git-shipped ConfigMap;
 *   - a paste draft with NO held document is DENIED (missingOasDocument), same as the Autopilot flow;
 *   - a field-invalid draft is DENIED via the SAME validateRestDefinitionDraft (nothing compiled);
 *   - the repo coords default from KOG_REPO_DEFAULTS and are overridable.
 */
import { load } from 'js-yaml'
import { describe, expect, it } from 'vitest'

import { isApplySetAllowed } from './applyResourceSet'
import { compileKogBuilderPublish } from './kogBuilderPublish'
import { KOG_REPO_DEFAULTS } from './kogPublish'
import type { RestDefinitionDraftInput } from './restDefinitionDraft'

const URL_INPUT: RestDefinitionDraftInput = {
  identifiers: ['experiment_id'],
  name: 'mlflow-experiments',
  namespace: 'krateo-system',
  oasPath: 'https://raw.githubusercontent.com/x/mlflow-oas3/main/mlflow.yaml',
  resourceGroup: 'local.mlflow.com',
  resourceKind: 'Experiment',
  verbs: [{ action: 'get', method: 'GET', path: '/api/2.0/mlflow/experiments/get' }],
}

const PASTE_INPUT: RestDefinitionDraftInput = {
  ...URL_INPUT,
  name: 'repo',
  oasPath: 'configmap://krateo-system/repo-oas/openapi.yaml',
  resourceKind: 'Repo',
  verbs: [{ action: 'get', method: 'GET', path: '/repos/{owner}/{repo}' }],
}

const OAS_DOC = 'openapi: 3.0.0\ninfo:\n  title: Repo API\n  version: 1.0.0\npaths: {}\n'

const decodeB64 = (b64: string): string => Buffer.from(b64, 'base64').toString('utf-8')

describe('compileKogBuilderPublish — URL case', () => {
  it('compiles the gitref → restdefinition repocontent → pullrequest set (no ConfigMap)', () => {
    const res = compileKogBuilderPublish(URL_INPUT, {}, null)
    if (!res.ok) {
      throw new Error(`expected ok, got: ${res.errors.join('; ')}`)
    }
    expect(res.ops.map((op) => op.gvr.resource)).toEqual(['gitrefs', 'repocontents', 'pullrequests'])
    // The set passes the SAME safety kernel applyResourceSet enforces before dispatch.
    expect(isApplySetAllowed(res.ops)).toBe(true)
    // Repo coords default to the KOG registry.
    const gitref = res.ops[0].payload as { spec: { owner: string; repo: string } }
    expect(gitref.spec.owner).toBe(KOG_REPO_DEFAULTS.owner)
    expect(gitref.spec.repo).toBe(KOG_REPO_DEFAULTS.repo)
  })

  it('honors overridden owner/repo/base/title', () => {
    const res = compileKogBuilderPublish(URL_INPUT, { base: 'develop', owner: 'acme', repo: 'apis', title: 'my PR' }, null)
    if (!res.ok) {
      throw new Error('expected ok')
    }
    const gitref = res.ops[0].payload as { spec: { owner: string; repo: string } }
    const pr = res.ops[res.ops.length - 1].payload as { spec: { base: string; owner: string; title: string } }
    expect(gitref.spec.owner).toBe('acme')
    expect(pr.spec.base).toBe('develop')
    expect(pr.spec.title).toBe('my PR')
  })
})

describe('compileKogBuilderPublish — paste case', () => {
  it('commits the OAS ConfigMap with the held document embedded VERBATIM', () => {
    const res = compileKogBuilderPublish(PASTE_INPUT, {}, OAS_DOC)
    if (!res.ok) {
      throw new Error(`expected ok, got: ${res.errors.join('; ')}`)
    }
    expect(res.ops.map((op) => op.gvr.resource)).toEqual(['gitrefs', 'repocontents', 'repocontents', 'pullrequests'])
    // The 2nd repocontent is the ConfigMap manifest — its embedded data is the held doc, verbatim.
    const cmContent = res.ops[2].payload as { spec: { content: string; path: string } }
    expect(cmContent.spec.path).toMatch(/configmaps\/repo-oas\.yaml$/)
    const manifest = load(decodeB64(cmContent.spec.content)) as { data: Record<string, string> }
    expect(manifest.data['openapi.yaml']).toBe(OAS_DOC)
    // The committed RestDefinition's oasPath points at the git-shipped ConfigMap.
    const restContent = res.ops[1].payload as { spec: { content: string } }
    const restDef = load(decodeB64(restContent.spec.content)) as { spec: { oasPath: string } }
    expect(restDef.spec.oasPath).toBe('configmap://krateo-system/repo-oas/openapi.yaml')
    expect(isApplySetAllowed(res.ops)).toBe(true)
  })

  it('DENIES a paste-case draft with no held document (missingOasDocument)', () => {
    const res = compileKogBuilderPublish(PASTE_INPUT, {}, null)
    expect(res.ok).toBe(false)
    if (res.ok) {
      throw new Error('expected denial')
    }
    expect(res.errors.join('\n')).toMatch(/configmap:\/\/|no OpenAPI document/)
  })
})

describe('compileKogBuilderPublish — validation denial', () => {
  it('DENIES a field-invalid draft (bad verb enum) with the shared validator errors', () => {
    const res = compileKogBuilderPublish({ ...URL_INPUT, verbs: [{ action: 'fetch', method: 'get', path: '/x' }] }, {}, null)
    expect(res.ok).toBe(false)
    if (res.ok) {
      throw new Error('expected denial')
    }
    expect(res.errors.join('\n')).toMatch(/action must be one of/)
  })

  it('DENIES an empty draft (missing required fields)', () => {
    const res = compileKogBuilderPublish(
      { name: '', namespace: '', oasPath: '', resourceGroup: '', resourceKind: '', verbs: [{ action: 'get', method: 'GET', path: '' }] },
      {},
      null,
    )
    expect(res.ok).toBe(false)
  })
})
