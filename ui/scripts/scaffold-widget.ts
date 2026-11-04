/* eslint-disable no-console, no-await-in-loop */
import { checkbox, confirm, input, select } from '@inquirer/prompts'
import chalk from 'chalk'

import { emitWidget, type WidgetPropDef, type WidgetSpec } from './widget-codegen'

/**
 * Interactive scaffolder for a new Krateo widget. Gathers a widget spec and
 * emits schema/component/index/example via the shared codegen, then prints the
 * follow-up codegen steps. For broad antd coverage, prefer the catalog-driven
 * `gen-antd-widgets` instead.
 */

// Use `integer` rather than `number`: the CRD generator (controller-gen under both krateoctl and
// today's plumbing/crdgen) rejects float
// types when generating CRDs, and the repo convention is integer everywhere.
type JsonType = 'string' | 'integer' | 'boolean' | 'array' | 'object'

const buildPropSchema = (type: JsonType, description: string, enumValues: string): Record<string, unknown> => {
  const schema: Record<string, unknown> = { description, type }
  if (type === 'string' && enumValues.trim()) {
    schema.enum = enumValues.split(',').map((value) => value.trim()).filter(Boolean)
  }
  if (type === 'array') {
    schema.items = { type: 'string' }
  }
  return schema
}

async function main() {
  console.log(chalk.blue('\n🧩 Scaffold a new Krateo widget\n'))
  console.log(chalk.gray('Convention: mirror Ant Design. For a 1:1 wrapper, the kind = the antd component'))
  console.log(chalk.gray('name, and each prop uses the antd prop name/shape verbatim. See docs/widget-authoring.md.\n'))

  // antd component first, so the kind can default to it (the 1:1-wrapper convention).
  const component = await input({ message: 'Ant Design component to wrap (exact export name, e.g. Tag):' })
  const kind = await input({
    default: component,
    message: 'Widget kind (PascalCase; defaults to the antd component name — keep it for a 1:1 wrapper):',
    validate: (value) => /^[A-Z][A-Za-z0-9]+$/.test(value) || 'Use PascalCase, e.g. StatusBadge',
  })
  const description = await input({ message: 'One-line description:' })

  const props: WidgetPropDef[] = []
  let addMore = await confirm({ default: true, message: 'Add a widgetData property?' })
  while (addMore) {
    const name = await input({ message: '  prop name (use the EXACT antd prop name + value shape):' })
    const type = await select<JsonType>({
      choices: ['string', 'integer', 'boolean', 'array', 'object'].map((value) => ({ value: value as JsonType })),
      message: '  prop type:',
    })
    const propDescription = await input({ message: '  prop description:' })
    const enumValues = type === 'string' ? await input({ message: '  allowed values (comma-separated, blank for free text):' }) : ''
    const required = await confirm({ default: false, message: '  required?' })
    props.push({ name, required, schema: buildPropSchema(type, propDescription, enumValues) })
    addMore = await confirm({ default: false, message: 'Add another property?' })
  }

  const stringProps = props.filter((prop) => (prop.schema as { type?: string }).type === 'string').map((prop) => prop.name)
  let childrenProp: string | undefined
  if (stringProps.length) {
    const picked = await checkbox({
      choices: stringProps.map((name) => ({ value: name })),
      message: 'Render one string prop as the component children? (pick at most one)',
    })
    childrenProp = picked[0]
  }

  const spec: WidgetSpec = {
    childrenProp,
    component,
    description,
    examples: [
      { comment: `Basic ${kind}`, name: `example-${kind.toLowerCase()}-basic`, widgetData: {} },
    ],
    kind,
    props,
  }

  const result = await emitWidget(spec)
  if (result.status === 'skipped') {
    console.log(chalk.red(`\n✗ src/widgets/${kind} already exists — aborted.\n`))
    return
  }

  console.log(chalk.green(`\n✅ Created src/widgets/${kind} and its example fixture.`))
  console.log(chalk.yellow('Next: npm run generate-types   (then generate-crds + apply-crds where a cluster is available)\n'))
}

void main()
