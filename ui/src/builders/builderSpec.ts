/**
 * The Builder spec — the TypeScript mirror of helm/frontend-crds/templates/builders/Builder.yaml.
 *
 * WHY A SECOND COPY OF THE SCHEMA. The apiserver validates a Builder when it is applied, but the
 * frontend reads one over snowplow `/call` as the person, and what arrives is data from the cluster:
 * an older CRD, a hand-edited object, a Builder from a newer frontend with a field this build does not
 * know. The engine must turn that into either a typed Builder or a list of sentences, never a crash
 * halfway through mounting a composer. builderSpec.test.ts holds the two in step (the same keys, the
 * same required keys), so a field added to one and not the other fails CI rather than a page.
 *
 * STRICTER THAN THE APISERVER IN ONE WAY. The apiserver PRUNES an unknown field; this parser REPORTS
 * one. Nothing the apiserver returns can carry one, so the difference only shows on a fixture or a
 * hand-written object, where a misspelled key silently doing nothing is exactly the mistake to name.
 *
 * FAILURE IS CONTENT, NEVER A THROW. `parseBuilder` answers `{ ok: false, problems }` for anything it
 * cannot accept, with one sentence per problem, each naming the field by its path.
 */

export const BUILDER_API_VERSION = 'builders.templates.krateo.io/v1alpha1'
export const BUILDER_KIND = 'Builder'

/** A RESTAction (or widget) by name; an absent namespace is the frontend's own. */
export interface NamespacedRef {
  name: string
  namespace?: string
}

export interface PluginRef {
  plugin: string
}

export interface StartField {
  name: string
  label: string
  required: boolean
  pattern?: string
  help?: string
  placeholder?: string
  initialValue?: string
}

export type PreviewMode = 'sandbox-apply' | 'render'
export type PublishBuilder = 'page' | 'blueprint' | 'controller'

export interface BuilderSpec {
  route: string
  label: string
  draftKind: string
  start: { fields: StartField[]; maxDraftBytes: number }
  palette: { plugin: string; restActionRef?: NamespacedRef }
  canvas: PluginRef
  inspector: PluginRef
  parser?: PluginRef
  summarizer?: PluginRef
  preview: { mode: PreviewMode; restActionRef?: NamespacedRef }
  files: { required: string[]; locked: string[]; heldBytes?: number }
  lint: string[]
  gates: string[]
  publish: {
    builder: PublishBuilder
    targetKey: string
    templateKey: string
    registration: { kind: 'CompositionDefinition'; path: string }
  }
  verbs: { allowed: string[] }
  portal: { draftsCard: NamespacedRef; deliverablesRestActionRef?: NamespacedRef }
}

export interface Builder {
  apiVersion: typeof BUILDER_API_VERSION
  kind: typeof BUILDER_KIND
  metadata: { name: string; namespace?: string }
  spec: BuilderSpec
}

export type BuilderParseResult =
  | { ok: true; builder: Builder }
  | { ok: false; problems: string[] }

/** The spec's keys, and which are required — exported so the test can hold them to the CRD's. */
export const BUILDER_SPEC_KEYS = [
  'canvas', 'draftKind', 'files', 'gates', 'inspector', 'label', 'lint', 'palette', 'parser', 'portal',
  'preview', 'publish', 'route', 'start', 'summarizer', 'verbs',
] as const
export const BUILDER_SPEC_REQUIRED = [
  'canvas', 'draftKind', 'files', 'gates', 'inspector', 'label', 'lint', 'palette', 'portal', 'preview',
  'publish', 'route', 'start', 'verbs',
] as const

/** The CRD's patterns, verbatim. */
const PLUGIN_NAME = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/
const ROUTE = /^(\/[a-z0-9]+(-[a-z0-9]+)*)+$/
const CONFIG_KEY = /^[A-Z][A-Z0-9_]*$/
const VERB = /^[a-z][a-zA-Z]*$/
const FIELD_NAME = /^[a-z][a-zA-Z0-9]*$/
/** A ConfigMap's size, the most any draft can be held in. */
const MAX_BYTES = 1048576

type Obj = Record<string, unknown>

const isObject = (value: unknown): value is Obj => typeof value === 'object' && value !== null && !Array.isArray(value)

/**
 * One pass over one object: every read records a problem instead of returning undefined silently,
 * and `done` reports the keys nobody read — the fields the schema does not have.
 */
