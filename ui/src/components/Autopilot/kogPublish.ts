/**
 * FE-KOG-PR — DETERMINISTIC KOG-publish op construction, PR-BASED GIT-WRITE variant.
 *
 * WHY THIS EXISTS: the ORIGINAL KOG publish (buildKogPublishOps, kogMapping.ts) was a DIRECT
 * 2-op cluster write — POST the OAS ConfigMap + POST the RestDefinition straight onto the live
 * apiserver, so the generated kind landed the instant the user confirmed. That is INCONSISTENT
 * with every other builder in the rail (blueprint / page), which publish through a REVIEWABLE
 * git PR: a human merges, CI/CD reconciles, then the object exists. This module brings the KOG
 * builder onto the SAME git-write rail (item #30).
 *
 * THE SHAPE (mirrors blueprintPublish.ts / pagePublish.ts): the model still emits ONE tiny
 * scalar publish verb with just the repo coordinates; the HOST fans it into the ordered set:
 *   1. POST gitrefs      — cut `refs/heads/builder/<kind>` (sha omitted; the git-provider
 *                          auto-resolves the base-branch HEAD).
 *   2. POST repocontents — one per file:
 *        - apis/<kind>/restdefinition.yaml   (the RestDefinition CR, ALWAYS)
 *        - configmaps/<kind>-oas.yaml         (a ConfigMap manifest carrying the OAS document
 *                                              INLINE — PASTE case only; the URL case ships no
 *                                              ConfigMap, oasgen fetches the URL itself)
 *   3. POST pullrequests — open the PR from the builder branch into `base`.
 *
 * THE OAS "HELD-IN-PORTAL" GUARANTEE IS PRESERVED. The pasted OpenAPI document is held
 * client-side in the provider's OAS store and is NEVER reproduced by the model — its publish
 * proposal carries only the scalar verb. Here, at PUBLISH-COMPILE time, the host reads the held
 * verbatim bytes and embeds them into the committed ConfigMap manifest. The model never sees or
 * retypes the document; published bytes == the bytes the user pasted. This is the git-write
 * analogue of the FE-K2 `$oasAttachment` substitution — the substitution point simply moves from
 * a LIVE ConfigMap payload to a COMMITTED ConfigMap-manifest file body.
 *
 * The oasPath the committed RestDefinition points at is ALSO rewritten to the git-relative
 * ConfigMap the PR ships (configmap://<ns>/<kind>-oas/openapi.yaml) so the merged manifest is
 * internally consistent — the same coordinates the ConfigMap manifest declares.
 *
 * Pure module: js-yaml + string helpers, no React/network/module-state. The caller (finalize)
 * enforces the MAX_APPLY_SET_OPS cap and the KOG preview gate before dispatch.
 */

import { dump } from 'js-yaml'

import type { ApplyResourceSetGvr, ApplyResourceSetOp } from './applyResourceSet'
import { encodeUtf8Base64 } from './blueprintDraftStore'
import { GITHUB_KOG_GROUP, GITHUB_KOG_VERSION } from './blueprintPublish'
import { KOG_MANAGED_BY_LABEL, parseOasPath } from './kogMapping'

/**
 * Repo coordinates for a KOG (RestDefinition) publish. The model supplies these simple scalars
 * from its prompt (which it does reliably); each falls back to the KOG-repo default if omitted,
 * so a publish is robust even when the model drops a field. These mirror BLUEPRINTS_REPO_DEFAULTS
 * (blueprintPublish.ts) and PORTAL_CHART_REPO_DEFAULTS (pagePublish.ts) — the single source of the
 * coordinates stays the prompt/model, not this file.
 */
export const KOG_REPO_DEFAULTS = {
  base: 'main',
  configurationRef: 'github-blueprints-config',
  namespace: 'krateo-system',
  // The API-Builder registry lives at krateo-platformops/oas (the old braghettos/krateo-oas was
  // transferred into the krateo-platformops org and renamed krateo-oas→oas). We keep repo `krateo-oas`
  // because GitHub 301-redirects krateo-platformops/krateo-oas→oas AND the portal deliverables RA
  // (restaction.kog-deliverables.yaml) discriminates KOG PRs on spec.repo == "krateo-oas". #105 flipped
  // the owner to krateo-blueprints, but that org has no krateo-oas repo (hard 404) — the owner must be
  // krateo-platformops.
  owner: 'krateo-platformops',
  repo: 'krateo-oas',
} as const

/** The `publishRestDef` verb payload — repo coords only; the RestDefinition + OAS come from the held draft. */
export interface KogPublishRequest {
  owner?: string
  repo?: string
  base?: string
  namespace?: string
  configurationRef?: string
  title?: string
  body?: string
  message?: string
}

/** DNS-1123-ish name segment from a file path (a RepoContent needs a unique metadata.name per file). */
const pathNameSlug = (path: string): string => path.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')

/** Serialize a CR/manifest object to YAML the exact way the page builder does (stable, no anchors). */
const toYaml = (value: unknown): string => dump(value, { lineWidth: -1, noRefs: true, sortKeys: false })

