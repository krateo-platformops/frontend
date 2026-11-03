/* eslint-disable no-console */
import { execSync } from 'node:child_process'
import { join } from 'node:path'

import chalk from 'chalk'
import { glob } from 'glob'

const CRD_DIR = join(process.cwd(), 'scripts', 'krateoctl-output')

function applyYamlFile(path: string): boolean {
  const file = path.split('/').pop()
  try {
    console.log(`Applying CRD ${file}...`)
    execSync(`kubectl apply -f "${path}"`, { stdio: 'inherit' })
    console.log(`✅ Successfully applied ${file}`)
    return true
  } catch (err) {
    console.error(`❌ Failed to apply ${file}:`, err)
    return false
  }
}

async function main() {
  console.log(chalk.blue('\n🚀 Applying Generated CRDs...'))

  const yamlFiles = await glob('**/*.yaml', {
    absolute: true,
    cwd: CRD_DIR,
  })

  if (yamlFiles.length === 0) {
    // Fail rather than report success. Finding nothing used to print "No CRDs to apply" and return
    // 0, so the three ways this goes wrong — generate-crds never run, run from the repo root
    // instead of ui/ (CRD_DIR is cwd-relative), or run after a failed generation — were all
    // indistinguishable from a clean apply. Then the next step that needs those CRDs on the
    // cluster fails somewhere else entirely, with the widget's fields pruned and nothing saying
    // why.
    console.error(chalk.red(`No CRDs found in ${CRD_DIR}`))
    console.error(chalk.red("Run 'npm run generate-crds' from ui/ first."))
    process.exit(1)
  }

  let ok = 0
  let fail = 0

  for (const file of yamlFiles) {
    if (applyYamlFile(file)) {
      ok += 1
    } else {
      fail += 1
    }
  }

  console.log(chalk.bold('\n📊 CRD Summary:'))
  console.log(`✔️  Applied: ${ok}`)
  console.log(`❌ Failed: ${fail}`)

  if (fail > 0) { process.exit(1) }
}

void main()
