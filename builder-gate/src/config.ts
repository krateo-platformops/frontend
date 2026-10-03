/** The gate's configuration, from its environment (the chart sets every variable per instance). */
import { builderFromCluster, type BuilderLookup } from './builder'
import { GATE_TIMEOUT_MS } from './gate'
import type { Transport } from './http'
import { jqcheckEngine } from './jq'
import { inClusterIdentity, KubeClient, kubeconfigIdentity } from './kube'
import type { GateContext } from './plan'
import { snowplowClient } from './snowplow'

export interface GateConfig {
  /** The Builders this instance validates for (its agent's), by name. */
  builders: string[]
  buildersNamespace: string
  /** The only namespace a dry-run or an inline resolve names (through snowplow). */
  sandboxNamespace: string
  /** The gate's own identity, for reading its Builder — nothing else. */
  kube: KubeClient | null
  snowplowUrl: string | null
}

const list = (value: string | undefined): string[] => (value ?? '').split(',').map((s) => s.trim()).filter(Boolean)

export const configFromEnv = (env: NodeJS.ProcessEnv = process.env): GateConfig => {
  // Off-cluster (CI's kind job, a local run) the identity is a kubeconfig, named explicitly —
  // never an ambient KUBECONFIG, so a developer's admin context is never picked up by accident.
  const identity = env.GATE_KUBECONFIG
    ? kubeconfigIdentity(env.GATE_KUBECONFIG, env.GATE_KUBE_CONTEXT || undefined)
    : inClusterIdentity()
  return {
    builders: list(env.GATE_BUILDERS),
    buildersNamespace: env.BUILDERS_NAMESPACE || 'krateo-system',
    sandboxNamespace: env.SANDBOX_NAMESPACE || 'krateo-preview',
    kube: identity ? new KubeClient(identity) : null,
    snowplowUrl: env.SNOWPLOW_URL || null,
  }
}

/** A live context for one call, as the caller whose token arrived with it (or none). */
export const liveContext = (config: GateConfig, callerToken: string | null, transport?: Transport): GateContext => ({
  live: true,
  snowplow: config.snowplowUrl && callerToken ? snowplowClient(config.snowplowUrl, callerToken, config.sandboxNamespace, transport) : null,
  snowplowMissing: !callerToken
    ? 'no caller token reached the gate (kagent forwards it on tool calls when the agent runs with KAGENT_PROPAGATE_TOKEN)'
    : config.snowplowUrl ? null : 'no snowplow is configured (SNOWPLOW_URL)',
  jq: jqcheckEngine(),
  deadline: Date.now() + GATE_TIMEOUT_MS,
})

/** The Builder lookup an instance allows: only its own Builders, read live. */
export const liveBuilderLookup = (config: GateConfig) => async (name: string): Promise<BuilderLookup> => {
  if (config.builders.length > 0 && !config.builders.includes(name)) {
    return { ok: false, problem: `this gate validates drafts for ${config.builders.join(', ')}, not ${JSON.stringify(name)}` }
  }
  if (!config.kube) {
    return { ok: false, problem: 'notChecked: the gate has no API server identity to read the Builder with' }
  }
  return builderFromCluster(config.kube, config.buildersNamespace, name)
}
