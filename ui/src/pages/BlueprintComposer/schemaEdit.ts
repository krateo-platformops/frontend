/**
 * values.schema.json, edited the way crdgen needs it — the form editor's kernels. Pure.
 *
 * THE RULE IS THE LINT'S, NOT A COPY. What is a problem comes from `schemaDefaultsFindings`, the
 * walk `lintBlueprintDraft` words; this module only LOCATES each finding in the text (so the editor
 * can mark its lines) and, for the one class that has a mechanical fix, applies it. Every output is
 * held to the lint in the tests.
 *
 * EVERY EDIT IS A SPLICE. The schema is the author's text — its key order is the form's field
 * order (Form.tsx's stringSchema), its line breaks are how they chose to read it. Parsing and
 * re-serialising would reorder nothing but reformat everything. So a small tokenizer maps each key
 * path to the span of text it occupies, and an edit replaces or inserts inside that span only;
 * every byte outside it is kept.
 *
 * "FIX IT FOR ME" (mockup 10:75) empties the populated object default — the core-provider#46 wedge —
 * and moves each scalar it held onto the property of the same name, where that property exists and
 * has no default of its own (an author's default is never overwritten). Nested object defaults are
 * followed down; a populated array default becomes `[]`. A combinator has no mechanical fix: the
 * constraint it expresses belongs in the templates, and only a person can move it there.
 */
import { VALUES_SCHEMA_PATH, schemaDefaultsFindings, type SchemaFinding } from '../../components/Autopilot/blueprintDraft'

export interface SchemaProblemAt {
  code: 'CRDGEN-DEFAULTS' | 'CRDGEN-COMBINATOR' | 'JSON'
  /** The lint's path — `properties.credentials.default`. Empty for a JSON problem. */
  path: string
  /** As a person reads it — `credentials.default`. */
  field: string
  /** The lines to mark, 1-based and inclusive: the property that holds the problem. */
  startLine: number
  endLine: number
  message: string
  fixable: boolean
}

export type SchemaEditResult = { ok: true; text: string } | { ok: false; reason: string }

export type FormFieldType = 'string' | 'number' | 'boolean' | 'enum'

/** The field types a form can be given here, in the palette's order (03:61), with their names. */
export const FORM_FIELD_TYPES: { type: FormFieldType; label: string }[] = [
  { label: 'String', type: 'string' },
  { label: 'Number', type: 'number' },
  { label: 'Boolean', type: 'boolean' },
  { label: 'Enum', type: 'enum' },
]

// ── A JSON tokenizer that remembers where everything is ─────────────────────────────────────────

interface Span { start: number; end: number }
type JsonNode =
  | (Span & { type: 'object'; members: { key: string; keyStart: number; value: JsonNode }[] })
  | (Span & { type: 'array'; items: JsonNode[] })
  | (Span & { type: 'scalar' })

class JsonSyntax extends Error {
  constructor(readonly position: number) {
    super(`unexpected input at ${position}`)
  }
}

const NUMBER = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/y

/** Parse `text` into spans. Throws JsonSyntax where it stops making sense. */
const parseSpans = (text: string): JsonNode => {
  let pos = 0
  const skip = (): void => {
    while (pos < text.length && ' \t\n\r'.includes(text[pos])) { pos += 1 }
  }
  const expect = (char: string): void => {
    if (text[pos] !== char) { throw new JsonSyntax(pos) }
    pos += 1
  }
  const string = (): string => {
    const start = pos
    expect('"')
    while (pos < text.length && text[pos] !== '"') { pos += text[pos] === '\\' ? 2 : 1 }
    expect('"')
    return JSON.parse(text.slice(start, pos)) as string
  }
  const value = (): JsonNode => {
    skip()
    const start = pos
    const char = text[pos]
    if (char === '{') {
      pos += 1
      const members: { key: string; keyStart: number; value: JsonNode }[] = []
      skip()
      if (text[pos] !== '}') {
        for (;;) {
          skip()
          const keyStart = pos
          const key = string()
          skip()
          expect(':')
          members.push({ key, keyStart, value: value() })
          skip()
          if (text[pos] !== ',') { break }
          pos += 1
        }
      }
      expect('}')
      return { end: pos, members, start, type: 'object' }
    }
    if (char === '[') {
      pos += 1
      const items: JsonNode[] = []
      skip()
      if (text[pos] !== ']') {
        for (;;) {
          items.push(value())
          skip()
          if (text[pos] !== ',') { break }
          pos += 1
        }
      }
      expect(']')
      return { end: pos, items, start, type: 'array' }
    }
    if (char === '"') {
      string()
      return { end: pos, start, type: 'scalar' }
    }
    for (const literal of ['true', 'false', 'null']) {
      if (text.startsWith(literal, pos)) {
        pos += literal.length
        return { end: pos, start, type: 'scalar' }
      }
    }
    NUMBER.lastIndex = pos
    const number = NUMBER.exec(text)
    if (!number) { throw new JsonSyntax(pos) }
    pos += number[0].length
    return { end: pos, start, type: 'scalar' }
  }
  const root = value()
  skip()
  if (pos !== text.length) { throw new JsonSyntax(pos) }
  return root
}

