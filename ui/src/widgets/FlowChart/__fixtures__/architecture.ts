/**
 * FlowChart `architecture` data as the portal resolves it: the S11 `composition-architecture`
 * RESTAction's output for a live composition, mapped by the FlowChart widget's `widgetDataTemplate`.
 * Copied from the spec's resolved cases (built from krateo-057 objects), not written by hand, so the
 * tests draw what the page will be handed.
 *
 *   - V1B: publish-pod-sizing-v1b on 2026-09-24, in S2 `seeding`: the Repository is done, the Repo
 *     is the current step and NotSynced, and the rest waits.
 *   - V1B_REPO_DENIED: the same, for a caller who cannot get the Repo.
 *   - DEMO_FILES_DENIED: publish-pod-sizing-demo, all ready, for a caller who cannot get two of the
 *     ten files — the files are proven by the PullRequest that depends on them.
 */
import type { FlowChartData, FlowChartNodeData } from '../FlowChart'

const V1B_REPOSITORY: FlowChartNodeData = {
  detail: 'default_branch · main',
  kind: 'Repository',
  name: 'publish-pod-sizing-v1b-repo',
  parentRefs: [],
  state: 'done',
  uid: 'arch:repository',
}

const V1B_REPO: FlowChartNodeData = {
  detail: 'targetCommitId · 0 of 1',
  exception: {
    label: 'NotSynced',
    message: 'cannot determine creation result - remove the krateo.io/external-create-pending annotation if it is safe to proceed',
    reason: 'ReconcileError',
  },
  kind: 'Repo',
  name: 'publish-pod-sizing-v1b-source',
  parentRefs: [{ uid: 'arch:repository' }],
  state: 'waiting',
  uid: 'arch:repo',
}

const V1B_LATER: FlowChartData = [
  {
    detail: 'waits for Repository, Repo',
    kind: 'LocalResource ×10',
    name: 'publish-pod-sizing-v1b-000 … 009',
    parentRefs: [{ uid: 'arch:repository' }, { uid: 'arch:repo' }],
    state: 'withheld',
    uid: 'arch:localresources',
  },
  {
    detail: 'waits for all 10 LocalResource',
    kind: 'PullRequest',
    name: 'publish-pod-sizing-v1b-pr',
    parentRefs: [{ uid: 'arch:localresources' }],
    state: 'withheld',
    uid: 'arch:pullrequest',
  },
]

export const V1B: FlowChartData = [V1B_REPOSITORY, V1B_REPO, ...V1B_LATER]

export const V1B_REPO_DENIED: FlowChartData = [
  V1B_REPOSITORY,
  {
    detail: 'not readable with your access',
    kind: 'Repo',
    name: 'publish-pod-sizing-v1b-source',
    parentRefs: [{ uid: 'arch:repository' }],
    state: 'unreadable',
    uid: 'arch:repo',
  },
  ...V1B_LATER,
]

export const DEMO_FILES_DENIED: FlowChartData = [
  { detail: 'default_branch · main', kind: 'Repository', name: 'publish-pod-sizing-demo-repo', parentRefs: [], state: 'done', uid: 'arch:repository' },
  { detail: 'targetCommitId · f8aa9c2', kind: 'Repo', name: 'publish-pod-sizing-demo-source', parentRefs: [{ uid: 'arch:repository' }], state: 'done', uid: 'arch:repo' },
  {
    detail: 'not readable with your access',
    kind: 'LocalResource ×10',
    name: 'publish-pod-sizing-demo-000 … 009',
    parentRefs: [{ uid: 'arch:repository' }, { uid: 'arch:repo' }],
    state: 'done',
    uid: 'arch:localresources',
  },
  { detail: '', kind: 'PullRequest', name: 'publish-pod-sizing-demo-pr', parentRefs: [{ uid: 'arch:localresources' }], state: 'done', uid: 'arch:pullrequest' },
]
