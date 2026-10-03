// The live dry-run against a REAL API server (CI's kind job, run.sh): the gate's CLI, as the
// chart's own ServiceAccount (a kubeconfig holding its token), judging real drafts.
//
//   node assert.mjs granted <kubeconfig>    the chart's Role is in place
//   node assert.mjs forbidden <kubeconfig>  the dry-run Role has been deleted
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const gate = join(here, '..', '..')
const [phase, kubeconfig] = process.argv.slice(2)
const work = mkdtempSync(join(tmpdir(), 'gate-kind-'))
let failures = 0

const example = () => JSON.parse(readFileSync(join(gate, 'examples', 'pod-sizing-page.json'), 'utf8'))
const ra = (draft) => draft.find((cr) => cr.kind === 'RESTAction')

const runGate = (name, draft) => {
  const file = join(work, `${name}.json`)
  writeFileSync(file, JSON.stringify(draft))
  const out = spawnSync(process.execPath, [join(gate, 'dist', 'cli.cjs'), '--builder', 'portal-builder', '--draft', file, '--kubeconfig', kubeconfig], { encoding: 'utf8' })
  if (out.status === 2) {
    throw new Error(`${name}: the gate crashed: ${out.stderr}`)
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
const verdictOf = (envelope, resource) => envelope.coverage?.verdicts.find((v) => v.resource === resource)

if (phase === 'granted') {
  // The example: every object accepted by the real API server as the chart's ServiceAccount; the
  // Builder read live; an existing widget resolved by the read-only ClusterRole. No caller token
  // reaches a CLI run, so the data step is notChecked — and red.
  const draft = example()
  draft[0].spec.resourcesRefs.items[0].name = 'existing-pie'
  draft[0].spec.resourcesRefs.items[0].namespace = 'krateo-system'
  const e = runGate('example', draft)
  check('example: builder read live, lint, references, jq-compile and live-dry-run all ran and passed',
    ['builder', 'builder-lint', 'references', 'jq-compile', 'live-dry-run'].every((n) => stepOf(e, n)?.ok === true), e)
  check('example: an existing widget resolved through the read-only ClusterRole',
    stepOf(e, 'references')?.notes[0] === '1 reference(s) resolve to objects that already exist in the cluster; the rest are in the draft', e)
  check('example: the API server accepted all 4 objects', e.coverage?.summary === 'API server accepted all 4 objects', e)
  check('example: no caller token → data is notChecked and red',
    e.ok === false && e.failedStep === 'data' && /^notChecked: no caller token/.test(stepOf(e, 'data').problems[0]), e)

  // The RESTAction CRD's four userAccessFilter CEL rules: only the API server evaluates them.
  const cel = [
    ['resource and resourcesFrom both set', (api) => { api.userAccessFilter = { verb: 'get', group: '', resource: 'pods', resourcesFrom: '["pods"]' } }, /exactly one of resource or resourcesFrom must be set/],
    ['userAccessFilter on a POST stage', (api) => { api.verb = 'POST'; api.userAccessFilter = { verb: 'get', group: '', resource: 'pods' } }, /userAccessFilter is only allowed on read-verb HTTP stages/],
    ['userAccessFilter with exportJwt', (api) => { api.exportJwt = true; api.userAccessFilter = { verb: 'get', group: '', resource: 'pods' } }, /userAccessFilter stages MUST NOT have exportJwt: true/],
    ['userAccessFilter with an empty verb', (api) => { api.userAccessFilter = { verb: '', group: '', resource: 'pods' } }, /userAccessFilter must specify a non-empty verb/],
  ]
  for (const [name, mutate, message] of cel) {
    const d = example()
    mutate(ra(d).spec.api[0])
    const env = runGate(`cel-${name.replace(/\W+/g, '-')}`, d)
    const v = verdictOf(env, 'restactions/pod-sizing')
    check(`CEL: ${name} → rejected by the API server with the rule's message`,
      env.failedStep === 'live-dry-run' && v?.verdict === 'rejected' && message.test(v.detail) && env.coverage.validated === 3, env)
  }

  // An unknown field: refused under fieldValidation=Strict (without Strict it would be pruned silently).
  const unknown = example()
  ra(unknown).spec.api[0].bogusField = 'x'
  const u = runGate('unknown-field', unknown)
  const uv = verdictOf(u, 'restactions/pod-sizing')
  check('Strict: an unknown field is rejected, not pruned',
    u.failedStep === 'live-dry-run' && uv?.verdict === 'rejected' && /unknown field/.test(uv.detail), u)
} else if (phase === 'forbidden') {
  const e = runGate('forbidden', example())
  check('Forbidden: every object is notChecked',
    e.coverage?.notChecked === 4 && e.coverage.verdicts.every((v) => v.verdict === 'notChecked' && /^Forbidden/.test(v.detail)), e)
  check('Forbidden: notChecked is RED — the envelope fails at live-dry-run',
    e.ok === false && e.failedStep === 'live-dry-run' && stepOf(e, 'live-dry-run').ok === false, e)
} else {
  throw new Error(`unknown phase ${phase}`)
}

if (failures > 0) {
  console.error(`${failures} check(s) failed`)
  process.exit(1)
}