const reader = (value: Obj, path: string, problems: string[]) => {
  const seen = new Set<string>()
  const at = (key: string) => `${path}.${key}`
  const missing = (key: string) => problems.push(`${at(key)} is required`)

  const string = (key: string, rule: { max?: number; min?: number; pattern?: RegExp; required?: boolean } = {}): string | undefined => {
    seen.add(key)
    const raw = value[key]
    if (raw === undefined) {
      if (rule.required) { missing(key) }
      return undefined
    }
    if (typeof raw !== 'string') {
      problems.push(`${at(key)} must be a string`)
      return undefined
    }
    if (rule.min !== undefined && raw.length < rule.min) {
      problems.push(`${at(key)} must not be empty`)
      return undefined
    }
    if (rule.max !== undefined && raw.length > rule.max) {
      problems.push(`${at(key)} is longer than ${rule.max} characters`)
      return undefined
    }
    if (rule.pattern && !rule.pattern.test(raw)) {
      problems.push(`${at(key)} "${raw}" does not match ${String(rule.pattern)}`)
      return undefined
    }
    return raw
  }

  const oneOf = <T extends string>(key: string, allowed: readonly T[], required = true): T | undefined => {
    const raw = string(key, { required })
    if (raw === undefined) { return undefined }
    if (!(allowed as readonly string[]).includes(raw)) {
      problems.push(`${at(key)} "${raw}" is not one of ${allowed.join(', ')}`)
      return undefined
    }
    return raw as T
  }

  const bytes = (key: string, required: boolean): number | undefined => {
    seen.add(key)
    const raw = value[key]
    if (raw === undefined) {
      if (required) { missing(key) }
      return undefined
    }
    if (typeof raw !== 'number' || !Number.isInteger(raw) || raw < 1 || raw > MAX_BYTES) {
      problems.push(`${at(key)} must be a whole number of bytes from 1 to ${MAX_BYTES}`)
      return undefined
    }
    return raw
  }

  const boolean = (key: string): boolean | undefined => {
    seen.add(key)
    const raw = value[key]
    if (raw === undefined) {
      missing(key)
      return undefined
    }
    if (typeof raw !== 'boolean') {
      problems.push(`${at(key)} must be true or false`)
      return undefined
    }
    return raw
  }

  /** A list-type `set`: strings, each matching, none repeated. */
  const set = (key: string, rule: { max: number; pattern?: RegExp }): string[] | undefined => {
    seen.add(key)
    const raw = value[key]
    if (raw === undefined) {
      missing(key)
      return undefined
    }
    if (!Array.isArray(raw)) {
      problems.push(`${at(key)} must be a list`)
      return undefined
    }
    const out: string[] = []
    raw.forEach((item, index) => {
      if (typeof item !== 'string' || item.length === 0 || item.length > rule.max) {
        problems.push(`${at(key)}[${index}] must be a non-empty string of at most ${rule.max} characters`)
      } else if (rule.pattern && !rule.pattern.test(item)) {
        problems.push(`${at(key)}[${index}] "${item}" does not match ${String(rule.pattern)}`)
      } else if (out.includes(item)) {
        problems.push(`${at(key)} lists "${item}" twice`)
      } else {
        out.push(item)
      }
    })
    return out
  }

  const object = (key: string, required: boolean): Obj | undefined => {
    seen.add(key)
    const raw = value[key]
    if (raw === undefined) {
      if (required) { missing(key) }
      return undefined
    }
    if (!isObject(raw)) {
      problems.push(`${at(key)} must be an object`)
      return undefined
    }
    return raw
  }

  /** The raw value, marked read — for a shape the helpers above do not cover (a list of objects). */
  const take = (key: string): unknown => {
    seen.add(key)
    return value[key]
  }

  const done = () => {
    for (const key of Object.keys(value)) {
      if (!seen.has(key)) { problems.push(`${at(key)} is not a Builder field`) }
    }
  }

  return { at, boolean, bytes, done, object, oneOf, set, string, take }
}

const namespacedRef = (value: Obj, path: string, problems: string[]): NamespacedRef | undefined => {
  const read = reader(value, path, problems)
  const name = read.string('name', { max: 253, min: 1, required: true })
  const namespace = read.string('namespace', { max: 63, min: 1 })
  read.done()
  return name === undefined ? undefined : { name, ...(namespace !== undefined ? { namespace } : {}) }
}

const optionalRef = (read: ReturnType<typeof reader>, key: string, problems: string[]): NamespacedRef | undefined | null => {
  const raw = read.object(key, false)
  if (raw === undefined) { return undefined }
  return namespacedRef(raw, read.at(key), problems) ?? null
}

const pluginRef = (read: ReturnType<typeof reader>, key: string, required: boolean, problems: string[]): PluginRef | undefined => {
  const raw = read.object(key, required)
  if (!raw) { return undefined }
  const inner = reader(raw, read.at(key), problems)
  const plugin = inner.string('plugin', { max: 63, pattern: PLUGIN_NAME, required: true })
  inner.done()
  return plugin === undefined ? undefined : { plugin }
}

