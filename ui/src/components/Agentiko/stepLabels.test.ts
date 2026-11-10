/**
 * The words a tool call reads as in the run timeline. Table-driven over the tools the agents bind
 * (see stepLabels.ts for the sources), with their real argument keys: a label that only works for
 * an argument name nobody sends is a label nobody sees.
 */
import { describe, expect, it } from 'vitest'

import { agentFromToolName } from './evidence'
import { approvalIntent, delegationIntent, kindOf, kindsOf, labelStep, toolInWords } from './stepLabels'
import type { EvidenceEntry } from './types'

const call = (tool: string, args?: Record<string, unknown>, over: Partial<EvidenceEntry> = {}): EvidenceEntry => ({
  id: `${tool}-1`,
  kind: 'tool',
  tool,
  ...(args ? { args } : {}),
  ...over,
})

describe('labelStep — the tools the agents actually bind', () => {
  const NS = 'krateo-system'
  it.each<[string, Record<string, unknown> | undefined, string, string | undefined]>([
    // The approved table's rows, verbatim.
    ['k8s_get_resources', { namespace: NS, resource_type: 'pods' }, 'Read Pods', NS],
    ['k8s_describe_resource', { namespace: NS, resource_name: 'kagent-tools', resource_type: 'service' }, 'Described Service kagent-tools', NS],
    ['k8s_check_service_connectivity', { service_name: 'kagent-tools:8084' }, 'Check connectivity to kagent-tools:8084', undefined],
    ['foo_bar', undefined, 'Ran foo bar', undefined],
    // kagent-tools: Kubernetes reads (the set every specialist binds).
    ['k8s_get_resources', { namespace: NS, resource_name: 'event-health', resource_type: 'eventhealths.composition.krateo.io' }, 'Read Eventhealth event-health', NS],
    ['k8s_get_resources', { all_namespaces: true, resource_type: 'deployment' }, 'Read Deployments', 'all namespaces'],
    ['k8s_get_resources', { namespace: NS, resource_type: 'ingresses' }, 'Read Ingresses', NS],
    ['k8s_get_resource_yaml', { namespace: NS, resource_name: 'snowplow', resource_type: 'deployment' }, 'Read the YAML of Deployment snowplow', NS],
    ['k8s_get_pod_logs', { container: 'server', namespace: NS, pod_name: 'snowplow-7d9' }, 'Read logs of snowplow-7d9', `container server · ${NS}`],
    ['k8s_get_available_api_resources', {}, 'Listed the cluster’s API resources', undefined],
    ['k8s_get_cluster_configuration', {}, 'Read the cluster configuration', undefined],
    ['k8s_get_events', { namespace: NS }, 'Read events', NS],
    // kagent-tools: writes (incident-agent tools.write) — the steps a reader most needs named.
    ['k8s_apply_manifest', { manifest: 'apiVersion: v1\nkind: ConfigMap' }, 'Applied a manifest', undefined],
    ['k8s_patch_resource', { namespace: NS, patch: '{}', resource_name: 'snowplow', resource_type: 'deployment' }, 'Patched Deployment snowplow', NS],
    ['k8s_delete_resource', { namespace: NS, resource_name: 'snowplow-7d9', resource_type: 'pod' }, 'Deleted Pod snowplow-7d9', NS],
    ['k8s_scale', { name: 'snowplow', namespace: NS, replicas: 3 }, 'Scaled snowplow to 3 replicas', NS],
    ['k8s_rollout', { action: 'restart', namespace: NS, resource_name: 'snowplow', resource_type: 'deployment' }, 'Ran rollout restart on Deployment snowplow', NS],
    ['k8s_remove_label', { label_key: 'app', namespace: NS, resource_name: 'x', resource_type: 'pod' }, 'Removed label app from Pod x', NS],
    // kagent-tools: Helm.
    ['helm_list_releases', { namespace: NS }, 'Listed Helm releases', NS],
    ['helm_get_release', { name: 'portal', namespace: NS, resource: 'values' }, 'Read the values of Helm release portal', NS],
    ['helm_get_release', { name: 'portal', namespace: NS, resource: 'all' }, 'Read Helm release portal', NS],
    ['helm_upgrade', { chart: 'krateo/portal', name: 'portal', namespace: NS, version: '1.8.104' }, 'Upgraded Helm release portal', `krateo/portal@1.8.104 · ${NS}`],
    // config-refs-mcp-server.
    ['k8s_analyze', { namespace: NS }, `Checked the health of ${NS}`, NS],
    ['k8s_analyze', { kind: 'Deployment', name: 'snowplow', namespace: NS }, 'Checked the health of Deployment snowplow', NS],
    ['config_refs', { kind: 'Deployment', name: 'snowplow', namespace: NS }, 'Traced the config references of Deployment snowplow', NS],
    // repo-mcp-server: corpus and graph.
    ['list_repos', {}, 'Listed the source repositories', undefined],
    ['list_blueprints', {}, 'Listed the blueprints', undefined],
    ['search_repo', { pattern: 'readyFromConditions', repo: 'installer' }, 'Searched installer for “readyFromConditions”', 'krateo-platformops/installer'],
    ['validate_manifest', { manifest: 'kind: X' }, 'Validated a manifest', undefined],
    ['graph_find', { query: 'snowplow' }, 'Searched the platform graph for “snowplow”', undefined],
    ['graph_neighbors', { node: 'kind:Composition' }, 'Looked up what kind:Composition connects to', undefined],
    ['graph_path', { dst: 'snowplow', src: 'installer' }, 'Traced how installer reaches snowplow', undefined],
    ['knowledge_lookup', { topic: 'composition readiness' }, 'Looked up composition readiness', undefined],
    ['query_graph', { anything: 1 }, 'Queried the platform graph', undefined],
    // clickhouse-mcp-server.
    ['run_query', { query: 'SELECT count()  FROM otel_logs' }, 'Queried telemetry', 'SELECT count() FROM otel_logs'],
    ['list_databases', {}, 'Listed the telemetry databases', undefined],
  ])('%s %j → %s', (tool, args, text, detail) => {
    const repo = typeof args?.repo === 'string' ? args.repo : undefined
    const label = labelStep(call(tool, args, repo ? { source: { org: 'krateo-platformops', repo } } : {}))
    expect(label.text).toBe(text)
    expect(label.detail).toBe(detail)
  })

  it('reads a repo file as its path, with where it came from', () => {
    const label = labelStep(call('read_repo_file', { path: 'chart/values.yaml', repo: 'frontend' }, {
      note: '134 lines',
      source: { org: 'krateo-platformops', path: 'chart/values.yaml', ref: 'v1.8.104', repo: 'frontend' },
    }))
    expect(label.text).toBe('Read chart/values.yaml')
    expect(label.detail).toBe('krateo-platformops/frontend @ v1.8.104 · 134 lines')
  })

  it('never shows a credential in a label — args go through the redactor', () => {
    const label = labelStep(call('run_query', { query: 'SELECT eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4In0.c2lnbmF0dXJl' }))
    expect(label.detail).not.toContain('eyJhbGci')
  })
})

