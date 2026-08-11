/**
 * W4 BLUEPRINT-BUILDER (FE-B1 + FE-B2) — the PURE draft-chart module behind
 * previewBlueprint's INLINE-DRAFT mode. No React, no network:
 *
 *   1. parseRawTemplates (FE-B1) — the arg guard for the inline chart tree
 *      (`{"Chart.yaml": "...", "templates/x.yaml": "...", ...}`): a non-empty map of
 *      non-empty path → string content, or null — the proposal is DENIED, never a crash.
 *   2. lintBlueprintDraft (FE-B2) — the crdgen-defaults lint, run BEFORE any render
 *      fetch. A values.schema.json carrying a NON-EMPTY object/array `default` (at ANY
 *      depth) is the krateo-platformops/core-provider#46 class: at CD-create time crdgen
 *      emits a malformed `+kubebuilder:default=` marker, controller-gen fails to parse
 *      it, and the CompositionDefinition wedges Ready=False. HARD ERROR — the drawer
 *      shows the verdicts and NOTHING is fetched or published. The 512 KiB total-bytes
 *      cap (the same discipline as the $oasAttachment paste) is enforced here too.
 *   3. buildFormSchemaText / buildFormPreviewModel (FE-B1) — the create-form preview
 *      half: the RAW values.schema.json string (verbatim from the draft file, so the
 *      authoring order survives — the same trick as Form.tsx's stringSchema), parsed
 *      client-side and spliced the way production blueprint-formdef splices the real
 *      one (synthetic `name` + `namespace` first, `(should be hidden)` titles hidden)
 *      for the drawer's read-only SchemaForm mount.
 */
import type { JSONSchema4 } from 'json-schema'

import { OAS_ATTACHMENT_MAX_BYTES, utf8ByteLength } from './oasAttachment'

/** The draft file the lint and the form preview read. */
export const VALUES_SCHEMA_PATH = 'values.schema.json'

/** Hard cap on the inline draft: 512 KiB of UTF-8 bytes (paths + contents) — the same
 * discipline as the OAS attachment, and well inside the render service's 2 MiB body cap. */
export const RAW_TEMPLATES_MAX_BYTES = OAS_ATTACHMENT_MAX_BYTES

/** Drawer caption when the draft is refused client-side (lint error or size cap). */
export const DRAFT_REJECTED_CAPTION
  = 'draft rejected client-side — nothing was rendered and nothing can be published; fix the verdicts and preview again.'

const asRecord = (value: unknown): Record<string, unknown> | null =>
  (value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null)

/**
 * Strip a code-fence / triple-quote wrapper the model may put around a WHOLE file body.
 * gemini (and most LLMs) intermittently wrap a generated file in a markdown fence
 * (```json … ```) or a python-style triple-quote ('''…''' / """…"""). Those bytes would be
 * published verbatim into the chart AND break JSON.parse of values.schema.json (observed:
 * `'''{ "title": … }'''` → the preview-gate refuses to publish). We already strip fences
 * from CHAT text (transport.sanitizeChatText); drafted FILE bodies need the same. Only a
 * SYMMETRIC wrapper around the entire trimmed body is removed (an optional opening language
 * tag line too); genuine content — a values.yaml starting `replicaCount: 1`, a schema
 * starting `{` — is never touched.
 */
export const stripCodeFence = (raw: string): string => {
  const trimmed = raw.trim()
  for (const marker of ['```', "'''", '"""'] as const) {
    if (trimmed.length > marker.length * 2 && trimmed.startsWith(marker) && trimmed.endsWith(marker)) {
      const inner = trimmed.slice(marker.length, trimmed.length - marker.length)
      // drop an optional leading language tag line, e.g. ```json\n or '''yaml\n
      return inner.replace(/^[a-zA-Z0-9_-]*\r?\n/, '').trim()
    }
  }
  return raw
}

/**
 * The inline chart tree of a previewBlueprint proposal: a plain object mapping
 * non-empty relative paths to string contents. Anything else — empty map, non-object,
 * a non-string file body — is null (the proposal is denied, matching every arg guard).
 * Each file body is de-fenced (see stripCodeFence) so an accidental model wrapper never
 * corrupts the published chart or the schema lint.
 */