/**
 * The publish-plan inputs the host assembles from the HELD, PREVIEWED draft:
 *   - draft:       the validated RestDefinition CR object (the previewed draft).
 *   - kind:        the DNS-1123 slug the branch/paths derive from (draft's metadata.name).
 *   - oasDocument: the verbatim held OpenAPI document — PASTE case ONLY. Absent = URL case
 *                  (the draft's oasPath is an http(s) URL; no ConfigMap is committed).
 */
export interface KogPublishDraft {
  draft: Record<string, unknown>
  kind: string
  oasDocument?: string | null
}

/** The ConfigMap KEY the committed OAS ConfigMap manifest uses (matches the KOG prompt convention). */
export const KOG_OAS_CONFIGMAP_KEY = 'openapi.yaml'

/** The committed OAS ConfigMap's metadata.name for a kind: `<kind>-oas` (matches the direct-write path). */
export const kogOasConfigMapName = (kind: string): string => `${kind}-oas`

/** The git-relative oasPath the committed RestDefinition points at (paste case). */
export const kogOasConfigMapPath = (namespace: string, kind: string): string =>
  `configmap://${namespace}/${kogOasConfigMapName(kind)}/${KOG_OAS_CONFIGMAP_KEY}`

/**
 * Build the ConfigMap manifest (as a plain object) that carries the OAS document INLINE. The
 * document rides in verbatim — this is where the held bytes are embedded at publish-compile
 * time, so the model never reproduces them. The label matches the direct-write ConfigMap so a
 * committed ConfigMap is findable the same way (krateo.io/managed-by: kog-builder).
 */
export const buildOasConfigMapManifest = (namespace: string, kind: string, oasDocument: string): Record<string, unknown> => ({
  apiVersion: 'v1',
  data: { [KOG_OAS_CONFIGMAP_KEY]: oasDocument },
  kind: 'ConfigMap',
  metadata: { labels: { ...KOG_MANAGED_BY_LABEL }, name: kogOasConfigMapName(kind), namespace },
})

/**
 * Return the RestDefinition CR to COMMIT: for the paste case, rewrite spec.oasPath to the
 * git-relative ConfigMap the PR ships (so the merged manifest is internally consistent); for the
 * URL case, the draft's own http(s) oasPath is committed unchanged. Never mutates the input draft.
 */
const restDefinitionToCommit = (draft: KogPublishDraft, namespace: string): Record<string, unknown> => {
  const { oasDocument } = draft
  if (typeof oasDocument !== 'string') {
    return draft.draft
  }
  const priorSpec = draft.draft.spec
  const spec = priorSpec && typeof priorSpec === 'object' && !Array.isArray(priorSpec)
    ? (priorSpec as Record<string, unknown>)
    : {}
  return {
    ...draft.draft,
    spec: { ...spec, oasPath: kogOasConfigMapPath(namespace, draft.kind) },
  }
}

/**
 * Fan a `publishRestDef` request out into the ordered git-write op set for the HELD RestDefinition
 * draft (+ the held OAS document in the paste case):
 *   1. POST gitrefs      — create `refs/heads/builder/<kind>` (sha omitted; auto-resolved).
 *   2. POST repocontents — apis/<kind>/restdefinition.yaml (the RestDefinition CR), PLUS (paste
 *                          case) configmaps/<kind>-oas.yaml (the ConfigMap manifest holding the
 *                          OAS document inline). Each content is the base64 of the final YAML —
 *                          GitHub's create-file API requires base64 file bytes (same as FE-BP5).
 *   3. POST pullrequests — open the PR from the builder branch into `base`.
 * The branch/paths are DERIVED from the kind so the model never has to match them. Each op's
 * payload is a FULL CR object (apiVersion + kind + metadata.name + spec) — a bare `{spec}` is
 * rejected by the apiserver create ("Object 'Kind' is missing"). Object keys are alphabetized
 * (repo eslint sort-keys). The op count is 3 (URL) or 4 (paste) — well under MAX_APPLY_SET_OPS.
 *
 * NOTE ON AUTHORSHIP: unlike the $fileContent token path, the file bytes are produced HERE (the
 * host serializes the previewed draft deterministically), so ops carry their final content and
 * ride through compilePublishOps' authorship stamp (which stamps the CR ENVELOPES' metadata —
 * gitref/repocontent/pullrequest — exactly as the blueprint/page git-write ops do).
 */
/**
 * The controller (KOG) builder's committed file set for a held draft: the RestDefinition ALWAYS
 * (apis/<kind>/restdefinition.yaml), plus the OAS ConfigMap (configmaps/<kind>-oas.yaml) in the
 * paste case. `namespace` is the RUNTIME namespace stamped into the manifests (metadata.namespace /
 * the configmap:// oasPath), not the git target. Shared by the github-PR op path AND the
 * SCM-agnostic BuilderPublish claim path so both commit identical bytes.
 */
