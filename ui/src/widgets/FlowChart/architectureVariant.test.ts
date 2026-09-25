/**
 * The architecture variant's graph, from the data the S11 RESTAction hands the widget. Pure: what
 * DependencyGraph is given, and the words a card says.
 */
import { describe, expect, it } from 'vitest'

import { V1B } from './__fixtures__/architecture'
import {
  ARCHITECTURE_NODE_SIZE,
  architectureEdgeAppearance,
  architectureNodeLabel,
  architectureState,
  exceptionText,
  toArchitectureGraphData,
} from './architectureVariant'
import type { FlowChartData, FlowChartNodeData } from './FlowChart'

const node = (uid: string, parents: string[] = [], state: FlowChartNodeData['state'] = 'done'): FlowChartNodeData =>
  ({ kind: 'ConfigMap', name: uid, parentRefs: parents.map((parent) => ({ uid: parent })), state, uid })

describe('toArchitectureGraphData — the chart topology as DependencyGraph draws it', () => {
  it('one node per declared resource, keyed by its uid, carrying the data the card renders', () => {
    const { nodes } = toArchitectureGraphData(V1B)
    expect(nodes.map((each) => each.id)).toEqual(['arch:repository', 'arch:repo', 'arch:localresources', 'arch:pullrequest'])
    expect(nodes[1].data).toBe(V1B[1])
  })

  it('edges run from the dependency to its dependent, and know when they point into a withheld node', () => {
    expect(toArchitectureGraphData(V1B).edges).toEqual([
      { data: { withheld: false }, id: 'arch:repository→arch:repo', source: 'arch:repository', target: 'arch:repo' },
      { data: { withheld: true }, id: 'arch:repository→arch:localresources', source: 'arch:repository', target: 'arch:localresources' },
      { data: { withheld: true }, id: 'arch:repo→arch:localresources', source: 'arch:repo', target: 'arch:localresources' },
      { data: { withheld: true }, id: 'arch:localresources→arch:pullrequest', source: 'arch:localresources', target: 'arch:pullrequest' },
    ])
  })

  it('adds no layout column pin: dagre ranks the graph as it does for the resource variant', () => {
    expect(toArchitectureGraphData(V1B).edges.every((edge) => edge.data && !('minlen' in edge.data))).toBe(true)
  })

  it('never hands G6 a shape it throws on — a duplicate node, a parent listed twice, an edge to nowhere, a self-loop', () => {
    const data: FlowChartData = [
      node('a'),
      node('a', [], 'waiting'),
      node('b', ['a', 'a', 'absent', 'b']),
    ]
    const { edges, nodes } = toArchitectureGraphData(data)
    expect(nodes.map((each) => [each.id, each.data.state])).toEqual([['a', 'done'], ['b', 'done']])
    expect(edges.map((edge) => edge.id)).toEqual(['a→b'])
  })

  it('draws nothing from nothing', () => {
    expect(toArchitectureGraphData([])).toEqual({ edges: [], nodes: [] })
    expect(toArchitectureGraphData(undefined as unknown as FlowChartData)).toEqual({ edges: [], nodes: [] })
  })
})

describe('architectureEdgeAppearance — dashed into a withheld node, and nothing else', () => {
  it('dashes an edge into a withheld node, draws the rest solid, and labels none', () => {
    const [intoRepo, intoFiles] = toArchitectureGraphData(V1B).edges
    expect(architectureEdgeAppearance(intoRepo)).toEqual({ dashed: false })
    expect(architectureEdgeAppearance(intoFiles)).toEqual({ dashed: true })
    expect(architectureEdgeAppearance({ source: 'a', target: 'b' })).toEqual({ dashed: false })
  })
})

describe('the card', () => {
  it('reserves 220×84 per node, the card\'s CSS box (C19)', () => {
    expect(ARCHITECTURE_NODE_SIZE).toEqual([220, 84])
  })

  it('draws a state it does not know as unknown, never as done', () => {
    for (const state of ['done', 'waiting', 'withheld', 'unreadable', 'unavailable', 'unknown']) {
      expect(architectureState(state)).toBe(state)
    }
    // `orthogonal` is the composer's word for a lifecycle shim; the RESTAction drops shims, and a
    // state from a newer RESTAction must not be drawn as though it were finished.
    expect(architectureState('orthogonal')).toBe('unknown')
    expect(architectureState(undefined)).toBe('unknown')
  })

  it('words an exception as "label: reason — message", leaving out what is missing', () => {
    expect(exceptionText({ label: 'NotSynced', message: 'the message', reason: 'ReconcileError' })).toBe('NotSynced: ReconcileError — the message')
    expect(exceptionText({ label: 'NotReady', reason: 'Creating' })).toBe('NotReady: Creating')
    expect(exceptionText({ label: 'NotReady', message: 'the message' })).toBe('NotReady — the message')
    expect(exceptionText({ label: 'NotReady' })).toBe('NotReady')
  })

  it('names a node "kind name, state, exception"', () => {
    expect(architectureNodeLabel(V1B[0])).toBe('Repository publish-pod-sizing-v1b-repo, done')
    expect(architectureNodeLabel(V1B[1])).toBe(
      'Repo publish-pod-sizing-v1b-source, waiting, NotSynced: ReconcileError — cannot determine creation result - remove the krateo.io/external-create-pending annotation if it is safe to proceed',
    )
  })
})
