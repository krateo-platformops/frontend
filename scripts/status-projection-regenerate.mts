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
 * It stamps the objects it repairs with the version of the generator that repaired them, so it has
 * to know its own: `--as-version`, or the checkout's nearest tag. It will NOT write
 * `frontend-unknown` — an annotation that looks like an answer and is not is worse than none, and
 * `__APP_VERSION__` is a Vite compile-time constant that does not exist under tsx.
 *
 *   npx tsx scripts/status-projection-regenerate.mts --kubeconfig PATH --context CTX [--namespace NS]
 *   npx tsx scripts/status-projection-regenerate.mts --kubeconfig PATH --context CTX --apply
 *
 * `--server-dry-run` sends the real patch with `--dry-run=server`: the apiserver validates it and
 * writes nothing, which is how to exercise this end to end against a cluster you are not ready to
 * change. Dry run unless --apply. Exit 0 when nothing needed changing (or the dry run completed), 1 when a
 * copy is stale and was not applied, 2 when it could not look, 3 when an apply failed.
 *
 * `main` takes its argv and its two outside-the-process effects as arguments so the refusals above
 * can be tested without a cluster and without a tagged checkout — see
 * `ui/src/pages/BlueprintComposer/statusProjectionRegenerate.test.ts`. The process only exits when
 * this file is the entry point.
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

import { regenerateProjection, type LiveProjection } from '../ui/src/pages/BlueprintComposer/projectionCompile'

const arg = (argv: string[], name: string, fallback = ''): string => {
  const i = argv.indexOf(`--${name}`)
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback
}

const GENERATED_FROM = 'krateo.io/generated-from'

/**
 * The checkout's nearest tag. Null in an untagged or shallow checkout — the normal CI state, and
 * the whole reason `--as-version` exists.
 */
const describeNearestTag = (): string | null => {
  try {
    return execFileSync('git', ['describe', '--tags', '--abbrev=0'], { cwd: new URL('..', import.meta.url).pathname, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() || null
  } catch {
    return null
  }
}

const runKubectl = (args: string[]): string =>
  execFileSync('kubectl', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })

/** The two things this run does outside its own process. A test substitutes both. */
export type Effects = {
  describeNearestTag?: () => string | null
  kubectl?: (args: string[]) => string
}

export const main = (argv: string[] = process.argv, effects: Effects = {}): number => {
  const describe = effects.describeNearestTag ?? describeNearestTag
  const run = effects.kubectl ?? runKubectl

  const serverDryRun = argv.includes('--server-dry-run')
  const apply = argv.includes('--apply') || serverDryRun
  const kubeconfig = arg(argv, 'kubeconfig')
  const context = arg(argv, 'context')

  const base: string[] = []
  if (kubeconfig) { base.push('--kubeconfig', kubeconfig) }
  if (context) { base.push('--context', context) }
  const kubectl = (...args: string[]): string => run([...base, ...args])

  // A write goes to whatever cluster the ambient context happens to name, which is the one mistake
  // worth making impossible. Reading is allowed to be casual; patching is not.
  if (apply && !(kubeconfig && context)) {
    console.error('--apply requires an explicit --kubeconfig and --context: a patch must never land on an ambient cluster')
    return 2
  }
  // Which generator is doing the repairing: `--as-version`, else the checkout's nearest tag.
  const version = arg(argv, 'as-version') || describe() || null
  if (apply && !version) {
    console.error('cannot tell which generator version this is: pass --as-version, or run from a checkout with a release tag')
    return 2
  }
  const ns = arg(argv, 'namespace', 'krateo-system')
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
    const out = regenerateProjection(ra, version ? { generatedBy: `frontend-${version}` } : undefined)
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

// Importing this module must not exit the importer — the test does exactly that.
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  process.exit(main())
}
