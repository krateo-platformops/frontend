// Collect the co-located widget schemas (ui/src/widgets/<Dir>/<Kind>.schema.json) into one JSON
// map keyed by file basename — the key previewSandbox.ts's import.meta.glob uses — so the gate
// lints with exactly the schemas this release of the portal lints with.
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const widgets = join(here, '..', '..', 'ui', 'src', 'widgets')
const out = join(here, '..', 'generated', 'widget-schemas.json')

const schemas = {}
for (const dir of readdirSync(widgets, { withFileTypes: true }).filter((d) => d.isDirectory())) {
  for (const file of readdirSync(join(widgets, dir.name)).filter((f) => f.endsWith('.schema.json'))) {
    schemas[file.replace(/\.schema\.json$/, '')] = JSON.parse(readFileSync(join(widgets, dir.name, file), 'utf8'))
  }
}
mkdirSync(dirname(out), { recursive: true })
writeFileSync(out, JSON.stringify(schemas))
console.log(`${Object.keys(schemas).length} widget schemas → ${out}`)
