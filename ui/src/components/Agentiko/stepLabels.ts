/**
 * HOW A TOOL CALL READS IN THE RUN TIMELINE: verb + object, from the call's tool name and arguments.
 *
 * `k8s_get_resources {resource_type: pods, namespace: krateo-system}` is a fact about the cluster
 * stated in the agent's plumbing; "Read Pods · krateo-system" is the same fact stated for the person
 * waiting on it. The raw tool name is never lost — the timeline keeps it in the hover title and in
 * "Copy steps" — this module only decides the words.
 *
 * THE TABLE IS THE TOOLS THE AGENTS ACTUALLY BIND, not a guess at what a Kubernetes tool might be
 * called. Sources, read 2026-11-10:
 *   - kagent-tools (kagent-dev/tools pkg/k8s/k8s.go, pkg/helm/helm.go): the `k8s_*` / `helm_*` names
 *     and their argument keys. The read set bound by agentiko's k8s-agent/helm-agent, incident-agent,
 *     installer-agent and the specialists is k8s_get_resources, k8s_describe_resource,
 *     k8s_get_pod_logs, k8s_get_resource_yaml, k8s_get_available_api_resources,
 *     k8s_get_cluster_configuration, helm_list_releases, helm_get_release. The write set
 *     (incident-agent `tools.write`, off by default) is the rest of that file; it is mapped too,
 *     because a write is exactly the step a reader most needs named.
 *   - config-refs-mcp-server (server.py, k8s_analyze.py): k8s_analyze, config_refs.
 *   - repo-mcp-server (repo_tools.py, graph_tools.py): the repo and graph tools.
 *   - clickhouse-mcp-server: list_databases, list_tables, run_query.
 *   - Delegations are kagent agent tools, `<namespace>__NS__<agent>` with a `request` argument
 *     (evidence.ts `agentFromToolName`).
 * A name bound somewhere whose arguments no source in reach defines (query_graph, shortest_path,
 * get_neighbors, graph_stats, the schema-catalog tools) gets an argument-free phrase; anything
 * else falls back to its own name in words — honest, if plain.
 */
import { redactValue } from './redact'
import type { EvidenceEntry } from './types'

/** How one call reads, plus what grouping needs to fold a run of them into one line. */
export interface StepLabel {
  /** The line itself: "Read Pods". */
  text: string
  /** The small line under it: usually the namespace, or where a repo read came from. */
  detail?: string
  /** Consecutive calls with the same key fold into one line ("Read 3 resources"). */
  groupKey: string
  /** The verb a folded line starts with. */
  verb: string
  /** The plural noun a folded line counts ("resources"); absent = "<text> · N times". */
  noun?: string
  /** What this call touched, for a folded line's detail ("EventHealth, Deployment, Service"). */
  object?: string
  /** The namespace the call was scoped to, when it was. */
  namespace?: string
}

const str = (value: unknown): string | undefined =>
  (typeof value === 'string' && value.trim() ? value.trim() : undefined)

const clampText = (text: string, max: number): string =>
  (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text)

const capitalize = (text: string): string => (text ? text[0].toUpperCase() + text.slice(1) : text)

/** `eventhealths.composition.krateo.io` → `eventhealths`; `deploy/foo` stays the caller's problem. */
const bareType = (resourceType: string): string => resourceType.split('.')[0]

const singularOf = (type: string): string => {
  if (type.endsWith('ies')) {
    return `${type.slice(0, -3)}y`
  }
  if (/(s|x|ch|sh)es$/.test(type)) {
    return type.slice(0, -2)
  }
  return type.endsWith('s') && !type.endsWith('ss') ? type.slice(0, -1) : type
}

/** `pods` → `Pod`, `ingresses` → `Ingress`, `networkpolicies` → `Networkpolicy`, `EventHealth` stays. */
export const kindOf = (resourceType: string): string => {
  const type = bareType(resourceType)
  if (/[A-Z]/.test(type.slice(1))) {
    return type
  }
  return capitalize(singularOf(type))
}

/** `pod` → `Pods`, `pods` → `Pods`, `policy` → `Policies`. */
export const kindsOf = (resourceType: string): string => {
  const kind = kindOf(resourceType)
  if (/(s|x|ch|sh)$/.test(kind)) {
    return `${kind}es`
  }
  return /[^aeiou]y$/.test(kind) ? `${kind.slice(0, -1)}ies` : `${kind}s`
}

