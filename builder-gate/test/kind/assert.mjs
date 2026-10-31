// The gate's CLI against a REAL API server, as the chart's own ServiceAccount (run.sh).
//   node assert.mjs <kubeconfig>
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const gate = join(here, '..', '..')
const [kubeconfig] = process.argv.slice(2)
const work = mkdtempSync(join(tmpdir(), 'gate-kind-'))
let failures = 0

const runGate = (builder, draft) => {
  const file = join(work, 'draft.json')
  writeFileSync(file, JSON.stringify(draft))
  // SNOWPLOW_URL set, but no caller token: exactly what a call without KAGENT_PROPAGATE_TOKEN gets.
  const out = spawnSync(process.execPath, [join(gate, 'dist', 'cli.cjs'), '--builder', builder, '--draft', file, '--kubeconfig', kubeconfig],
    { encoding: 'utf8', env: { ...process.env, SNOWPLOW_URL: 'http://127.0.0.1:9' } })
  if (out.status === 2) {
    throw new Error(`the gate crashed: ${out.stderr}`)
  }
  return JSON.parse(out.stdout)
}

const check = (name, condition, envelope) => {
  process.stdout.write(`${condition ? 'ok  ' : 'FAIL'} ${name}\n`)
  if (!condition) {
    failures += 1
    process.stdout.write(`${JSON.stringify(envelope, null, 2)}\n`)
  }
}
const stepOf = (envelope, name) => envelope.steps.find((step) => step.name === name)

const example = JSON.parse(readFileSync(join(gate, 'examples', 'pod-sizing-page.json'), 'utf8'))
const result = runGate('portal-builder', example)
check('its own Builder is read live, as its ServiceAccount', stepOf(result, 'builder')?.ok === true && /Builder portal-builder \(krateo-system\)/.test(stepOf(result, 'builder').notes[0]), result)
check('the static steps ran and passed', ['builder-lint', 'references', 'jq-compile'].every((name) => stepOf(result, name)?.ok === true), result)
check('no caller token: live-dry-run judged nothing, and that is RED',
  result.ok === false && result.failedStep === 'live-dry-run' && /^notChecked: no caller token reached the gate/.test(stepOf(result, 'live-dry-run').problems[0]) && result.coverage?.notChecked === 4, result)

const other = runGate('blueprint-builder', example)
check('another Builder is Forbidden to it — red at builder',
  other.failedStep === 'builder' && /answered 403/.test(stepOf(other, 'builder').problems[0]), other)

if (failures > 0) {
  console.error(`${failures} check(s) failed`)
  process.exit(1)
}
