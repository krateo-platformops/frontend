/**
 * Turn "this API path, these columns" into the RESTAction + widget pair that actually renders.
 *
 * THIS IS THE GAP. 212 of the portal's 425 widget templates carry a `widgetDataTemplate` — they
 * compute their data server-side from a RESTAction through jq. Nothing in the builder could author
 * one, so everything it produced was static, and `restaction.page-composable` said as much before
 * either builder card existed: "an editor that authors NEW widgets from static widgetData can only
 * produce the trivial ones". Closing it means generating BOTH halves, because a widget without its
 * RESTAction is inert and a RESTAction without its widget is invisible.
 *
 * THE AUTHOR NEVER WRITES jq. They give a path, where the list lives, and a map of column title to
 * field path. Everything below — the `rows` envelope, the cell-array shaping, the `// empty`
 * guards — is generated, which is what makes this usable by someone who has never seen jq and what
 * keeps the two halves consistent by construction rather than by care.
 *
 * FIELD PATHS ARE VALIDATED, NOT INTERPOLATED. What the author types lands inside a jq program, so
 * an unchecked string is both a footgun and a break: one stray `|` or `)` and the filter is
 * malformed in a way the author cannot read. Only a conservative path subset is accepted —
 * `.a`, `.a.b`, `.a[0]`, `.a["k"]` — and anything else is refused by name. That is narrower than jq
 * and deliberately so: the refusal is legible, the alternative is a syntax error in generated code.
 */
import { dump } from 'js-yaml'

export interface BindingInput {
  /** Base name for both objects — the RESTAction and the widget share it. */
  name: string
  /** Apiserver path the RESTAction GETs, e.g. /apis/<group>/<version>/namespaces/<ns>/<plural>. */
  apiPath: string
  /** Where the list lives in the response. `.items` for a Kubernetes list; `.` for a bare array. */
  itemsAt: string
  /** Column title -> field path within one item, in the order the columns should appear. */
  columns: Record<string, string>
  /** Repo directory both files are written to. */
  directory: string
  namespace?: string
}

export interface GeneratedFile {
  path: string
  content: string
}

export type BindingResult =
  /** `name` is carried back so a caller can place the widget without re-deriving it from a path. */
  | { ok: true; name: string; restAction: GeneratedFile; widget: GeneratedFile }
  | { ok: false; error: string }

const WIDGET_API_VERSION = 'widgets.templates.krateo.io/v1beta1'
const RESTACTION_API_VERSION = 'templates.krateo.io/v1'
const DUMP = { lineWidth: -1, noRefs: true } as const

/**
 * A jq path, and nothing else: a dotted chain of identifiers with optional numeric or
 * quoted-string subscripts. No pipes, no functions, no arithmetic, no `//`.
 *
 * Narrow on purpose. Everything this rejects is something the author would have to debug inside
 * generated code they did not write; a named refusal at the form is a better failure.
 */
const FIELD_PATH = /^\.(?:[A-Za-z_][A-Za-z0-9_]*|\["[^"\]]*"\]|\[\d+\])(?:\.[A-Za-z_][A-Za-z0-9_]*|\["[^"\]]*"\]|\[\d+\])*$/

/** `.items`, `.` (the response IS the array), or a nested path to one. */
const isItemsPath = (value: string): boolean => value === '.' || FIELD_PATH.test(value)

const DNS_1123 = /^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/

export const validateBinding = (input: BindingInput): string | null => {
  if (!DNS_1123.test(input.name)) {
    return 'name must be lower-case letters, digits and dashes (it becomes two resource names)'
  }
  if (!input.apiPath.startsWith('/')) {
    return 'the API path must start with "/" — it is an apiserver path, not a URL'
  }
  if (!isItemsPath(input.itemsAt)) {
    return `"${input.itemsAt}" is not a field path — use .items, or . when the response is itself the list`
  }
  const entries = Object.entries(input.columns)
  if (!entries.length) {
    return 'add at least one column — a table with no columns renders nothing'
  }
  for (const [title, path] of entries) {
    if (!title.trim()) {
      return 'every column needs a title — it is the header the reader sees'
    }
    if (!FIELD_PATH.test(path)) {
      return `"${path}" (${title}) is not a supported field path — use forms like .metadata.name or .status.conditions[0].type`
    }
  }
  return null
}

/**
 * Generate the pair.
 *
 * The RESTAction shapes EVERY response into the same `{ rows: [...] }` envelope regardless of what
 * it queried. That uniformity is what makes the widget's template mechanical: one shape in, one
 * shape out, so the two halves cannot drift into disagreeing about the data between them.
 *
 * Cells are keyed `c1..cN` rather than by title. A title is free text — spaces, punctuation, a
 * duplicate — and none of that is safe as a jq object key or a `valueKey`. The title stays where it
 * belongs, as the column header.
 */
export const generateBinding = (input: BindingInput): BindingResult => {
  const error = validateBinding(input)
  if (error) {
    return { error, ok: false }
  }

  const dir = input.directory.replace(/\/$/, '')
  const entries = Object.entries(input.columns)
  const keyed = entries.map(([title, path], index) => ({ key: `c${index + 1}`, path, title }))

  // `// empty` on each field: a row missing one value yields an absent cell rather than failing
  // the whole filter, which is how one malformed object would otherwise blank the entire table.
  // `tostring` because a cell is rendered as a string and a raw number would fail the widget's
  // strict stringValue typing.
  const projection = keyed
    .map(({ key, path }) => `${key}: ((${path} // empty) | tostring)`)
    .join(', ')
  const source = input.itemsAt === '.' ? '.src' : `.src${input.itemsAt}`
  const filter = `{ rows: [ (${source} // [])[]? | { ${projection} } ] }`

  const restAction: GeneratedFile = {
    content: dump({
      apiVersion: RESTACTION_API_VERSION,
      kind: 'RESTAction',
      metadata: { name: input.name, namespace: input.namespace },
      spec: {
        api: [{ headers: ['Accept: application/json'], name: 'src', path: input.apiPath, verb: 'GET' }],
        filter,
      },
    }, DUMP),
    path: `${dir}/restaction.${input.name}.yaml`,
  }

  const cells = keyed
    .map(({ key }) => `{valueKey:"${key}",kind:"jsonSchemaType",type:"string",stringValue:.${key}}`)
    .join(', ')

  const widget: GeneratedFile = {
    content: dump({
      apiVersion: WIDGET_API_VERSION,
      kind: 'Table',
      metadata: { name: input.name, namespace: input.namespace },
      spec: {
        apiRef: { name: input.name, namespace: input.namespace },
        resourcesRefs: { items: [] },
        widgetData: {
          // REQUIRED by the Table CRD — omitting it is rejected at apply with
          // "spec.widgetData.allowedResources: Required value". Empty because a Table holds no
          // child widgets; it is the container kinds that grow this list as children are placed.
          allowedResources: [],
          columns: keyed.map(({ key, title }) => ({ title, valueKey: key })),
          dataSource: [],
        },
        widgetDataTemplate: [{ expression: `\${ [ .rows[] | [ ${cells} ] ] }`, forPath: 'dataSource' }],
      },
    }, DUMP),
    path: `${dir}/table.${input.name}.yaml`,
  }

  return { name: input.name, ok: true, restAction, widget }
}