/** `foo_bar` → `foo bar`, `getPodLogs` → `get pod logs`. */
export const toolInWords = (name: string): string => name
  .replace(/__NS__/g, ' ')
  .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
  .replace(/[_-]+/g, ' ')
  .trim()
  .toLowerCase()

/** "Kind name" for a resource-shaped call, or just the kind(s) when no name was given. */
const resourceObject = (args: Record<string, unknown>, typeKey = 'resource_type', nameKey = 'resource_name'): { object: string; named: boolean } => {
  const type = str(args[typeKey])
  const name = str(args[nameKey])
  if (!type) {
    return { named: Boolean(name), object: name ?? 'a resource' }
  }
  return name ? { named: true, object: `${kindOf(type)} ${name}` } : { named: false, object: kindsOf(type) }
}

const scope = (args: Record<string, unknown>): string | undefined =>
  (args.all_namespaces === true ? 'all namespaces' : str(args.namespace))

/** The imperative verbs an orchestrator's delegation request typically opens with. Only these get
 *  "Asked X to <request>"; anything else (a question, a sentence about the user) is quoted. */
const IMPERATIVE = /^(add|analy[sz]e|apply|author|build|change|check|clean|compare|configure|confirm|create|delete|deploy|describe|determine|diagnose|disable|draft|edit|enable|ensure|explain|fetch|find|fix|generate|get|help|identify|inspect|install|investigate|list|look|make|migrate|patch|preview|propose|publish|read|remove|rename|render|report|restart|review|roll|run|scaffold|scale|search|set|show|summari[sz]e|tell|trace|uninstall|update|upgrade|validate|verify|write)\b/i

const INTENT_MAX = 80

/**
 * One line of a delegation's intent, from its request: the first sentence, at most ~80 characters.
 * `imperative` says whether it reads as an instruction ("diagnose …"), which the label can follow
 * "Asked X to" with; otherwise it is quoted under the label. The full request stays one click away.
 */
export const delegationIntent = (request: string | undefined): { imperative: boolean; intent: string } | undefined => {
  const text = request?.replace(/\s+/g, ' ').trim()
  if (!text) {
    return undefined
  }
  const sentence = /^(.+?[.?!])(\s|$)/.exec(text)?.[1] ?? text
  const imperative = IMPERATIVE.test(sentence)
  const body = imperative ? sentence.replace(/[.!]$/, '') : sentence
  return { imperative, intent: clampText(imperative ? body[0].toLowerCase() + body.slice(1) : body, INTENT_MAX) }
}

type Mapper = (args: Record<string, unknown>, entry: EvidenceEntry) => Omit<StepLabel, 'groupKey'>

const resourceStep = (verb: string, noun = 'resources'): Mapper => (args) => {
  const { object } = resourceObject(args)
  const namespace = scope(args)
  return { detail: namespace, namespace, noun, object, text: `${verb} ${object}`, verb }
}

const fixed = (text: string, verb: string, noun?: string): Mapper => (args) => {
  const namespace = scope(args)
  return { detail: namespace, namespace, ...(noun ? { noun } : {}), text, verb }
}

/** Where a repo read came from: `krateo-platformops/frontend @ v1.2.3`. */
const repoDetail = (entry: EvidenceEntry, args: Record<string, unknown>): string | undefined => {
  const repo = entry.source?.repo ?? str(args.repo)
  if (!repo) {
    return undefined
  }
  const org = entry.source?.org ? `${entry.source.org}/` : ''
  const ref = entry.source?.ref ?? str(args.ref)
  return `${org}${repo}${ref && ref !== 'HEAD' ? ` @ ${ref}` : ''}`
}

