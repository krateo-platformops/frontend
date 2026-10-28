/**
 * WHICH PUBLISHED BLUEPRINTS ARE RUNNING A STALE COPY OF THE GENERATOR'S JQ? (#483)
 *
 * The composer emits a `<chart>-status` RESTAction whose `spec.filter` embeds S11_TOP_FILTER
 * VERBATIM, and applies it as a standalone CR — no Helm release, no ownerReferences. Nothing
 * upgrades it. Fixing the generator fixes blueprints published from that moment on; every blueprint
 * already published keeps running the filter it was born with, for as long as it exists.
 *
 * That is not hypothetical. #482 fixed the condition form of `readyWhen`; portal 1.8.69 and frontend
 * 1.8.1 both shipped it and were verified live on krateo-057 — while `event-site`, published
 * 2026-10-06, went on reporting architectureLevel 0 for resources that were in fact Ready, because
 * its frozen copy still read only the field form. It was found by noticing a status field that had
 * not moved, which is a bad detector: silent, indirect, and one hop from the cause.
 *
 * This is the direct detector, and it works RETROACTIVELY — it needs no annotation on the object, so
 * it reports blueprints published long before provenance stamping existed.
 *
 *   npx tsx scripts/status-projection-drift.mts [--kubeconfig PATH] [--context CTX] [--namespace NS]
 *
 * Exit 0 when every copy is current, 1 when any has drifted, 2 when it could not look.
 */
import { execFileSync } from 'node:child_process'

import { S11_TOP_FILTER } from '../ui/src/pages/BlueprintBuilder/architectureStateJq'

const arg = (name: string, fallback = ''): string => {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback
}

const kubectl = (...args: string[]): string => {
  const base: string[] = []
  if (arg('kubeconfig')) { base.push('--kubeconfig', arg('kubeconfig')) }
  if (arg('context')) { base.push('--context', arg('context')) }
  return execFileSync('kubectl', [...base, ...args], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
}

interface Ra {
  metadata: { name: string; namespace: string; creationTimestamp: string; annotations?: Record<string, string> }
  spec: { filter?: string }
}

const main = (): number => {
  const ns = arg('namespace', 'krateo-system')
  let list: { items: Ra[] }
  try {
    list = JSON.parse(kubectl('get', 'restactions.templates.krateo.io', '-n', ns, '-o', 'json')) as { items: Ra[] }
  } catch (err) {
    console.error(`cannot list RESTActions in ${ns}: ${(err as Error).message.split('\n')[0]}`)
    return 2
  }

  // A projection copy is identified by what it IS, not by its name: the generator stamps every one
  // with `krateo.io/generated-from: templates/architecture.yaml`. Matching on a `-status` suffix
  // would both miss renamed charts and catch unrelated RESTActions that happen to end that way.
  const copies = list.items.filter((ra) => ra.metadata.annotations?.['krateo.io/generated-from'] === 'templates/architecture.yaml')
  if (!copies.length) {
    console.log(`no composer-emitted status projections in ${ns} — nothing to check`)
    return 0
  }

  const stale: string[] = []
  for (const ra of copies) {
    // The emitted filter is `( fold )\n| (\n S11_TOP_FILTER \n)\n`, so the current generator's text
    // must appear inside it verbatim. Comparing whole filters would false-positive on the fold,
    // which legitimately differs per chart (one LIST per distinct kind).
    const current = (ra.spec.filter ?? '').includes(S11_TOP_FILTER)
    const by = ra.metadata.annotations?.['krateo.io/generated-by'] ?? 'unstamped (predates #483)'
    const mark = current ? 'CURRENT' : 'STALE  '
    console.log(`${mark} ${ra.metadata.name}  generated-by=${by}  created=${ra.metadata.creationTimestamp}`)
    if (!current) { stale.push(ra.metadata.name) }
  }

  console.log(`\n${copies.length - stale.length} of ${copies.length} current.`)
  if (stale.length) {
    console.log(`\nSTALE: ${stale.join(', ')}`)
    console.log('These run a filter their generator has since fixed. No chart upgrade reaches them —')
    console.log('they are standalone CRs with no Helm release and no ownerReferences. Re-publishing the')
    console.log('blueprint through a composer running the current generator re-emits the filter.')
    console.log('See krateo-platformops/frontend#483.')
  }
  return stale.length ? 1 : 0
}

process.exit(main())
