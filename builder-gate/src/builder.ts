/**
 * The Builder a draft is validated for, read from the cluster (builders.builders.templates.krateo.io
 * in BUILDERS_NAMESPACE, as the gate's ServiceAccount — the same CR the portal's composer reads),
 * or, for the offline CLI only, from a directory of Builder YAML files.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import yaml from 'js-yaml'

import { type KubeClient, safeSegment } from './kube'

export const BUILDERS_API = '/apis/builders.templates.krateo.io/v1alpha1'

export interface BuilderSpec {
  name: string
  namespace: string
  draftKind: string
  previewMode: string | null
  /** The lints the Builder declares, by name. An unknown name is refused, never skipped. */
  lint: string[]
  verbs: string[]
  /** The held-tree cap the Builder declares (files.heldBytes, else start.maxDraftBytes). */
  maxBytes: number | null
}

export type BuilderLookup =
  | { ok: true; builder: BuilderSpec }
  | { ok: false; problem: string }

type Rec = Record<string, unknown>
const rec = (value: unknown): Rec => (value && typeof value === 'object' && !Array.isArray(value) ? value as Rec : {})
const strings = (value: unknown): string[] => (Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [])

export const builderSpecOf = (cr: unknown): BuilderSpec => {
  const metadata = rec(rec(cr).metadata)
  const spec = rec(rec(cr).spec)
  const files = rec(spec.files)
  const start = rec(spec.start)
  const max = typeof files.heldBytes === 'number' ? files.heldBytes : typeof start.maxDraftBytes === 'number' ? start.maxDraftBytes : null
  return {
    name: String(metadata.name ?? ''),
    namespace: String(metadata.namespace ?? ''),
    draftKind: String(spec.draftKind ?? ''),
    previewMode: typeof rec(spec.preview).mode === 'string' ? String(rec(spec.preview).mode) : null,
    lint: strings(spec.lint),
    verbs: strings(rec(spec.verbs).allowed),
    maxBytes: max,
  }
}

const NAME = /^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/

/** The Builder CR, read live. */
export const builderFromCluster = async (kube: KubeClient, namespace: string, name: string): Promise<BuilderLookup> => {
  if (!NAME.test(name)) {
    return { ok: false, problem: `builder ${JSON.stringify(name)} is not a Builder name` }
  }
  let reply
  try {
    reply = await kube.get(`${BUILDERS_API}/namespaces/${safeSegment(namespace)}/builders/${name}`)
  } catch (error) {
    return { ok: false, problem: `notChecked: the Builder ${namespace}/${name} could not be read (${(error as Error).message})` }
  }
  if (reply.status === 200) {
    return { ok: true, builder: builderSpecOf(reply.json) }
  }
  if (reply.status === 404) {
    return { ok: false, problem: `no Builder ${JSON.stringify(name)} in namespace ${namespace} — name one of the cluster's Builders` }
  }
  return { ok: false, problem: `notChecked: reading the Builder ${namespace}/${name} answered ${reply.status} ${String(rec(reply.json).message ?? '').slice(0, 200)}` }
}

/** Offline only: a directory of Builder YAML files (the repo's fixtures in CI). */
export const builderFromDirectory = (dir: string, name: string): BuilderLookup => {
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.yaml') || f.endsWith('.yml'))) {
    const cr = yaml.load(readFileSync(join(dir, file), 'utf8'))
    if (rec(rec(cr).metadata).name === name && rec(cr).kind === 'Builder') {
      return { ok: true, builder: { ...builderSpecOf(cr), namespace: `(file ${file})` } }
    }
  }
  return { ok: false, problem: `no Builder ${JSON.stringify(name)} in ${dir}` }
}