/** kagent-tools: Kubernetes reads */
const K8S_READS: Record<string, Mapper> = {
  // Not a read: it runs a curl pod, waits, execs into it and deletes it. The approved table words it
  // as the check it is.
  k8s_check_service_connectivity: (args) => {
    const service = str(args.service_name) ?? 'a service'
    const namespace = scope(args)
    return { detail: namespace, namespace, object: service, text: `Check connectivity to ${service}`, verb: 'Check connectivity to' }
  },
  k8s_describe_resource: resourceStep('Described'),
  k8s_generate_resource: (args) => {
    const type = str(args.resource_type)
    return { text: type ? `Generated a ${kindOf(type)} manifest` : 'Generated a manifest', verb: 'Generated' }
  },
  k8s_get_available_api_resources: fixed('Listed the cluster’s API resources', 'Listed'),
  k8s_get_cluster_configuration: fixed('Read the cluster configuration', 'Read'),
  k8s_get_events: fixed('Read events', 'Read', 'event lists'),
  k8s_get_pod_logs: (args) => {
    const pod = str(args.pod_name) ?? 'a pod'
    const namespace = scope(args)
    const container = str(args.container)
    return { detail: [container ? `container ${container}` : undefined, namespace].filter(Boolean).join(' · ') || undefined, namespace, noun: 'pod logs', object: pod, text: `Read logs of ${pod}`, verb: 'Read' }
  },
  k8s_get_resource_yaml: (args) => {
    const { object } = resourceObject(args)
    const namespace = scope(args)
    return { detail: namespace, namespace, noun: 'manifests', object, text: `Read the YAML of ${object}`, verb: 'Read' }
  },
  k8s_get_resources: resourceStep('Read'),
  k8s_wait: (args) => {
    const { object } = resourceObject(args)
    const condition = str(args.condition)
    const namespace = scope(args)
    return { detail: [condition, namespace].filter(Boolean).join(' · ') || undefined, namespace, object, text: `Waited for ${object}`, verb: 'Waited for' }
  },
}

/** kagent-tools: Kubernetes writes */
const K8S_WRITES: Record<string, Mapper> = {
  k8s_annotate_resource: resourceStep('Annotated'),
  k8s_apply_manifest: fixed('Applied a manifest', 'Applied', 'manifests'),
  k8s_create_resource: fixed('Created a resource', 'Created', 'resources'),
  k8s_create_resource_from_url: (args) => {
    const url = str(args.url)
    const namespace = scope(args)
    return { detail: namespace, namespace, text: url ? `Created resources from ${url}` : 'Created resources from a URL', verb: 'Created' }
  },
  k8s_delete_resource: resourceStep('Deleted'),
  k8s_execute_command: (args) => {
    const pod = str(args.pod_name) ?? 'a pod'
    const command = str(args.command)
    const namespace = scope(args)
    return { detail: [command ? clampText(command, 60) : undefined, namespace].filter(Boolean).join(' · ') || undefined, namespace, object: pod, text: `Ran a command in ${pod}`, verb: 'Ran a command in' }
  },
  k8s_label_resource: resourceStep('Labelled'),
  k8s_patch_resource: resourceStep('Patched'),
  k8s_patch_status: (args) => {
    const { object } = resourceObject(args)
    const namespace = scope(args)
    return { detail: namespace, namespace, object, text: `Patched the status of ${object}`, verb: 'Patched the status of' }
  },
  k8s_remove_annotation: (args) => {
    const { object } = resourceObject(args)
    const key = str(args.annotation_key)
    const namespace = scope(args)
    return { detail: namespace, namespace, object, text: `Removed annotation ${key ?? ''} from ${object}`.replace('  ', ' '), verb: 'Removed an annotation from' }
  },
  k8s_remove_label: (args) => {
    const { object } = resourceObject(args)
    const key = str(args.label_key)
    const namespace = scope(args)
    return { detail: namespace, namespace, object, text: `Removed label ${key ?? ''} from ${object}`.replace('  ', ' '), verb: 'Removed a label from' }
  },
  k8s_rollout: (args) => {
    const { object } = resourceObject(args)
    const action = str(args.action)
    const namespace = scope(args)
    return { detail: namespace, namespace, object, text: action ? `Ran rollout ${action} on ${object}` : `Ran a rollout on ${object}`, verb: 'Ran a rollout on' }
  },
  k8s_scale: (args) => {
    const name = str(args.name) ?? 'a deployment'
    const namespace = scope(args)
    const replicas = typeof args.replicas === 'number' ? ` to ${args.replicas} replica${args.replicas === 1 ? '' : 's'}` : ''
    return { detail: namespace, namespace, object: name, text: `Scaled ${name}${replicas}`, verb: 'Scaled' }
  },
}