export const parseRawTemplates = (value: unknown): Record<string, string> | null => {
  const record = asRecord(value)
  if (!record) {
    return null
  }
  const entries = Object.entries(record)
  if (entries.length === 0) {
    return null
  }
  const cleaned: Record<string, string> = {}
  for (const [path, content] of entries) {
    if (!path.trim() || typeof content !== 'string') {
      return null
    }
    cleaned[path] = stripCodeFence(content)
  }
  return cleaned
}

/** Total UTF-8 bytes of the draft (paths + contents) — what the 512 KiB cap measures. */
export const rawTemplatesByteSize = (rawTemplates: Record<string, string>): number =>
  Object.entries(rawTemplates).reduce((total, [path, content]) => total + utf8ByteLength(path) + utf8ByteLength(content), 0)

/** A non-empty object or non-empty array — the exact #46 default class. `{}`/`[]`
 * defaults are structurally harmless (nothing for the marker to serialize) and pass. */
const isNonEmptyStructure = (value: unknown): boolean => {
  if (Array.isArray(value)) {
    return value.length > 0
  }
  return value !== null && typeof value === 'object' && Object.keys(value as Record<string, unknown>).length > 0
}

/** Keys whose CHILD KEYS are property NAMES, not schema keywords — a property literally
 * named `default` under these maps must not be mistaken for a defaults keyword. */
const NAME_MAP_KEYWORDS = new Set(['$defs', 'definitions', 'patternProperties', 'properties'])

/** Value-carrying keywords whose contents are DATA, not schema — never walked into
 * (`default` is checked, then skipped: keys inside a default value are not keywords). */
const VALUE_KEYWORDS = new Set(['const', 'default', 'enum', 'examples'])

const crdgenDefaultsProblem = (path: string, value: unknown): string => {
  const shape = Array.isArray(value) ? 'array' : 'object'
  return `[CRDGEN-DEFAULTS] ${path}: non-empty ${shape} default — crdgen emits a malformed +kubebuilder:default marker and the CompositionDefinition wedges Ready=False (krateo-platformops/core-provider#46). Move the structure into values.yaml; keep schema defaults scalar.`
}

/** Schema-aware walk: flags every non-empty object/array `default` at any depth. */
const walkSchemaNode = (node: unknown, path: string, problems: string[]): void => {
  if (Array.isArray(node)) {
    node.forEach((entry, index) => {
      walkSchemaNode(entry, `${path}[${index}]`, problems)
    })
    return
  }
  const record = asRecord(node)
  if (!record) {
    return
  }
  for (const [key, value] of Object.entries(record)) {
    const at = path ? `${path}.${key}` : key
    if (VALUE_KEYWORDS.has(key)) {
      if (key === 'default' && isNonEmptyStructure(value)) {
        problems.push(crdgenDefaultsProblem(at, value))
      }
      continue
    }
    if (NAME_MAP_KEYWORDS.has(key)) {
      const nameMap = asRecord(value)
      if (nameMap) {
        for (const [name, child] of Object.entries(nameMap)) {
          walkSchemaNode(child, `${at}.${name}`, problems)
        }
        continue
      }
    }
    walkSchemaNode(value, at, problems)
  }
}

/**
 * FE-B2 core: lint a raw values.schema.json string for the crdgen-defaults class.
 * Returns error lines for the preview drawer — EMPTY means the schema carries no
 * non-empty object/array default anywhere. Invalid JSON is itself a hard error (the
 * schema drives BOTH the composition CRD and the create form — it must parse).
 */
export const lintValuesSchemaDefaults = (schemaText: string): string[] => {
  let parsed: unknown
  try {
    parsed = JSON.parse(schemaText)
  } catch (error) {
    return [`${VALUES_SCHEMA_PATH} is not valid JSON — ${error instanceof Error ? error.message : String(error)}`]
  }
  const problems: string[] = []
  walkSchemaNode(parsed, '', problems)
  return problems
}