export const kogPublishFiles = (held: KogPublishDraft, namespace: string): { content: string; path: string }[] => {
  const { kind, oasDocument } = held
  const files: { content: string; path: string }[] = [
    { content: toYaml(restDefinitionToCommit(held, namespace)), path: `apis/${kind}/restdefinition.yaml` },
  ]
  if (typeof oasDocument === 'string') {
    files.push({ content: toYaml(buildOasConfigMapManifest(namespace, kind, oasDocument)), path: `configmaps/${kogOasConfigMapName(kind)}.yaml` })
  }
  return files
}

export const buildKogPublishAsPrOps = (
  req: KogPublishRequest,
  held: KogPublishDraft,
): ApplyResourceSetOp[] => {
  const owner = req.owner ?? KOG_REPO_DEFAULTS.owner
  const repo = req.repo ?? KOG_REPO_DEFAULTS.repo
  const base = req.base ?? KOG_REPO_DEFAULTS.base
  const namespace = req.namespace ?? KOG_REPO_DEFAULTS.namespace
  const configurationRef = { name: req.configurationRef ?? KOG_REPO_DEFAULTS.configurationRef }
  const { kind } = held
  const branch = `builder/${kind}`
  const apiVersion = `${GITHUB_KOG_GROUP}/${GITHUB_KOG_VERSION}`
  const gvr = (resource: string): ApplyResourceSetGvr => ({ group: GITHUB_KOG_GROUP, resource, version: GITHUB_KOG_VERSION })

  const cr = (crKind: string, name: string, spec: Record<string, unknown>): Record<string, unknown> => ({
    apiVersion,
    kind: crKind,
    metadata: { name, namespace },
    spec,
  })

  // The file set (RestDefinition ALWAYS; OAS ConfigMap only in the paste case) — shared with the
  // SCM-agnostic claim path so both commit identical bytes.
  const files = kogPublishFiles(held, namespace)

  const ops: ApplyResourceSetOp[] = [
    {
      gvr: gvr('gitrefs'),
      namespace,
      payload: cr('GitRef', kind, { configurationRef, owner, ref: `refs/heads/${branch}`, repo }),
      verb: 'POST',
    },
  ]

  for (const file of files) {
    ops.push({
      gvr: gvr('repocontents'),
      namespace,
      payload: cr('RepoContent', `${kind}-${pathNameSlug(file.path)}`, {
        branch,
        configurationRef,
        content: encodeUtf8Base64(file.content),
        message: req.message ?? `feat(${kind}): add ${file.path}`,
        owner,
        path: file.path,
        repo,
      }),
      verb: 'POST',
    })
  }

  ops.push({
    gvr: gvr('pullrequests'),
    namespace,
    payload: cr('PullRequest', kind, {
      base,
      body: req.body ?? `Adds the ${kind} RestDefinition (KOG API mapping), authored end-to-end via the KOG Builder.`,
      configurationRef,
      head: branch,
      owner,
      repo,
      title: req.title ?? `feat(${kind}): add ${kind} RestDefinition`,
    }),
    verb: 'POST',
  })

  return ops
}

/**
 * Resolve the held RestDefinition draft into a KogPublishDraft (the publish-plan input), or null
 * when nothing publishable is held. `draft` is the LAST previewed RestDefinition (previewGate);
 * `oasDocument` is the held OAS attachment text (paste case) or null (URL case). The kind slug is
 * the draft's metadata.name (a DNS-1123 name, already validated by the KOG preview gate).
 *
 * The URL-vs-paste discriminator is the DRAFT's oasPath, NOT merely whether a document is held:
 *   - a URL oasPath → URL case (no ConfigMap committed, even if a stray attachment lingers);
 *   - a configmap:// oasPath → paste case (the ConfigMap is committed, so a held document is
 *     REQUIRED — without it there is nothing to embed; null signals the caller to refuse).
 */
export interface KogPublishResolution {
  held: KogPublishDraft | null
  /** The paste case needs a held document; true when the draft is paste-case but none is held. */
  missingOasDocument: boolean
}

export const resolveKogPublishDraft = (
  draft: unknown,
  oasDocument: string | null,
): KogPublishResolution => {
  const record = draft && typeof draft === 'object' && !Array.isArray(draft) ? (draft as Record<string, unknown>) : null
  const metadata = record?.metadata && typeof record.metadata === 'object' ? (record.metadata as Record<string, unknown>) : null
  const kind = typeof metadata?.name === 'string' ? metadata.name.trim() : ''
  const spec = record?.spec && typeof record.spec === 'object' ? (record.spec as Record<string, unknown>) : null
  const oasPath = parseOasPath(spec?.oasPath)
  if (!record || !kind || !oasPath) {
    return { held: null, missingOasDocument: false }
  }
  if (oasPath.form === 'url') {
    return { held: { draft: record, kind }, missingOasDocument: false }
  }
  // Paste case: the ConfigMap manifest must carry the verbatim held document.
  if (!oasDocument) {
    return { held: null, missingOasDocument: true }
  }
  return { held: { draft: record, kind, oasDocument }, missingOasDocument: false }
}
