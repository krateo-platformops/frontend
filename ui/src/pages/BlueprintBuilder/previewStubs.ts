/**
 * The stand-in objects a Preview hands the render service, so a chart's gates open. Pure.
 *
 * WHY. A gate withholds its resource until a `lookup` finds the dependency (gateGen.ts). The render
 * service is client-only, so every lookup finds nothing and everything behind a gate stays out of
 * the preview — a Deployment gated on a ConfigMap previewed as the ConfigMap alone, and its empty
 * `image:` first showed up on the cluster. helm-render-service's `lookupStubs` answers those lookups
 * with objects the request supplies; this builds them from the descriptor, so Preview shows every
 * resource the machine will ever render.
 *
 * ONE STUB PER KIND A GATE WAITS FOR, answering every name: gate names are Helm pipelines
 * (`printf "%s-repo" .Values.name`) the browser cannot evaluate. Each stub is shaped to SATISFY the
 * target's readiness — its `readyWhen`, else its class default — through the same grammar the gate
 * compiled from (readyWhen.ts), so a stub opens exactly the guard the cluster would. A stub is still
 * an object, not a bypass: a guard this code does not know how to satisfy stays shut, and the
 * service's `lookups` report says which one.
 *
 * STAND-INS, AND SAID TO BE. The Source tab lists which lookups were stood in for
 * (`standInSummary`); nothing is read from or written to the cluster.
 */
import { ARCHITECTURE_TEMPLATE_PATH, parseArchitecture, unwrapFromConfigMapTemplate, type ResourceNode } from './architecture'
import { nativeKindOf, type NativeReadiness } from './nativeKinds'
import { parseReadyWhen } from './readyWhen'

/** helm-render-service's LookupStub. */
export interface LookupStub {
  apiVersion: string
  kind: string
  object: Record<string, unknown>
}

/** One lookup the render made, as the service reports it. */
export interface LookupCall {
  apiVersion: string
  kind: string
  namespace: string
  name: string
  stubbed: boolean
}

/** A documentation address (RFC 5737): a value no reader mistakes for a real endpoint. */
const STAND_IN_IP = '192.0.2.1'
/** What a field readiness is set to: any non-empty string is Helm-truthy. */
const STAND_IN_VALUE = 'preview'

type Json = Record<string, unknown>

const isRecord = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value)

/** Merge two stand-ins of one kind: objects deeply, lists by concatenation (two condition types). */
const merge = (left: Json, right: Json): Json => {
  const out: Json = { ...left }
  for (const [key, value] of Object.entries(right)) {
    const current = out[key]
    if (isRecord(current) && isRecord(value)) {
      out[key] = merge(current, value)
    } else if (Array.isArray(current) && Array.isArray(value)) {
      out[key] = [...(current as unknown[]), ...(value as unknown[])]
    } else {
      out[key] = value
    }
  }
  return out
}

const conditions = (...types: string[]): Json => ({ status: { conditions: types.map((type) => ({ status: 'True', type })) } })

const setPath = (path: readonly string[], value: unknown): Json =>
  path.reduceRight<unknown>((inner, key) => ({ [key]: inner }), value) as Json

/** What a native kind's kstatus readiness needs its object to carry. */
const nativeObject = (readiness: NativeReadiness): Json => {
  switch (readiness) {
    case 'available': return conditions('Available')
    case 'complete': return conditions('Complete')
    case 'readyReplicas': return { spec: { replicas: 1 }, status: { readyReplicas: 1 } }
    case 'lbAddress': return { status: { loadBalancer: { ingress: [{ ip: STAND_IN_IP }] } } }
    case 'bound': return { status: { phase: 'Bound' } }
    default: return {}
  }
}

/** The object that makes `target` read as ready to its gate — or merely present, for an existence edge. */
const readyObject = (target: ResourceNode): Json => {
  if (target.readyWhen) {
    const parsed = parseReadyWhen(target.readyWhen)
    if (!parsed.ok) { return {} }
    return parsed.form.kind === 'field' ? setPath(parsed.form.path, STAND_IN_VALUE) : conditions(parsed.form.type)
  }
  if (target.class === 'composition') { return conditions('Ready', 'Synced') }
  const native = target.class === 'native' ? nativeKindOf(target.apiVersion, target.kind) : null
  return native ? nativeObject(native.readiness) : {}
}

/** A Service is ready by its Endpoints, which the gate looks up beside it (readyWhen.ts `endpoints`). */
const ENDPOINTS_STUB: LookupStub = {
  apiVersion: 'v1',
  kind: 'Endpoints',
  object: { subsets: [{ addresses: [{ ip: STAND_IN_IP }] }] },
}

/**
 * The stubs for a chart tree: one per kind any edge depends on. Empty when the tree carries no
 * descriptor, the descriptor does not parse (the lint reports that), or nothing depends on anything.
 */
export const previewLookupStubs = (files: Readonly<Record<string, string>>): LookupStub[] => {
  const template = files[ARCHITECTURE_TEMPLATE_PATH]
  const descriptor = template === undefined ? null : unwrapFromConfigMapTemplate(template)
  if (descriptor === null) { return [] }
  const parsed = parseArchitecture(descriptor)
  if (!parsed.ok) { return [] }
  const { resources } = parsed.architecture
  const byKind = new Map<string, LookupStub>()
  const add = (stub: LookupStub) => {
    const key = `${stub.apiVersion}\u0000${stub.kind}`
    const existing = byKind.get(key)
    byKind.set(key, existing ? { ...existing, object: merge(existing.object, stub.object) } : stub)
  }
  for (const node of resources) {
    for (const dep of node.dependsOn ?? []) {
      const target = resources.find((candidate) => candidate.id === dep.ref)
      if (!target) { continue }
      add({ apiVersion: target.apiVersion, kind: target.kind, object: dep.ready ? readyObject(target) : {} })
      if (dep.ready && !target.readyWhen && target.class === 'native' && nativeKindOf(target.apiVersion, target.kind)?.readiness === 'endpoints') {
        add(ENDPOINTS_STUB)
      }
    }
  }
  return [...byKind.values()]
}

const describe = (call: LookupCall): string => (call.name ? `${call.kind} ${call.name}` : `every ${call.kind}`)

/**
 * The lookups a render made, in the person's words, for the Source tab: which dependencies the
 * preview stood in for, and which gate lookups nothing answered — what those guard did not render.
 * Empty when the render made no lookups (or the service predates the report).
 */
export const standInSummary = (lookups: readonly LookupCall[] | undefined): string[] => {
  if (!lookups?.length) { return [] }
  const stood = lookups.filter((call) => call.stubbed)
  const unanswered = lookups.filter((call) => !call.stubbed)
  return [
    ...(stood.length
      ? [`Gates opened for this preview: the render stood in for ${stood.map(describe).join(', ')}, so what waits on them is shown. Stand-ins only — nothing was read from or applied to the cluster.`]
      : []),
    ...(unanswered.length
      ? [`Still gated: nothing stood in for ${unanswered.map(describe).join(', ')}, so what waits on them is not shown.`]
      : []),
  ]
}
