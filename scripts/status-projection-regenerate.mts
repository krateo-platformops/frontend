/**
 * RE-EMIT A PUBLISHED BLUEPRINT'S STATUS FILTER, WITHOUT RE-PUBLISHING IT (#483).
 *
 * The composer emits a `<chart>-status` RESTAction that inlines the generator's jq, and applies it
 * as a standalone CR — no Helm release, no ownerReferences. Nothing upgrades it. Fixing the
 * generator fixes blueprints published from that moment on; everything already published keeps the
 * filter it was born with. `status-projection-drift.mts` says WHICH ones. This one repairs them.
 *
 * The copy cannot simply be deleted. snowplow's RESTAction carries `spec.filter` as a literal
 * string and offers no indirection, and the stages cannot be discovered at request time either —
 * a `dependsOn` makes core-provider's read-set unresolvable and the composition gets no RBAC at
 * all. So the computation is inlined by necessity, once per chart. What it can have is an upgrade
 * path, and it has one because the object carries its own compile inputs: the chart name, the kinds
 * each stage lists, and the node ids the fold maps them to. `regenerateProjection` reads those back
 * and recompiles with the current generator.
 *
 * SAFE BY CONSTRUCTION, in the one way that matters: the stage PATHS are recovered from the live
 * object, so they come back identical, and core-provider derives the composition's RBAC read-set
 * from exactly those. A regeneration that cannot move a path cannot widen or break a grant. It
 * rewrites `spec` and the provenance annotations of this RESTAction, and nothing else — the
 * CompositionDefinition's apiRef and statusDataTemplate are not touched, and no chart is re-rendered.
 *
 *   npx tsx scripts/status-projection-regenerate.mts --kubeconfig PATH --context CTX [--namespace NS]
 *   npx tsx scripts/status-projection-regenerate.mts --kubeconfig PATH --context CTX --apply
 *
 * `--server-dry-run` sends the real patch with `--dry-run=server`: the apiserver validates it and
 * writes nothing, which is how to exercise this end to end against a cluster you are not ready to
 * change. Dry run unless --apply. Exit 0 when nothing needed changing (or the dry run completed), 1 when a
 * copy is stale and was not applied, 2 when it could not look, 3 when an apply failed.
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { regenerateProjection, type LiveProjection } from '../ui/src/pages/BlueprintComposer/projectionCompile'

const arg = (name: string, fallback = ''): string => {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback
}
const serverDryRun = process.argv.includes('--server-dry-run')
const apply = process.argv.includes('--apply') || serverDryRun

const kubectl = (...args: string[]): string => {
  const base: string[] = []
  if (arg('kubeconfig')) { base.push('--kubeconfig', arg('kubeconfig')) }
  if (arg('context')) { base.push('--context', arg('context')) }
  return execFileSync('kubectl', [...base, ...args], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
}

const GENERATED_FROM = 'krateo.io/generated-from'

const main = (): number => {
  // A write goes to whatever cluster the ambient context happens to name, which is the one mistake
  // worth making impossible. Reading is allowed to be casual; patching is not.
  if (apply && !(arg('kubeconfig') && arg('context'))) {
    console.error('--apply requires an explicit --kubeconfig and --context: a patch must never land on an ambient cluster')
    return 2
  }
  const ns = arg('namespace', 'krateo-system')
  let list: { items: LiveProjection[] }
  try {
    list = JSON.parse(kubectl('get', 'restactions.templates.krateo.io', '-n', ns, '-o', 'json')) as { items: LiveProjection[] }
  } catch (err) {
    console.error(`cannot list RESTActions in ${ns}: ${(err as Error).message.split('\n')[0]}`)
    return 2
  }

  // Identified by what it IS, not by its name — the generator stamps every copy with this.
  const copies = list.items.filter((ra) => ra.metadata?.annotations?.[GENERATED_FROM] === 'templates/architecture.yaml')
  if (!copies.length) {
    console.log(`no composer-emitted status projections in ${ns} — nothing to regenerate`)
    return 0
  }

  let pending = 0
  let failed = 0
  for (const ra of copies) {
    const name = ra.metadata?.name ?? '<unnamed>'
    const out = regenerateProjection(ra)
    if (!out.ok) {
      console.log(`SKIP    ${name}  ${out.reason}`)
      failed += 1
      continue
    }
    if (!out.changed.length) {
      console.log(`CURRENT ${name}`)
      continue
    }
    console.log(`${apply ? (serverDryRun ? 'CHECK  ' : 'PATCH  ') : 'STALE  '} ${name}  would change: ${out.changed.join(', ')}`)
    if (!apply) { pending += 1; continue }

    const next = out.restaction as { metadata: { annotations: Record<string, string> }; spec: unknown }
    // A JSON merge patch: `spec` holds only api and filter, and merge-patch replaces both wholesale.
    // Written to a file because the filter is kilobytes of jq — never through a shell argument.
    const patch = JSON.stringify({ metadata: { annotations: next.metadata.annotations }, spec: next.spec })
    const file = join(mkdtempSync(join(tmpdir(), 'krateo-projection-')), `${name}.json`)
    writeFileSync(file, patch)
    try {
      const dry = serverDryRun ? ['--dry-run=server'] : []
      kubectl('patch', 'restactions.templates.krateo.io', name, '-n', ra.metadata?.namespace ?? ns, '--type=merge', '--patch-file', file, ...dry)
      console.log(`        ${name} ${serverDryRun ? 'accepted by the apiserver (nothing written)' : 'patched'}`)
    } catch (err) {
      console.error(`        ${name} FAILED: ${(err as Error).message.split('\n')[0]}`)
      failed += 1
    }
  }

  if (failed) { return 3 }
  if (pending) {
    console.log(`\n${pending} stale. Re-run with --apply to re-emit the filter in place.`)
    console.log('Nothing else changes: same stages, same paths, same RBAC read-set, same CompositionDefinition.')
    console.log('See krateo-platformops/frontend#483.')
    return 1
  }
  return 0
}

process.exit(main())
