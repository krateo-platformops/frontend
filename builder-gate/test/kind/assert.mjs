// The gate's CLI against a REAL API server, as the chart's own ServiceAccount (run.sh).
//   node assert.mjs <kubeconfig>
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
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
  console.log(`${condition ? 'ok  ' : 'FAIL'} ${name}`)
  if (!condition) {
    failures += 1
    console.log(JSON.stringify(envelope, null, 2))
  }
}
const stepOf = (envelope, name) => envelope.steps.find((s) => s.name === name)

const example = JSON.parse(readFileSync(join(gate, 'examples', 'pod-sizing-page.json'), 'utf8'))
const e = runGate('portal-builder', example)
check('its own Builder is read live, as its ServiceAccount', stepOf(e, 'builder')?.ok === true && /Builder portal-builder \(krateo-system\)/.test(stepOf(e, 'builder').notes[0]), e)
check('the static steps ran and passed', ['builder-lint', 'references', 'jq-compile'].every((n) => stepOf(e, n)?.ok === true), e)
check('no caller token: live-dry-run judged nothing, and that is RED',
  e.ok === false && e.failedStep === 'live-dry-run' && /^notChecked: no caller token reached the gate/.test(stepOf(e, 'live-dry-run').problems[0]) && e.coverage?.notChecked === 4, e)

const other = runGate('blueprint-builder', example)
check('another Builder is Forbidden to it — red at builder',
  other.failedStep === 'builder' && /answered 403/.test(stepOf(other, 'builder').problems[0]), other)

if (failures > 0) {
  console.error(`${failures} check(s) failed`)
  process.exit(1)
}
