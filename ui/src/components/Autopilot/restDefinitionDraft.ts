/**
 * UI-NATIVE KOG BUILDER (item C) — the PURE RestDefinition-draft constructor for the
 * plain-form authoring path.
 *
 * WHY THIS EXISTS: the KOG (Controller/API) builder could previously author a RestDefinition
 * ONLY through Autopilot — the model emitted `previewRestDef` (arming the preview gate) and
 * `publishRestDef` (fanned into the git-write PR set). Vincenzo's item C asks for a UI-native
 * path: a plain form a user fills to author + publish a RestDefinition WITHOUT Autopilot, reusing
 * the EXACT same publish machinery and the SAME blast-radius confirm.
 *
 * This module is the ONLY net-new logic that path needs: a thin, deterministic assembler that
 * turns the form's structured fields into a RestDefinition CR object shaped EXACTLY like the one
 * `previewRestDef`/`resolveKogPublishDraft` consume — and then it DELEGATES correctness to the
 * SAME `validateRestDefinitionDraft` the Autopilot preview drawer uses. It does NOT reimplement
 * the OAS→RestDefinition mapping, the URL-vs-paste discriminator, the git-write op construction,
 * or the publish dispatch — those are reused verbatim from kogMapping.ts / kogPublish.ts /
 * applyResourceSet.ts. Pure module: no React, no network, no module state.
 */

import {
  REST_DEFINITION_API_VERSION,
  REST_DEFINITION_KIND,
  REST_DEF_ACTIONS,
  REST_DEF_METHODS,
  validateRestDefinitionDraft,
} from './kogMapping'

/** One verbsDescription row the form collects — mirrors the live CRD's {action, method, path}. */
export interface RestDefinitionVerbInput {
  action: string
  method: string
  path: string
}

/** The structured inputs the UI-native form collects (the human authors these directly). */
export interface RestDefinitionDraftInput {
  /** metadata.name — the DNS-1123 kind slug the branch/paths derive from. */
  name: string
  /** metadata.namespace — RestDefinition is namespaced; defaults to krateo-system in the form. */
  namespace: string
  /** spec.resourceGroup — the API group of the generated kind (a DNS subdomain). */
  resourceGroup: string
  /** spec.resource.kind — the CamelCase kind to generate. */
  resourceKind: string
  /**
   * spec.oasPath — an http(s):// URL, OR a configmap://<ns>/<name>/<key> path (the paste case).
   * The form's URL-vs-paste discriminator writes this exactly as the Autopilot flow would, so
   * `resolveKogPublishDraft` classifies it identically.
   */
  oasPath: string
  /** spec.resource.verbsDescription — at least one {action, method, path} entry. */
  verbs: RestDefinitionVerbInput[]
  /** spec.resource.identifiers — optional; the fields that identify a managed object. */
  identifiers?: string[]
}

/** The re-exported live-CRD enums, so the form renders its Selects from the SAME source. */
export const REST_DEFINITION_ACTIONS = REST_DEF_ACTIONS
export const REST_DEFINITION_METHODS = REST_DEF_METHODS

/** A blank verb row for the form's dynamic list (get/GET is the safest, most common default). */
export const emptyVerbInput = (): RestDefinitionVerbInput => ({ action: 'get', method: 'GET', path: '' })

/** A blank form draft — one verb row, krateo-system namespace (the RestDefinition default). */
export const emptyRestDefinitionInput = (): RestDefinitionDraftInput => ({
  identifiers: [],
  name: '',
  namespace: 'krateo-system',
  oasPath: '',
  resourceGroup: '',
  resourceKind: '',
  verbs: [emptyVerbInput()],
})

/** Trim a verb row and DROP empty rows (an all-blank trailing row is not an error, just ignored). */
const cleanVerbs = (verbs: RestDefinitionVerbInput[]): RestDefinitionVerbInput[] =>
  verbs
    .map((verb) => ({ action: verb.action?.trim() ?? '', method: verb.method?.trim() ?? '', path: verb.path?.trim() ?? '' }))
    .filter((verb) => verb.action || verb.method || verb.path)

/** Trim + drop empty identifiers (an optional list — absent when nothing meaningful was entered). */
const cleanIdentifiers = (identifiers: string[] | undefined): string[] =>
  (identifiers ?? []).map((entry) => entry?.trim() ?? '').filter((entry) => entry.length > 0)

/**
 * Assemble the RestDefinition CR object from the form inputs — the SAME shape
 * `previewRestDef`/`resolveKogPublishDraft`/`buildKogPublishAsPrOps` consume. Deterministic,
 * never throws: it produces the object as authored (an INVALID object too — validation is a
 * separate, explicit step so the form can surface field errors before publish).
 */
export const buildRestDefinitionDraft = (input: RestDefinitionDraftInput): Record<string, unknown> => {
  const identifiers = cleanIdentifiers(input.identifiers)
  const resource: Record<string, unknown> = {
    kind: input.resourceKind.trim(),
    verbsDescription: cleanVerbs(input.verbs).map((verb) => ({ action: verb.action, method: verb.method, path: verb.path })),
  }
  if (identifiers.length > 0) {
    resource.identifiers = identifiers
  }
  return {
    apiVersion: REST_DEFINITION_API_VERSION,
    kind: REST_DEFINITION_KIND,
    metadata: { name: input.name.trim(), namespace: input.namespace.trim() },
    spec: {
      oasPath: input.oasPath.trim(),
      resource,
      resourceGroup: input.resourceGroup.trim(),
    },
  }
}

/** A built + validated draft, or the validation error lines (empty draft = not publishable). */
export interface RestDefinitionBuildResult {
  draft: Record<string, unknown>
  errors: string[]
}

/**
 * Build the draft AND validate it via the SAME `validateRestDefinitionDraft` the Autopilot
 * preview drawer uses — the single correctness authority. The form calls this on submit: an
 * empty `errors` means the draft matches the live CRD shape and is safe to hand to the publish
 * machinery; a non-empty `errors` is surfaced inline and nothing is dispatched.
 */
export const buildAndValidateRestDefinition = (input: RestDefinitionDraftInput): RestDefinitionBuildResult => {
  const draft = buildRestDefinitionDraft(input)
  return { draft, errors: validateRestDefinitionDraft(draft) }
}
