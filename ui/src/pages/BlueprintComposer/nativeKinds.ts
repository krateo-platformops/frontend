/**
 * The Kubernetes-native kinds the palette places — a fixed table, because they do not change per
 * cluster. Pure.
 *
 * NO CLUSTER READ AT ALL. The custom-resource and composition classes are discovered, under the
 * person's own credential; these nine are what every cluster has, so reading them would only add a
 * way for the one class that always works to fail.
 *
 * READINESS IS THE KIND'S OWN. kstatus already says what "ready" means for each of them — a
 * Deployment is available, a Job completes, a Service has endpoints — so a native node needs nothing
 * configured. The tag is what the gate compiles (S4b); `label` is how the palette and the inspector
 * say it, in the mockup's words (04:44-52). A kind with nothing to wait on but its own existence says
 * `exists`, rather than claiming a condition it does not have.
 */

export type NativeReadiness = 'available' | 'readyReplicas' | 'endpoints' | 'exists' | 'lbAddress' | 'bound' | 'complete'

export interface NativeKind {
  kind: string
  apiVersion: string
  /** The apiVersion as the palette shows it — `networking/v1`, not `networking.k8s.io/v1`. */
  display: string
  readiness: NativeReadiness
  /** The readiness, in words. */
  label: string
  /** The plural the apiserver serves it as — status projection lists the node's objects by it. */
  plural: string
}

/** In the mockup's order (04:44-52), which is the palette's. */
export const NATIVE_KINDS: readonly NativeKind[] = [
  { apiVersion: 'apps/v1', display: 'apps/v1', kind: 'Deployment', label: 'available', plural: 'deployments', readiness: 'available' },
  { apiVersion: 'apps/v1', display: 'apps/v1', kind: 'StatefulSet', label: 'ready replicas', plural: 'statefulsets', readiness: 'readyReplicas' },
  { apiVersion: 'v1', display: 'v1', kind: 'Service', label: 'has endpoints', plural: 'services', readiness: 'endpoints' },
  { apiVersion: 'v1', display: 'v1', kind: 'ConfigMap', label: 'exists', plural: 'configmaps', readiness: 'exists' },
  { apiVersion: 'v1', display: 'v1', kind: 'Secret', label: 'exists', plural: 'secrets', readiness: 'exists' },
  { apiVersion: 'networking.k8s.io/v1', display: 'networking/v1', kind: 'Ingress', label: 'lb address', plural: 'ingresses', readiness: 'lbAddress' },
  { apiVersion: 'v1', display: 'v1', kind: 'PersistentVolumeClaim', label: 'bound', plural: 'persistentvolumeclaims', readiness: 'bound' },
  { apiVersion: 'batch/v1', display: 'batch/v1', kind: 'Job', label: 'complete', plural: 'jobs', readiness: 'complete' },
  { apiVersion: 'batch/v1', display: 'batch/v1', kind: 'CronJob', label: 'exists', plural: 'cronjobs', readiness: 'exists' },
]

/** The table's entry for a node's apiVersion and kind, or null — a native kind the palette does not place. */
export const nativeKindOf = (apiVersion: string, kind: string): NativeKind | null =>
  NATIVE_KINDS.find((entry) => entry.apiVersion === apiVersion && entry.kind === kind) ?? null