const startField = (value: unknown, path: string, problems: string[]): StartField | undefined => {
  if (!isObject(value)) {
    problems.push(`${path} must be an object`)
    return undefined
  }
  const read = reader(value, path, problems)
  const name = read.string('name', { max: 63, pattern: FIELD_NAME, required: true })
  const label = read.string('label', { max: 63, min: 1, required: true })
  const required = read.boolean('required')
  const pattern = read.string('pattern', { max: 253, min: 1 })
  const help = read.string('help', { max: 253 })
  const placeholder = read.string('placeholder', { max: 253 })
  const initialValue = read.string('initialValue', { max: 253 })
  read.done()
  if (pattern !== undefined) {
    try {
      RegExp(pattern)
    } catch {
      problems.push(`${path}.pattern is not a valid regular expression`)
      return undefined
    }
  }
  if (name === undefined || label === undefined || required === undefined) { return undefined }
  return {
    label,
    name,
    required,
    ...(pattern !== undefined ? { pattern } : {}),
    ...(help !== undefined ? { help } : {}),
    ...(placeholder !== undefined ? { placeholder } : {}),
    ...(initialValue !== undefined ? { initialValue } : {}),
  }
}

const parseSpec = (spec: Obj, problems: string[]): BuilderSpec | null => {
  const read = reader(spec, 'spec', problems)
  const before = problems.length

  const route = read.string('route', { max: 253, pattern: ROUTE, required: true })
  const label = read.string('label', { max: 63, min: 1, required: true })
  const draftKind = read.string('draftKind', { max: 20, pattern: PLUGIN_NAME, required: true })

  let start: BuilderSpec['start'] | undefined
  const startRaw = read.object('start', true)
  if (startRaw) {
    const inner = reader(startRaw, 'spec.start', problems)
    const fieldsRaw = inner.take('fields')
    const maxDraftBytes = inner.bytes('maxDraftBytes', true)
    inner.done()
    let fields: StartField[] | undefined
    if (fieldsRaw === undefined) {
      problems.push('spec.start.fields is required')
    } else if (!Array.isArray(fieldsRaw) || fieldsRaw.length < 1 || fieldsRaw.length > 16) {
      problems.push('spec.start.fields must be a list of 1 to 16 fields')
    } else {
      const parsed = fieldsRaw.map((field, index) => startField(field, `spec.start.fields[${index}]`, problems))
      const names = parsed.map((field) => field?.name).filter((name): name is string => name !== undefined)
      const repeated = names.find((name, index) => names.indexOf(name) !== index)
      if (repeated) { problems.push(`spec.start.fields names "${repeated}" twice`) }
      const complete = parsed.filter((field): field is StartField => field !== undefined)
      fields = complete.length === parsed.length && !repeated ? complete : undefined
    }
    if (fields && maxDraftBytes !== undefined) { start = { fields, maxDraftBytes } }
  }

  let palette: BuilderSpec['palette'] | undefined
  const paletteRaw = read.object('palette', true)
  if (paletteRaw) {
    const inner = reader(paletteRaw, 'spec.palette', problems)
    const plugin = inner.string('plugin', { max: 63, pattern: PLUGIN_NAME, required: true })
    const restActionRef = optionalRef(inner, 'restActionRef', problems)
    inner.done()
    if (plugin !== undefined && restActionRef !== null) { palette = { plugin, ...(restActionRef ? { restActionRef } : {}) } }
  }

  const canvas = pluginRef(read, 'canvas', true, problems)
  const inspector = pluginRef(read, 'inspector', true, problems)
  const parser = pluginRef(read, 'parser', false, problems)
  const summarizer = pluginRef(read, 'summarizer', false, problems)

  let preview: BuilderSpec['preview'] | undefined
  const previewRaw = read.object('preview', true)
  if (previewRaw) {
    const inner = reader(previewRaw, 'spec.preview', problems)
    const mode = inner.oneOf<PreviewMode>('mode', ['sandbox-apply', 'render'])
    const restActionRef = optionalRef(inner, 'restActionRef', problems)
    inner.done()
    // The CRD's x-kubernetes-validations rule, word for word.
    if (mode === 'render' && restActionRef === undefined) {
      problems.push('a render preview names the RESTAction that renders it (preview.restActionRef)')
    } else if (mode !== undefined && restActionRef !== null) {
      preview = { mode, ...(restActionRef ? { restActionRef } : {}) }
    }
  }

  let files: BuilderSpec['files'] | undefined
  const filesRaw = read.object('files', true)
  if (filesRaw) {
    const inner = reader(filesRaw, 'spec.files', problems)
    const required = inner.set('required', { max: 253 })
    const locked = inner.set('locked', { max: 253 })
    const heldBytes = inner.bytes('heldBytes', false)
    inner.done()
    const both = required?.filter((path) => locked?.includes(path)) ?? []
    both.forEach((path) => problems.push(`spec.files lists "${path}" as both required and locked — a file the author must keep but may never write`))
    if (required && locked && !both.length) { files = { locked, required, ...(heldBytes !== undefined ? { heldBytes } : {}) } }
  }

  const lint = read.set('lint', { max: 63, pattern: PLUGIN_NAME })
  const gates = read.set('gates', { max: 63, pattern: PLUGIN_NAME })

  let publish: BuilderSpec['publish'] | undefined
  const publishRaw = read.object('publish', true)
  if (publishRaw) {
    const inner = reader(publishRaw, 'spec.publish', problems)
    const builder = inner.oneOf<PublishBuilder>('builder', ['page', 'blueprint', 'controller'])
    const targetKey = inner.string('targetKey', { max: 63, pattern: CONFIG_KEY, required: true })
    const templateKey = inner.string('templateKey', { max: 63, pattern: CONFIG_KEY, required: true })
    const registrationRaw = inner.object('registration', true)
    inner.done()
    let registration: BuilderSpec['publish']['registration'] | undefined
    if (registrationRaw) {
      const reg = reader(registrationRaw, 'spec.publish.registration', problems)
      const kind = reg.oneOf('kind', ['CompositionDefinition'] as const)
      const path = reg.string('path', { max: 253, min: 1, required: true })
      reg.done()
      if (kind && path) { registration = { kind, path } }
    }
    if (builder && targetKey && templateKey && registration) { publish = { builder, registration, targetKey, templateKey } }
  }

  let verbs: BuilderSpec['verbs'] | undefined
  const verbsRaw = read.object('verbs', true)
  if (verbsRaw) {
    const inner = reader(verbsRaw, 'spec.verbs', problems)
    const allowed = inner.set('allowed', { max: 63, pattern: VERB })
    inner.done()
    if (allowed) { verbs = { allowed } }
  }

  let portal: BuilderSpec['portal'] | undefined
  const portalRaw = read.object('portal', true)
  if (portalRaw) {
    const inner = reader(portalRaw, 'spec.portal', problems)
    const cardRaw = inner.object('draftsCard', true)
    const draftsCard = cardRaw ? namespacedRef(cardRaw, 'spec.portal.draftsCard', problems) : undefined
    const deliverablesRestActionRef = optionalRef(inner, 'deliverablesRestActionRef', problems)
    inner.done()
    if (draftsCard && deliverablesRestActionRef !== null) {
      portal = { draftsCard, ...(deliverablesRestActionRef ? { deliverablesRestActionRef } : {}) }
    }
  }

  read.done()
  if (problems.length > before) { return null }
  // Every required piece parsed (no problem was added), so each is defined; the checks narrow it.
  if (!route || !label || !draftKind || !start || !palette || !canvas || !inspector || !preview || !files
    || !lint || !gates || !publish || !verbs || !portal) {
    return null
  }
  return {
    canvas,
    draftKind,
    files,
    gates,
    inspector,
    label,
    lint,
    palette,
    portal,
    preview,
    publish,
    route,
    start,
    verbs,
    ...(parser ? { parser } : {}),
    ...(summarizer ? { summarizer } : {}),
  }
}

