/**
 * THE AGENT VALIDATES AGAINST THE CLUSTER. THE PORTAL VALIDATES AGAINST ITSELF. They must agree.
 *
 * A widget CR is checked twice before it can render. The authoring agent runs `validate_manifest`
 * against the LIVE cluster's published OpenAPI schema — the CRD — and the portal then re-checks it
 * with ajv against the co-located `src/widgets/<Kind>/<Kind>.schema.json`, which is `additionalProperties:
 * false`. Two schemas, two sources of truth, and nothing kept them in step.
 *
 * WHAT THAT COST, measured. `allowedResources` is declared by six container CRDs and was absent
 * from all six co-located schemas. A Kubernetes structural schema PRUNES an unknown field; ajv with
 * a closed object REJECTS it. So an agent could author a Card that the cluster accepts and
 * validate_manifest passes — and the portal answered
 *
 *   Validation failed — nothing was applied to the sandbox.
 *   Card/page-x-row-card: /spec/widgetData must NOT have additional properties
 *
 * which reads as "the agent wrote something wrong" and is not. It was the portal's own schema that
 * was out of date, and the live preview silently dropped to source-only every time.
 *
 * This gate is the cheap half of the fix: the CRDs ship from this repository, so the divergence is
 * a build-time fact and belongs in CI rather than in a demo.
 */
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

import { glob } from 'glob'
import yaml from 'js-yaml'
import { describe, expect, it } from 'vitest'

const REPO = join(__dirname, '..', '..', '..', '..')

interface Schema { properties?: Record<string, unknown>; additionalProperties?: unknown }

const widgetDataOf = (root: unknown): Schema | null => {
  const spec = (root as { properties?: { spec?: { properties?: { widgetData?: Schema } } } })?.properties?.spec
  return spec?.properties?.widgetData ?? null
}

describe('the portal schema agrees with the CRD it ships', () => {
  it('rejects NOTHING the CRD allows', async () => {
    const crds = (await glob(join(REPO, 'helm', 'frontend-crds', 'templates', '*.crd.yaml'))).sort()
    expect(crds.length).toBeGreaterThan(40)

    const offenders: string[] = []
    for (const file of crds) {
      const doc = yaml.load(readFileSync(file, 'utf8')) as {
        spec?: { names?: { kind?: string }; versions?: { schema?: { openAPIV3Schema?: unknown } }[] }
      }
      const kind = doc.spec?.names?.kind
      const versions = doc.spec?.versions ?? []
      const fromCrd = widgetDataOf(versions[versions.length - 1]?.schema?.openAPIV3Schema)
      if (!kind || !fromCrd) {
        continue
      }
      const path = join(REPO, 'ui', 'src', 'widgets', kind, `${kind}.schema.json`)
      if (!existsSync(path)) {
        continue
      }
      const fromUi = widgetDataOf(JSON.parse(readFileSync(path, 'utf8')))
      // Only a CLOSED object can reject an extra field; an open one prunes like the apiserver does.
      if (!fromUi || fromUi.additionalProperties !== false) {
        continue
      }
      for (const property of Object.keys(fromCrd.properties ?? {})) {
        if (!(property in (fromUi.properties ?? {}))) {
          offenders.push(`${kind}.schema.json is missing widgetData.${property}, which ${kind.toLowerCase()}.crd.yaml declares`)
        }
      }
    }
    expect(offenders).toEqual([])
  })
})
