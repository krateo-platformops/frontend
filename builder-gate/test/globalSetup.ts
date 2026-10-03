// Before any test: the bundle (build.mjs also writes the widget-schema map the catalog imports;
// mcp.test.ts runs the bundled server), and the jqcheck binary (snowplow's gojq fork) the jq steps
// shell out to — unless CI already built one and named it in JQCHECK_BIN.
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'

export default function setup(): void {
  const root = join(__dirname, '..')
  execFileSync(process.execPath, [join(root, 'build.mjs')], { stdio: 'inherit' })
  if (!process.env.JQCHECK_BIN) {
    execFileSync('go', ['build', '-o', join(root, 'bin', 'jqcheck'), '.'], { cwd: join(root, 'jqcheck'), stdio: 'inherit' })
  }
}