/**
 * The pre-render gate for an inline draft: the 512 KiB size cap first (an over-cap
 * draft is refused whole — same posture as an over-cap OAS paste), then the FE-B2
 * crdgen-defaults lint of values.schema.json when the draft ships one. Empty = the
 * draft may be POSTed to the render service.
 */
export const lintBlueprintDraft = (rawTemplates: Record<string, string>): string[] => {
  const bytes = rawTemplatesByteSize(rawTemplates)
  if (bytes > RAW_TEMPLATES_MAX_BYTES) {
    const kib = Math.ceil(bytes / 1024)
    return [`the inline draft is ${kib} KiB — over the 512 KiB cap (same discipline as the OAS attachment). Trim the draft, or publish the chart and preview it by chart URL instead.`]
  }
  const schemaText = rawTemplates[VALUES_SCHEMA_PATH]
  return schemaText === undefined ? [] : lintValuesSchemaDefaults(schemaText)
}

/** The draft chart's display name, from Chart.yaml's `name:` (fallback: 'draft chart'). */
export const draftDisplayName = (rawTemplates: Record<string, string>): string => {
  const chartYaml = rawTemplates['Chart.yaml']
  const match = chartYaml ? /^name:\s*["']?([A-Za-z0-9][A-Za-z0-9._-]*)["']?\s*$/m.exec(chartYaml) : null
  return match ? match[1] : 'draft chart'
}

/**
 * The RAW schema string the drawer's create-form preview renders, or undefined (no
 * section). Prefers the VERBATIM draft file (authoring order survives untouched);
 * falls back to re-serializing the render response's valuesSchema (remote-chart mode,
 * where no draft file exists). A failed render has no trustworthy schema — no form.
 */
export const buildFormSchemaText = (
  rawTemplates: Record<string, string> | undefined,
  valuesSchema: unknown,
  renderError: string | undefined,
): string | undefined => {
  if (renderError) {
    return undefined
  }
  const draftText = rawTemplates?.[VALUES_SCHEMA_PATH]
  if (typeof draftText === 'string' && draftText.trim()) {
    return draftText
  }
  if (asRecord(valuesSchema)) {
    return JSON.stringify(valuesSchema)
  }
  return undefined
}

/** What the read-only SchemaForm mounts: the spliced schema + the keys hidden from it. */
export interface FormPreviewModel {
  schema: JSONSchema4
  hidden: string[]
}

/** Every property key (any depth) whose title carries the formdef hide convention. */
const collectHiddenKeys = (properties: Record<string, unknown>, hidden: Set<string>): void => {
  for (const [key, node] of Object.entries(properties)) {
    const record = asRecord(node)
    if (!record) {
      continue
    }
    if (typeof record.title === 'string' && /should be hidden/i.test(record.title)) {
      hidden.add(key)
    }
    const nested = asRecord(record.properties)
    if (nested) {
      collectHiddenKeys(nested, hidden)
    }
  }
}

/**
 * Parse the raw schema string and splice it the way production blueprint-formdef
 * splices the published one: synthetic `name` + `namespace` as the FIRST properties
 * (both required — the create Form routes them to metadata via payloadToOverride),
 * and `(should be hidden)`-titled keys collected into the hide list. Null = the
 * string does not parse to an object schema with properties — no form section.
 */
export const buildFormPreviewModel = (formSchema: string): FormPreviewModel | null => {
  let parsed: unknown
  try {
    parsed = JSON.parse(formSchema)
  } catch {
    return null
  }
  const record = asRecord(parsed)
  const properties = asRecord(record?.properties)
  if (!record || !properties || Object.keys(properties).length === 0) {
    return null
  }
  const required = Array.isArray(record.required) ? record.required.filter((key): key is string => typeof key === 'string') : []
  const hidden = new Set<string>()
  collectHiddenKeys(properties, hidden)
  const schema = {
    ...record,
    properties: {
      name: { title: 'Name', type: 'string' },
      namespace: { title: 'Namespace', type: 'string' },
      ...properties,
    },
    required: ['name', 'namespace', ...required.filter((key) => key !== 'name' && key !== 'namespace')],
    type: 'object',
  } as JSONSchema4
  return { hidden: [...hidden], schema }
}
