// The drift checks import src/, whose catalog reads generated/widget-schemas.json: build.mjs writes it.
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'

export default function setup(): void {
  execFileSync(process.execPath, [join(__dirname, '..', '..', 'build.mjs')], { stdio: 'inherit' })
}
