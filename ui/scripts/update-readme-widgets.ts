/* eslint-disable no-console */
import { promises as fs } from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

import glob from 'fast-glob'

import type { JSONSchema, WidgetDataSchema } from '../src/utils/types'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const ROOT_DIR = path.join(__dirname, '../')
const WIDGETS_GLOB = 'src/widgets/**/**/*.schema.json'
const OUTPUT_FILE = path.join(ROOT_DIR, 'docs/widgets-api-reference.md')
const WIDGETS_ANCHOR = '## Widgets'

function toMarkdownTable(widgetData: WidgetDataSchema): string {
  const lines = ['| Property | Required | Description | Type |', '|----------|----------|-------------|------|']

  if (!widgetData.properties) {
    return '*No props available.*'
  }

  function walk(schema: WidgetDataSchema, path: string = '') {
    const { properties = {}, required = [] } = schema

    for (const [key, prop] of Object.entries(properties)) {
      const fullPath = path ? `${path}.${key}` : key
      const isRequired = required.includes(key)
      const requiredText = isRequired ? 'yes' : 'no'

      let type = 'unknown'

      if (prop.enum) {
        type = prop.enum.map((value) => `\`${value}\``).join(' \\| ')
      } else if (Array.isArray(prop.type)) {
        type = prop.type.join(' | ')
      } else if (prop.type === 'array') {
        type = 'array'
      } else if (prop.type === 'object') {
        type = 'object'
      } else if (typeof prop.type === 'string') {
        type = prop.type
      }

      const description = prop.description ?? ''
      lines.push(`| ${fullPath} | ${requiredText} | ${description} | ${type} |`)

      if (prop.type === 'object') {
        const nested = prop as WidgetDataSchema
        walk(nested, fullPath)
      }

      if (prop.type === 'array' && prop.items?.type === 'object' && 'properties' in prop.items) {
        const arrayItem = prop.items as WidgetDataSchema
        walk(arrayItem, `${fullPath}[]`)
      }
    }
  }

  walk(widgetData)
  return lines.join('\n')
}

async function formatSchemaToMarkdown(schema: JSONSchema, filePath: string): Promise<string> {
  const fileName = path.basename(filePath)
  const title = schema.title || schema.properties?.kind?.default || fileName.replace('.schema.json', '')
  const description = schema.description || schema.properties?.kind?.description || ''
  const widgetData = schema.properties?.spec?.properties?.widgetData

  const table = toMarkdownTable(widgetData ?? {})

  const widgetName = path.basename(filePath).replace('.schema.json', '')
  const exampleAbsolutePath = path.join(ROOT_DIR, 'src/examples/widgets', widgetName, `${widgetName}.example.yaml`)

  let exampleLink = ''
  try {
    await fs.access(exampleAbsolutePath)
    const exampleRelativePath = `../src/examples/widgets/${widgetName}/${widgetName}.example.yaml`
    exampleLink = `\n\n[Examples](${exampleRelativePath})\n`
  } catch {
    exampleLink = ''
  }

  const extraInfo = title.toLowerCase() === 'form'
    ? `\n\n> For additional information about the \`autocomplete\` and \`dependencies\` properties configuration, please visit [this page](./autocomplete-and-dependencies.md).\n
      \n\n> For additional information about the \`initialValues\` property configuration, please visit [this page](./form-values.md).\n`
    : ''

  return `### ${title}\n\n${description}\n\n#### Props\n\n${table}\n${exampleLink}${extraInfo}`
}

async function generateWidgetsSection(): Promise<string> {
  const schemaPaths = await glob(WIDGETS_GLOB, { absolute: true, cwd: ROOT_DIR })
  if (schemaPaths.length === 0) {
    return `${WIDGETS_ANCHOR}\n\n⚠️ No widget schemas found at \`${WIDGETS_GLOB}\`\n`
  }

  const sortedSchemaPaths = schemaPaths.sort((schemaA, schemaB) => path.basename(schemaA).localeCompare(path.basename(schemaB)))

  const docs = await Promise.all(
    sortedSchemaPaths.map(async (file) => {
      const content = await fs.readFile(file, 'utf-8')
      const schema: JSONSchema = JSON.parse(content) as JSONSchema
      return formatSchemaToMarkdown(schema, file)
    })
  )

  return `${WIDGETS_ANCHOR}\n\nList of implemented widgets:\n\n${docs.join('\n---\n\n')}`
}

/**
 * The reference is generated from the schemas and committed, and nothing used to check it: it
 * drifted by ~600 lines and three widgets (frontend#812). `--check` regenerates in memory and fails
 * when the committed file differs, so a schema change that skips the reference fails CI.
 */
async function updateReadme() {
  let readmeContent = ''
  try {
    readmeContent = await fs.readFile(OUTPUT_FILE, 'utf-8')
  } catch {
    console.error(`❌ ${OUTPUT_FILE} not found`)
    process.exit(1)
  }

  const widgetsSection = await generateWidgetsSection()
  const updated = readmeContent.includes(WIDGETS_ANCHOR)
    ? `${readmeContent.split(WIDGETS_ANCHOR)[0]}${widgetsSection}`
    : `${readmeContent.trim()}\n\n${widgetsSection}`

  if (process.argv.includes('--check')) {
    if (updated !== readmeContent) {
      console.error('docs/widgets-api-reference.md is out of date with the widget schemas.')
      console.error('Run `npm run update-readme-widgets` and commit the result.')
      process.exit(1)
    }
    console.log('widgets API reference is in step with the schemas')
    return
  }

  await fs.writeFile(OUTPUT_FILE, updated)
  console.log(`✅ Widgets updated in ${OUTPUT_FILE}`)
}

updateReadme().catch((err) => {
  console.error(`❌ Error updating ${OUTPUT_FILE}:`, err)
  process.exit(1)
})