/** The node at a walk of keys and indexes — the LAST member of a repeated key, as JSON.parse keeps. */
const nodeAt = (root: JsonNode, segments: readonly (string | number)[]): { node: JsonNode; keyStart: number | null } | null => {
  let node = root
  let keyStart: number | null = null
  for (const segment of segments) {
    if (node.type === 'object' && typeof segment === 'string') {
      const member = [...node.members].reverse().find((entry) => entry.key === segment)
      if (!member) { return null }
      node = member.value
      keyStart = member.keyStart
    } else if (node.type === 'array' && typeof segment === 'number' && segment < node.items.length) {
      node = node.items[segment]
      keyStart = null
    } else {
      return null
    }
  }
  return { keyStart, node }
}

const lineOf = (text: string, offset: number): number => text.slice(0, Math.max(0, offset)).split('\n').length

const indentAt = (text: string, offset: number): string => {
  const lineStart = text.lastIndexOf('\n', offset - 1) + 1
  return /^[ \t]*/.exec(text.slice(lineStart))?.[0] ?? ''
}

const asRecord = (value: unknown): Record<string, unknown> | null =>
  (value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null)

const own = (record: Record<string, unknown>, key: string): boolean => Object.prototype.hasOwnProperty.call(record, key)

interface Splice { start: number; end: number; text: string }

const applySplices = (text: string, splices: Splice[]): string => [...splices]
  .sort((left, right) => right.start - left.start)
  .reduce((out, splice) => `${out.slice(0, splice.start)}${splice.text}${out.slice(splice.end)}`, text)

/**
 * The splice that adds `"key": value` as the last member of an object. Multi-line objects get it on
 * a line of its own at the last member's indent; an empty one is opened out onto lines of its own
 * when `expandEmpty` (the object sits in a multi-line schema) and kept on one line otherwise.
 */
const insertMember = (text: string, node: JsonNode & { type: 'object' }, key: string, value: string, expandEmpty: boolean): Splice => {
  const member = `${JSON.stringify(key)}: ${value}`
  const last = node.members[node.members.length - 1]
  if (!last) {
    if (!expandEmpty) {
      return { end: node.end, start: node.start, text: `{ ${member} }` }
    }
    const outer = indentAt(text, node.start)
    return { end: node.end, start: node.start, text: `{\n${outer}  ${member}\n${outer}}` }
  }
  const multiline = text.slice(node.start, node.end).includes('\n')
  return { end: last.value.end, start: last.value.end, text: multiline ? `,\n${indentAt(text, last.keyStart)}${member}` : `, ${member}` }
}

// ── Where the problems are ──────────────────────────────────────────────────────────────────────

const NAME_MAPS = new Set(['$defs', 'definitions', 'patternProperties', 'properties'])

/** `properties.credentials.default` as a person reads it: `credentials.default`. */
const fieldOf = (segments: readonly (string | number)[]): string => {
  const out: string[] = []
  for (let idx = 0; idx < segments.length; idx += 1) {
    const segment = segments[idx]
    if (typeof segment === 'number') {
      out.push(`[${segment}]`)
    } else if (NAME_MAPS.has(segment) && idx + 1 < segments.length) {
      out.push(`.${String(segments[idx + 1])}`)
      idx += 1
    } else {
      out.push(`.${segment}`)
    }
  }
  return out.join('').replace(/^\./, '')
}

