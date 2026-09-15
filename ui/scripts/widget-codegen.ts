import { promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Shared widget code generation used by both the interactive scaffolder
 * (`scaffold-widget.ts`) and the antd-coverage generator (`gen-antd-widgets.ts`).
 *
 * It emits, for one widget, the same artifacts a hand-authored widget has:
 *   src/widgets/<Kind>/<Kind>.schema.json   (source of truth; `generate-types` → .type.d.ts)
 *   src/widgets/<Kind>/<Kind>.tsx
 *   src/widgets/<Kind>/index.ts              (defineWidget → registry auto-discovery)
 *   src/examples/widgets/<Kind>/<Kind>.example.yaml
 *
 * It deliberately does NOT run krateoctl/kubectl — CRD generation and cluster
 * apply remain separate, explicit steps (see docs/widget-authoring.md).
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
export const WIDGETS_DIR = path.join(ROOT, 'src', 'widgets')
export const EXAMPLES_DIR = path.join(ROOT, 'src', 'examples', 'widgets')

export type PropTarget = 'widgetData' | 'action' | 'resourcesRefs'

export interface WidgetPropDef {
  /** Property name; for `widgetData` props this must match the antd prop name. */
  name: string
  /** JSON Schema fragment describing the property. */
  schema: Record<string, unknown>
  required?: boolean
}

export interface WidgetSpec {
  kind: string
  /** antd export name to wrap, e.g. `Tag`. Omit for a non-antd custom widget. */
  component: string
  description: string
  /** `widgetData` props mapped 1:1 onto the antd component. */
  props: WidgetPropDef[]
  /** A string `widgetData` prop rendered as the component's children. */
  childrenProp?: string
  /** Two example `widgetData` payloads used to build the example fixture. */
  examples: Array<{ name: string; comment: string; widgetData: Record<string, unknown> }>
}

const widgetDataSchema = (spec: WidgetSpec) => {
  const properties: Record<string, unknown> = {}
  const required: string[] = []
  for (const prop of spec.props) {
    properties[prop.name] = prop.schema
    if (prop.required) { required.push(prop.name) }
  }
  return {
    additionalProperties: false,
    type: 'object',
    ...(required.length ? { required } : {}),
    properties,
  }
}

export const buildSchema = (spec: WidgetSpec) => ({
  additionalProperties: false,
  properties: {
    kind: { default: spec.kind, description: spec.description, type: 'string' },
    spec: {
      additionalProperties: false,
      // C25: the envelope is described ONCE, here, rather than retyped in 44 schemas. These
      // fields are identical in every widget and are emitted, not authored — describing them
      // per-widget was 1,279 of the 1,518 undescribed properties and taught an author nothing.
      description: "The widget's contract: its own data, an optional binding to a RESTAction, and any templated overrides applied to that data.",
      properties: {
        apiRef: {
          additionalProperties: false,
          description: 'Binds this widget to a RESTAction whose response feeds widgetDataTemplate expressions. Omit it for a widget whose data is entirely static.',
          properties: {
            name: { description: 'Name of the RESTAction resource to call.', type: 'string' },
            namespace: { description: 'Namespace of the RESTAction resource.', type: 'string' },
          },
          required: ['name', 'namespace'],
          type: 'object',
        },
        widgetData: widgetDataSchema(spec),
        widgetDataTemplate: {
          description: 'Per-field overrides evaluated against the apiRef response, so one authored widget can render live cluster data. Each entry replaces one value inside widgetData.',
          items: {
            additionalProperties: false,
            properties: {
              expression: { description: 'A jq expression evaluated server-side against the apiRef response. Its result replaces the value at forPath.', type: 'string' },
              forPath: { description: 'Dot-path inside widgetData whose value this expression replaces, for example `items[0].title`.', type: 'string' },
            },
            type: 'object',
          },
          type: 'array',
        },
      },
      required: ['widgetData'],
      type: 'object',
    },
    version: { default: 'v1beta1', description: 'Widget API version. Defaults to v1beta1.', type: 'string' },
  },
  required: ['kind', 'spec', 'version'],
  type: 'object',
})

export const renderComponent = (spec: WidgetSpec): string => {
  const Antd = `Antd${spec.component}`
  const childKey = spec.childrenProp

  const destructure = childKey ? `const { ${childKey}, ...rest } = widgetData` : null
  const spread = childKey ? '{...rest}' : '{...widgetData}'
  const jsx = childKey
    ? `<${Antd} key={uid} ${spread}>{${childKey}}</${Antd}>`
    : `<${Antd} key={uid} ${spread} />`

  return `import { ${spec.component} as ${Antd} } from 'antd'

import type { WidgetProps } from '../../types/Widget'

import type { ${spec.kind} as WidgetType } from './${spec.kind}.type'

export type ${spec.kind}WidgetData = WidgetType['spec']['widgetData']

const ${spec.kind} = ({ uid, widgetData }: WidgetProps<${spec.kind}WidgetData>) => {
${destructure ? `  ${destructure}\n\n` : ''}  return ${jsx}
}

export default ${spec.kind}
`
}

export const renderIndex = (spec: WidgetSpec): string =>
  `import { defineWidget } from '../widget-module'

import ${spec.kind} from './${spec.kind}'

export default defineWidget({ component: ${spec.kind}, kind: '${spec.kind}' })
`

const toYaml = (value: unknown, indent: number): string => {
  const pad = '  '.repeat(indent)
  if (Array.isArray(value)) {
    return value.map((item) => {
      if (item !== null && typeof item === 'object') {
        const inner = toYaml(item, indent + 1).replace(/^ {2}/, '')
        return `${pad}- ${inner.trimStart()}`
      }
      return `${pad}- ${JSON.stringify(item)}`
    }).join('\n')
  }
  if (value !== null && typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>).map(([key, val]) => {
      if (val !== null && typeof val === 'object') {
        return `${pad}${key}:\n${toYaml(val, indent + 1)}`
      }
      return `${pad}${key}: ${JSON.stringify(val)}`
    }).join('\n')
  }
  return `${pad}${JSON.stringify(value)}`
}

export const renderExample = (spec: WidgetSpec): string =>
  spec.examples.map(({ comment, name, widgetData }) =>
    `# ${comment}
kind: ${spec.kind}
apiVersion: widgets.templates.krateo.io/v1beta1
metadata:
  name: ${name}
  namespace: krateo-system
spec:
  widgetData:
${toYaml(widgetData, 2)}`
  ).join('\n---\n')

export interface EmitResult { kind: string; status: 'created' | 'skipped' }

export const emitWidget = async (spec: WidgetSpec, opts: { force?: boolean } = {}): Promise<EmitResult> => {
  const widgetDir = path.join(WIDGETS_DIR, spec.kind)
  const exampleDir = path.join(EXAMPLES_DIR, spec.kind)

  const exists = await fs.access(widgetDir).then(() => true).catch(() => false)
  if (exists && !opts.force) {
    return { kind: spec.kind, status: 'skipped' }
  }

  await fs.mkdir(widgetDir, { recursive: true })
  await fs.mkdir(exampleDir, { recursive: true })

  await fs.writeFile(path.join(widgetDir, `${spec.kind}.schema.json`), `${JSON.stringify(buildSchema(spec), null, 2)}\n`)
  await fs.writeFile(path.join(widgetDir, `${spec.kind}.tsx`), renderComponent(spec))
  await fs.writeFile(path.join(widgetDir, 'index.ts'), renderIndex(spec))
  await fs.writeFile(path.join(exampleDir, `${spec.kind}.example.yaml`), `${renderExample(spec)}\n`)

  return { kind: spec.kind, status: 'created' }
}