describe('labelStep — delegations', () => {
  const tool = 'krateo_system__NS__core_provider_agent'
  const delegation = (request?: string): EvidenceEntry => ({ agent: agentFromToolName(tool), id: 'd1', kind: 'delegation', request, tool })

  it('says who was asked, and what, when the request is an instruction', () => {
    expect(labelStep(delegation('Diagnose composition event-health in krateo-system. Report its conditions.')).text)
      .toBe('Asked core-provider-agent to diagnose composition event-health in krateo-system')
  })

  it('quotes a request that is not an instruction, under the label', () => {
    const label = labelStep(delegation('Is it healthy? If not, explain why.'))
    expect(label.text).toBe('Asked core-provider-agent')
    expect(label.detail).toBe('“Is it healthy?”')
  })

  it('keeps the intent to one line of about 80 characters', () => {
    const intent = delegationIntent(`Check ${'very '.repeat(40)}long things`)
    expect(intent?.intent.length).toBeLessThanOrEqual(80)
    expect(intent?.intent.endsWith('…')).toBe(true)
  })

  it('never folds two hand-offs together — each has its own lane', () => {
    expect(labelStep({ ...delegation('a'), id: 'd1' }).groupKey).not.toBe(labelStep({ ...delegation('a'), id: 'd2' }).groupKey)
  })
})

describe('grouping keys', () => {
  it('same tool, same namespace → same key, whatever the resource type', () => {
    expect(labelStep(call('k8s_get_resources', { namespace: 'a', resource_type: 'pods' })).groupKey)
      .toBe(labelStep(call('k8s_get_resources', { namespace: 'a', resource_type: 'services' })).groupKey)
  })

  it('another namespace or another tool → another key', () => {
    const base = labelStep(call('k8s_get_resources', { namespace: 'a', resource_type: 'pods' })).groupKey
    expect(labelStep(call('k8s_get_resources', { namespace: 'b', resource_type: 'pods' })).groupKey).not.toBe(base)
    expect(labelStep(call('k8s_describe_resource', { namespace: 'a', resource_type: 'pods' })).groupKey).not.toBe(base)
  })
})

describe('the words helpers', () => {
  it.each([['pods', 'Pod', 'Pods'], ['ingresses', 'Ingress', 'Ingresses'], ['networkpolicies', 'Networkpolicy', 'Networkpolicies'], ['EventHealth', 'EventHealth', 'EventHealths'], ['service', 'Service', 'Services']])(
    '%s → %s / %s',
    (type, one, many) => {
      expect(kindOf(type)).toBe(one)
      expect(kindsOf(type)).toBe(many)
    },
  )

  it('falls back to the tool name in words', () => {
    expect(toolInWords('getPodLogs')).toBe('get pod logs')
    expect(toolInWords('foo_bar-baz')).toBe('foo bar baz')
  })

  it('names what a paused write wants to do', () => {
    expect(approvalIntent('k8s_apply_manifest')).toBe('apply a manifest')
    expect(approvalIntent('mystery_write')).toBe('run mystery write')
  })
})