const findingMessage = (finding: SchemaFinding, field: string): string => {
  const wedge = 'breaks Krateo\'s CRD generation: the CompositionDefinition would wedge at Ready=False.'
  if (finding.code === 'CRDGEN-COMBINATOR') {
    return `${field} — \`${finding.keyword ?? ''}\` is valid JSON Schema but ${wedge} Express the constraint in the chart's templates instead.`
  }
  return finding.shape === 'array'
    ? `${field} — a populated array default ${wedge} Keep the array default empty and put the items in values.yaml.`
    : `${field} — a populated object default ${wedge} Keep the object default empty and put the values on the scalars inside it.`
}

/** Where JSON.parse gave up, when the tokenizer did not — its own "position N", or the first line. */
const nativePosition = (message: string): number => Number(/position (\d+)/.exec(message)?.[1] ?? 0)

export const schemaProblemsAt = (text: string): SchemaProblemAt[] => {
  try {
    JSON.parse(text)
  } catch (error) {
    const native = error instanceof Error ? error.message : String(error)
    let position = nativePosition(native)
    try {
      parseSpans(text)
    } catch (syntax) {
      if (syntax instanceof JsonSyntax) { ({ position } = syntax) }
    }
    const line = lineOf(text, position)
    return [{ code: 'JSON', endLine: line, field: '', fixable: false, message: `${VALUES_SCHEMA_PATH} is not valid JSON — ${native}`, path: '', startLine: line }]
  }
  const root = parseSpans(text)
  return schemaDefaultsFindings(text).map((finding) => {
    // The PROPERTY that holds the keyword is what gets marked (10:69-73): from its key to its end.
    const holder = finding.segments.length > 1 ? finding.segments.slice(0, -1) : finding.segments
    const found = nodeAt(root, holder)
    const start = found ? (found.keyStart ?? found.node.start) : 0
    const end = found ? found.node.end : text.length
    const field = fieldOf(finding.segments)
    return {
      code: finding.code,
      endLine: lineOf(text, end - 1),
      field,
      fixable: finding.code === 'CRDGEN-DEFAULTS',
      message: findingMessage(finding, field),
      path: finding.path,
      startLine: lineOf(text, start),
    }
  })
}

/** The top-level properties whose subtree has a problem — the form does not render those. */
export const formSuppressions = (text: string): string[] => {
  const names = schemaDefaultsFindings(text)
    .filter((finding) => finding.segments[0] === 'properties' && finding.segments.length >= 3)
    .map((finding) => String(finding.segments[1]))
  return [...new Set(names)]
}

// ── The fix ─────────────────────────────────────────────────────────────────────────────────────

const isScalar = (value: unknown): boolean => value === null || ['string', 'number', 'boolean'].includes(typeof value)

/** The inserts that carry an emptied object default's scalars onto the properties they belong to. */
const moves = (text: string, root: JsonNode, owner: unknown, ownerSegments: (string | number)[], removed: Record<string, unknown>): Splice[] => {
  const properties = asRecord(asRecord(owner)?.properties)
  if (!properties) { return [] }
  return Object.entries(removed).flatMap(([key, value]) => {
    const property = own(properties, key) ? asRecord(properties[key]) : null
    if (!property) { return [] }
    const at = [...ownerSegments, 'properties', key]
    if (isScalar(value)) {
      const found = nodeAt(root, at)
      if (own(property, 'default') || found?.node.type !== 'object') { return [] }
      return [insertMember(text, found.node, 'default', JSON.stringify(value), false)]
    }
    const nested = asRecord(value)
    return nested && Object.keys(nested).length ? moves(text, root, property, at, nested) : []
  })
}

