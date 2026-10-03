/** The gate's configuration, from its environment (the chart sets every variable per instance). */
import { builderFromCluster, type BuilderLookup } from './builder'
import { callerClient, type CallerConfig } from './caller'
import { GATE_TIMEOUT_MS } from './gate'
import { jqcheckEngine } from './jq'
import { inClusterIdentity, KubeClient, kubeconfigIdentity } from './kube'
import type { GateContext } from './plan'

export interface GateConfig {
  /** The Builders this instance validates for (its agent's), by name. */
  builders: string[]
  buildersNamespace: string
  sandboxNamespace: string
  kube: KubeClient | null
  callerConfig: CallerConfig | null
  /** Why callerConfig is null. */
  callerConfigMissing: string | null
}

const list = (value: string | undefined): string[] => (value ?? '').split(',').map((s) => s.trim()).filter(Boolean)

export const configFromEnv = (env: NodeJS.ProcessEnv = process.env): GateConfig => {
  const sandboxNamespace = env.SANDBOX_NAMESPACE || 'krateo-preview'
  // Off-cluster (CI's kind job, a local run) the identity is a kubeconfig, named explicitly —
  // never an ambient KUBECONFIG, so a developer's admin context is never picked up by accident.
  const identity = env.GATE_KUBECONFIG
    ? kubeconfigIdentity(env.GATE_KUBECONFIG, env.GATE_KUBE_CONTEXT || undefined)
    : inClusterIdentity()
  let callerConfig: CallerConfig | null = null
  let callerConfigMissing: string | null = null
  if (!env.CALLER_HOP_KUBECONFIG) {
    callerConfigMissing = 'no caller-identity hop is configured (CALLER_HOP_KUBECONFIG)'
  } else if (!env.SNOWPLOW_URL) {
    callerConfigMissing = 'no snowplow is configured (SNOWPLOW_URL)'
  } else {
    callerConfig = { hop: kubeconfigIdentity(env.CALLER_HOP_KUBECONFIG, undefined, false), snowplowUrl: env.SNOWPLOW_URL }
  }
  return {
    builders: list(env.GATE_BUILDERS),
    buildersNamespace: env.BUILDERS_NAMESPACE || 'krateo-system',
    sandboxNamespace,
    kube: identity ? new KubeClient(identity, sandboxNamespace) : null,
    callerConfig,
    callerConfigMissing,
  }
}

/** A live context for one call, as the caller whose token arrived with it (or none). */
export const liveContext = (config: GateConfig, callerToken: string | null): GateContext => ({
  live: true,
  kube: config.kube,
  caller: config.callerConfig && callerToken ? callerClient(config.callerConfig, callerToken) : null,
  callerMissing: !callerToken
    ? 'no caller token reached the gate (kagent forwards it on tool calls when the agent runs with KAGENT_PROPAGATE_TOKEN)'
    : config.callerConfigMissing,
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