/** kagent-tools: Helm */
const HELM: Record<string, Mapper> = {
  helm_get_release: (args) => {
    const name = str(args.name) ?? 'a release'
    const namespace = scope(args)
    const resource = str(args.resource)
    const what = resource && resource !== 'all' ? `the ${resource} of ` : ''
    return { detail: namespace, namespace, noun: 'Helm releases', object: name, text: `Read ${what}Helm release ${name}`, verb: 'Read' }
  },
  helm_list_releases: fixed('Listed Helm releases', 'Listed', 'release lists'),
  helm_repo_add: (args) => {
    const name = str(args.name) ?? 'a repository'
    return { detail: str(args.url), text: `Added Helm repository ${name}`, verb: 'Added' }
  },
  helm_repo_update: fixed('Updated the Helm repositories', 'Updated'),
  helm_uninstall: (args) => {
    const name = str(args.name) ?? 'a release'
    const namespace = scope(args)
    return { detail: namespace, namespace, object: name, text: `Uninstalled Helm release ${name}`, verb: 'Uninstalled' }
  },
  helm_upgrade: (args) => {
    const name = str(args.name) ?? 'a release'
    const chart = str(args.chart)
    const version = str(args.version)
    const namespace = scope(args)
    const chartRef = chart ? `${chart}${version ? `@${version}` : ''}` : undefined
    return { detail: [chartRef, namespace].filter(Boolean).join(' · ') || undefined, namespace, object: name, text: `${args.dry_run === true ? 'Dry-ran an upgrade of' : 'Upgraded'} Helm release ${name}`, verb: 'Upgraded' }
  },
}

/** config-refs-mcp-server */
const CONFIG_REFS: Record<string, Mapper> = {
  config_refs: (args) => {
    const kind = str(args.kind)
    const name = str(args.name)
    const namespace = scope(args)
    const target = kind && name ? `${kindOf(kind)} ${name}` : name ?? 'a workload'
    return { detail: namespace, namespace, object: target, text: `Traced the config references of ${target}`, verb: 'Traced the config references of' }
  },
  k8s_analyze: (args) => {
    const namespace = scope(args)
    const target = str(args.kind) ? resourceObject(args, 'kind', 'name').object : str(args.name) ?? namespace ?? 'the namespace'
    return { detail: namespace, namespace, object: target, text: `Checked the health of ${target}`, verb: 'Checked the health of' }
  },
}

/** repo-mcp-server: the source corpus */
const REPO: Record<string, Mapper> = {
  list_blueprints: () => ({ text: 'Listed the blueprints', verb: 'Listed' }),
  list_repo_files: (args, entry) => {
    const repo = entry.source?.repo ?? str(args.repo) ?? 'a repository'
    const glob = str(args.glob)
    return { detail: [glob, repoDetail(entry, args)].filter(Boolean).join(' · ') || undefined, object: repo, text: `Listed files in ${repo}`, verb: 'Listed' }
  },
  list_repos: () => ({ text: 'Listed the source repositories', verb: 'Listed' }),
  read_repo_file: (args, entry) => {
    const path = entry.source?.path ?? str(args.path) ?? 'a file'
    return { detail: [repoDetail(entry, args), entry.note].filter(Boolean).join(' · ') || undefined, noun: 'files', object: path, text: `Read ${path}`, verb: 'Read' }
  },
  search_repo: (args, entry) => {
    const repo = entry.source?.repo ?? str(args.repo) ?? 'a repository'
    const pattern = str(args.pattern)
    return { detail: [repoDetail(entry, args), entry.note].filter(Boolean).join(' · ') || undefined, noun: 'searches', object: pattern ? `“${clampText(pattern, 40)}”` : repo, text: pattern ? `Searched ${repo} for “${clampText(pattern, 40)}”` : `Searched ${repo}`, verb: 'Ran' }
  },
  validate_manifest: () => ({ noun: 'manifests', text: 'Validated a manifest', verb: 'Validated' }),
}