export const fixPopulatedDefault = (text: string, path: string): SchemaEditResult => {
  const finding = schemaDefaultsFindings(text).find((entry) => entry.path === path)
  if (!finding) {
    return { ok: false, reason: `There is no problem at ${path} to fix — the schema has changed since it was read.` }
  }
  if (finding.code !== 'CRDGEN-DEFAULTS') {
    return { ok: false, reason: `${fieldOf(finding.segments)} cannot be fixed for you: the constraint a combinator expresses belongs in the chart's templates.` }
  }
  const root = parseSpans(text)
  const target = nodeAt(root, finding.segments)
  if (!target) {
    return { ok: false, reason: `${path} could not be found in the text.` }
  }
  if (finding.shape === 'array') {
    return { ok: true, text: applySplices(text, [{ end: target.node.end, start: target.node.start, text: '[]' }]) }
  }
  let owner: unknown = JSON.parse(text)
  let removed: unknown = owner
  for (const segment of finding.segments) {
    removed = (removed as Record<string | number, unknown>)[segment]
  }
  const ownerSegments = finding.segments.slice(0, -1)
  for (const segment of ownerSegments) {
    owner = (owner as Record<string | number, unknown>)[segment]
  }
  const carried = moves(text, root, owner, ownerSegments, asRecord(removed) ?? {})
  return { ok: true, text: applySplices(text, [{ end: target.node.end, start: target.node.start, text: '{}' }, ...carried]) }
}

// ── A new field ─────────────────────────────────────────────────────────────────────────────────

const FIELD_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/

/**
 * Names the create form's fields cannot take, each with its own reason. `global` is not the form's
 * own: composition-dynamic-controller adds a `global` OBJECT to the values of every render, so a
 * string, number, boolean or enum field by that name passes the lint and Preview (which render with
 * no globals) and then fails Helm's schema check for every composition of the published chart.
 */
const RESERVED: Readonly<Record<string, string>> = {
  global: '"global" is reserved — composition-dynamic-controller adds a global block of its own to the values of every render, so a field by that name would fail every composition.',
  name: '"name" is reserved — the create form always asks for the composition\'s name and namespace itself.',
  namespace: '"namespace" is reserved — the create form always asks for the composition\'s name and namespace itself.',
}

const FIELD_SCHEMA: Record<FormFieldType, string> = {
  boolean: '{ "type": "boolean" }',
  enum: '{ "type": "string", "enum": ["option-1"] }',
  number: '{ "type": "number" }',
  string: '{ "type": "string" }',
}

export const addFormField = (text: string, field: { name: string; type: FormFieldType }): SchemaEditResult => {
  const name = field.name.trim()
  if (!FIELD_NAME.test(name)) {
    return { ok: false, reason: `"${name}" is not a field name — letters, digits and underscores, starting with a letter or an underscore.` }
  }
  if (own(RESERVED, name)) {
    return { ok: false, reason: RESERVED[name] }
  }
  let parsed: unknown
  let root: JsonNode
  try {
    parsed = JSON.parse(text)
    root = parseSpans(text)
  } catch {
    return { ok: false, reason: `${VALUES_SCHEMA_PATH} is not valid JSON — fix it before adding a field.` }
  }
  const schema = asRecord(parsed)
  if (!schema || root.type !== 'object') {
    return { ok: false, reason: `${VALUES_SCHEMA_PATH} is not an object schema, so it has no fields to add to.` }
  }
  const properties = own(schema, 'properties') ? asRecord(schema.properties) : null
  if (properties && own(properties, name)) {
    return { ok: false, reason: `"${name}" is already a field of this form.` }
  }
  const multiline = text.slice(root.start, root.end).includes('\n')
  const found = nodeAt(root, ['properties'])
  if (properties && found?.node.type === 'object') {
    return { ok: true, text: applySplices(text, [insertMember(text, found.node, name, FIELD_SCHEMA[field.type], multiline)]) }
  }
  if (own(schema, 'properties')) {
    return { ok: false, reason: `${VALUES_SCHEMA_PATH}'s "properties" is not an object, so it has no fields to add to.` }
  }
  return { ok: true, text: applySplices(text, [insertMember(text, root, 'properties', `{ ${JSON.stringify(name)}: ${FIELD_SCHEMA[field.type]} }`, multiline)]) }
}
