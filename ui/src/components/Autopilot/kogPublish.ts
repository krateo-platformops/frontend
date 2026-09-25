/**
 * The controller (KOG) builder's publish file set.
 *
 * A `publishRestDef` commits the held, previewed RestDefinition as its own chart — Chart.yaml,
 * values, schema, the RestDefinition template and (paste case) the OAS ConfigMap — through the
 * SAME BuilderPublish claim every builder uses (see kogPublishDispatch / builderClaimPublish).
 * It once had a second route: a host-built github.krateo.io GitRef / RepoContent / PullRequest op
 * set. That legacy GitHub path was removed 2026-09-25; the claim is the only way a builder publishes.
 *
 * THE OAS "HELD-IN-PORTAL" GUARANTEE. The pasted OpenAPI document is held client-side in the
 * provider's OAS store and is NEVER reproduced by the model — its publish proposal carries only
 * the scalar verb. At publish time the host embeds the held verbatim bytes into the committed
 * ConfigMap manifest, and rewrites the RestDefinition's oasPath to that ConfigMap, so the merged
 * chart is internally consistent and published bytes == the bytes the user pasted.
 *
 * Pure module: js-yaml + string helpers, no React/network/module-state.
 */

import { dump } from 'js-yaml'

import {
  KOG_RELEASE_NAMESPACE,
  KOG_TEMPLATES_DIR,
  kogChartYaml,
  kogValuesSchema,
  kogValuesYaml,
} from './kogChart'
import { KOG_MANAGED_BY_LABEL, parseOasPath } from './kogMapping'

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
 * The controller (KOG) builder's committed file set for a held draft: the RestDefinition ALWAYS
 * (apis/<kind>/restdefinition.yaml), plus the OAS ConfigMap (configmaps/<kind>-oas.yaml) in the
 * paste case. The runtime namespace is TEMPLATED (.Release.Namespace), not passed in: a chart that
 * bakes the authoring namespace pins every installation of the controller to wherever the author
 * happened to be working.
 */
export const kogPublishFiles = (held: KogPublishDraft): { content: string; path: string }[] => {
  const { kind, oasDocument } = held
  // A CONTROLLER IS ITS OWN CHART, in its own repository named for the kind — the same shape
  // portal-builder and blueprint-builder already emit. It used to commit apis/<kind>/... into one
  // shared registry repo whose root was a chart CDC rendered as a single composition; see
  // kogChart.ts for why that was retired rather than repointed.
  //
  // `namespace` is IGNORED for the committed manifests on purpose. It is the authoring namespace,
  // and baking it into a chart pins every installation of this controller to wherever the author
  // happened to be working. The templates resolve .Release.Namespace instead, and the oasPath
  // resolves with them so the merged manifest stays internally consistent.
  const files: { content: string; path: string }[] = [
    { content: kogChartYaml(kind), path: 'Chart.yaml' },
    { content: kogValuesYaml(), path: 'values.yaml' },
    { content: kogValuesSchema(kind), path: 'values.schema.json' },
    { content: toYaml(restDefinitionToCommit(held, KOG_RELEASE_NAMESPACE)), path: `${KOG_TEMPLATES_DIR}/restdefinition.yaml` },
  ]
  if (typeof oasDocument === 'string') {
    files.push({
      content: toYaml(buildOasConfigMapManifest(KOG_RELEASE_NAMESPACE, kind, oasDocument)),
      path: `${KOG_TEMPLATES_DIR}/configmap-oas.yaml`,
    })
  }
  return files
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
