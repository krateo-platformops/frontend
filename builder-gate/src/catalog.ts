/**
 * What the page lint needs from its host (pageLint.ts PageLintDeps), from THIS repository at THIS
 * tag — never fetched, never pinned to another release:
 *   - schemaFor: the co-located widget schemas, ui/src/widgets/<Dir>/<Kind>.schema.json, keyed by
 *     file basename exactly as previewSandbox.ts's glob keys them. build.mjs (and the test setup)
 *     collects them into generated/widget-schemas.json.
 *   - pluralOf: the CRD plural of each kind, from widgetKinds.generated.ts, which
 *     scripts/gen-widget-kinds.ts derives from helm/frontend-crds and CI re-checks. The portal asks
 *     snowplow's discovery for the same answer; the CRDs it would discover ship from this chart.
 */
import { WIDGET_KINDS } from '@frontend/pages/PageComposer/widgetKinds.generated'

import schemas from '../generated/widget-schemas.json'

const SCHEMAS = schemas as Record<string, Record<string, unknown>>

export const schemaFor = (kind: string): Record<string, unknown> | null => SCHEMAS[kind] ?? null

export const pluralOf = (kind: string): string | null => WIDGET_KINDS[kind]?.plural ?? null

/** Widget kinds this catalog knows, for the envelope's notes. */
export const widgetKindCount = (): number => Object.keys(WIDGET_KINDS).length