/** repo-mcp-server: the graph and knowledge layer */
const GRAPH: Record<string, Mapper> = {
  get_neighbors: () => ({ noun: 'graph lookups', text: 'Looked up a node’s connections', verb: 'Ran' }),
  graph_find: (args) => {
    const query = str(args.query)
    return { noun: 'graph searches', object: query, text: query ? `Searched the platform graph for “${clampText(query, 40)}”` : 'Searched the platform graph', verb: 'Ran' }
  },
  graph_map: (args) => {
    const topic = str(args.topic)
    return { object: topic, text: topic ? `Mapped ${clampText(topic, 50)}` : 'Mapped a topic in the platform graph', verb: 'Mapped' }
  },
  graph_neighbors: (args) => {
    const node = str(args.node)
    return { noun: 'graph lookups', object: node, text: node ? `Looked up what ${clampText(node, 50)} connects to` : 'Looked up a node’s connections', verb: 'Ran' }
  },
  graph_path: (args) => {
    const src = str(args.src)
    const dst = str(args.dst)
    return { text: src && dst ? `Traced how ${clampText(src, 30)} reaches ${clampText(dst, 30)}` : 'Traced a path in the platform graph', verb: 'Traced' }
  },
  graph_stats: () => ({ text: 'Read the platform graph’s statistics', verb: 'Read' }),
  knowledge_lookup: (args) => {
    const topic = str(args.topic)
    return { noun: 'knowledge lookups', object: topic, text: topic ? `Looked up ${clampText(topic, 50)}` : 'Looked up the platform knowledge base', verb: 'Ran' }
  },
  query_graph: () => ({ noun: 'graph queries', text: 'Queried the platform graph', verb: 'Ran' }),
  shortest_path: () => ({ text: 'Traced a path in the platform graph', verb: 'Traced' }),
}

/** clickhouse-mcp-server: telemetry */
const TELEMETRY: Record<string, Mapper> = {
  list_databases: () => ({ text: 'Listed the telemetry databases', verb: 'Listed' }),
  list_tables: (args) => {
    const database = str(args.database)
    return { text: database ? `Listed the tables in ${database}` : 'Listed the telemetry tables', verb: 'Listed' }
  },
  run_query: (args) => {
    const query = str(args.query)
    return { detail: query ? clampText(query.replace(/\s+/g, ' '), 90) : undefined, noun: 'telemetry queries', text: 'Queried telemetry', verb: 'Ran' }
  },
}

const TOOLS: Record<string, Mapper> = { ...K8S_READS, ...K8S_WRITES, ...HELM, ...CONFIG_REFS, ...REPO, ...GRAPH, ...TELEMETRY }

/** The words for one call. Arguments pass through the same redactor as the copied evidence. */
export const labelStep = (entry: EvidenceEntry): StepLabel => {
  const args = (redactValue(entry.args ?? {}) ?? {}) as Record<string, unknown>
  if (entry.agent) {
    const intent = delegationIntent(entry.request)
    return {
      ...(intent && !intent.imperative ? { detail: `“${intent.intent}”` } : {}),
      groupKey: `delegation:${entry.id}`,
      text: intent?.imperative ? `Asked ${entry.agent} to ${intent.intent}` : `Asked ${entry.agent}`,
      verb: 'Asked',
    }
  }
  const mapper = TOOLS[entry.tool]
  if (!mapper) {
    const namespace = scope(args)
    return { detail: namespace, groupKey: `${entry.tool}|${namespace ?? ''}`, namespace, text: `Ran ${toolInWords(entry.tool)}`, verb: 'Ran' }
  }
  const label = mapper(args, entry)
  return { ...label, groupKey: `${entry.tool}|${label.namespace ?? entry.source?.repo ?? ''}` }
}

/** What a paused write tool wants to do, for "k8s-agent wants to apply a manifest". */
const APPROVAL_INTENTS: Record<string, string> = {
  helm_uninstall: 'uninstall a Helm release',
  helm_upgrade: 'upgrade a Helm release',
  k8s_annotate_resource: 'annotate a resource',
  k8s_apply_manifest: 'apply a manifest',
  k8s_create_resource: 'create a resource',
  k8s_create_resource_from_url: 'create resources from a URL',
  k8s_delete_resource: 'delete a resource',
  k8s_execute_command: 'run a command in a pod',
  k8s_label_resource: 'label a resource',
  k8s_patch_resource: 'patch a resource',
  k8s_patch_status: 'patch a resource’s status',
  k8s_rollout: 'run a rollout',
  k8s_scale: 'scale a deployment',
}

export const approvalIntent = (toolName: string): string => APPROVAL_INTENTS[toolName] ?? `run ${toolInWords(toolName)}`