/**
 * A Builder out of whatever the cluster (or a fixture) handed over. Checks the envelope — apiVersion,
 * kind, a name — and the whole spec against the CRD's rules; never throws.
 */
export const parseBuilder = (value: unknown): BuilderParseResult => {
  if (!isObject(value)) {
    return { ok: false, problems: ['a Builder must be an object'] }
  }
  const problems: string[] = []
  if (value.apiVersion !== BUILDER_API_VERSION) {
    problems.push(`apiVersion must be ${BUILDER_API_VERSION}, not ${JSON.stringify(value.apiVersion)}`)
  }
  if (value.kind !== BUILDER_KIND) {
    problems.push(`kind must be ${BUILDER_KIND}, not ${JSON.stringify(value.kind)}`)
  }
  const metadata = isObject(value.metadata) ? value.metadata : null
  const name = typeof metadata?.name === 'string' && metadata.name ? metadata.name : null
  if (!name) {
    problems.push('metadata.name is required')
  }
  const namespace = typeof metadata?.namespace === 'string' && metadata.namespace ? metadata.namespace : undefined
  if (!isObject(value.spec)) {
    problems.push('spec is required')
    return { ok: false, problems }
  }
  const spec = parseSpec(value.spec, problems)
  if (!spec || !name || problems.length) {
    return { ok: false, problems }
  }
  return {
    builder: { apiVersion: BUILDER_API_VERSION, kind: BUILDER_KIND, metadata: { name, ...(namespace ? { namespace } : {}) }, spec },
    ok: true,
  }
}
