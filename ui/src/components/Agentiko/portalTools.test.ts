import { describe, expect, it } from 'vitest'

import { isEvidenceTool, readToolPart } from './evidence'
import { decodePortalArgs, isPortalTool, PORTAL_VERB_TOOLS, portalToolTurn, recordPortalFrame, type PortalToolCall } from './portalTools'
import type { AgentikoFrame } from './types'

const call = (name: string, args: Record<string, unknown>, id = name): AgentikoFrame => ({ args, id, kind: 'tool_call', name })
const result = (name: string, isError: boolean, id = name): AgentikoFrame => ({ id, isError, kind: 'tool_result', name })

const fold = (frames: AgentikoFrame[]): PortalToolCall[] =>
  frames.reduce<PortalToolCall[]>((calls, frame) => recordPortalFrame(calls, frame), [])

describe('which tools are portal tools', () => {
  it('the verbs, the chips, the tour, the guide and the legacy tool; never a read or a specialist', () => {
    for (const name of ['navigate', 'prefillForm', 'patchField', 'composeAdd', 'chartLink', 'controllerSetItemsPath', 'previewRestDef',
      'publishRestDef', 'suggestFollowups', 'startTour', 'readBuilderGuide', 'propose_portal_action']) {
      expect(isPortalTool(name), name).toBe(true)
    }
    for (const name of ['k8s_get_resources', 'read_repo_file', 'krateo_system__NS__frontend_agent', 'openDrawer', 'ask_user']) {
      expect(isPortalTool(name), name).toBe(false)
    }
    expect(PORTAL_VERB_TOOLS.size).toBe(30)
  })

  it('a portal tool is protocol, so the evidence panel leaves it out', () => {
    expect(isEvidenceTool('navigate')).toBe(false)
    expect(isEvidenceTool('readBuilderGuide')).toBe(false)
    expect(isEvidenceTool('propose_portal_action')).toBe(false)
    expect(isEvidenceTool('read_repo_file')).toBe(true)
  })
})

describe('a turn runs the calls the server accepted', () => {
  it('maps an accepted call to its verb with the arguments as the proposal', () => {
    const calls = fold([call('navigate', { label: 'Marketplace', route: '/marketplace' }), result('navigate', false)])
    expect(portalToolTurn(calls).proposals).toEqual([{ label: 'Marketplace', route: '/marketplace', verb: 'navigate' }])
  })

  it('skips a call the server refused, and runs the corrected one made after it', () => {
    const calls = fold([
      call('composeAdd', { target: 'page-x' }, 'c1'), result('composeAdd', true, 'c1'),
      call('composeAdd', { kind: 'Table', name: 'pods', target: 'page-x' }, 'c2'), result('composeAdd', false, 'c2'),
      call('composeBind', { actionRef: { name: 'pods' }, widget: 'pods' }, 'c3'), result('composeBind', false, 'c3'),
    ])
    expect(portalToolTurn(calls).proposals.map((proposal) => [proposal.verb, proposal.kind ?? proposal.widget])).toEqual([['composeAdd', 'Table'], ['composeBind', 'pods']])
  })

  it('a call with no result yet runs nothing', () => {
    expect(portalToolTurn(fold([call('navigate', { route: '/x' })])).proposals).toEqual([])
  })

  it('the tool name wins over a verb the arguments carry', () => {
    const calls = fold([call('navigate', { route: '/x', verb: 'applyResourceSet' }), result('navigate', false)])
    expect(portalToolTurn(calls).proposals[0].verb).toBe('navigate')
  })

  it('a call the final artifact repeats is kept once, with its first result', () => {
    const calls = fold([
      call('navigate', { route: '/a' }, 'n1'), result('navigate', false, 'n1'),
      call('navigate', { route: '/a' }, 'n1'), result('navigate', true, 'n1'),
    ])
    expect(calls).toEqual([{ args: { route: '/a' }, id: 'n1', name: 'navigate', ok: true }])
  })

  it('chips and a tour come from their tools; the guide runs nothing', () => {
    const steps = [{ anchor: 'nav:Compositions', description: 'All of them.', title: 'Compositions' }, { anchor: 'nav:Blueprints', description: 'b', title: 'Blueprints' }]
    const turn = portalToolTurn(fold([
      call('suggestFollowups', { suggestions: ['Show failures', 'Show failures', 'Open the catalog'] }), result('suggestFollowups', false),
      call('startTour', { steps }), result('startTour', false),
      call('readBuilderGuide', { builder: 'page' }), result('readBuilderGuide', false),
    ]))
    expect(turn).toEqual({ proposals: [], suggestions: ['Show failures', 'Open the catalog'], tour: { steps } })
  })

  it('propose_portal_action runs as before: without a result, unless its result is an error', () => {
    expect(portalToolTurn(fold([call('propose_portal_action', { route: '/x', verb: 'navigate' })])).proposals).toEqual([{ route: '/x', verb: 'navigate' }])
    expect(portalToolTurn(fold([call('propose_portal_action', { verb: 'navigate' }), result('propose_portal_action', true)])).proposals).toEqual([])
  })

  it('calls with no id are never taken for repeats, and an id-less result settles the oldest', () => {
    const calls = fold([
      { args: { group: 'pet', verb: 'controllerPlace' }, kind: 'tool_call', name: 'propose_portal_action' },
      { args: { verb: 'previewRestDef' }, kind: 'tool_call', name: 'propose_portal_action' },
      { isError: true, kind: 'tool_result', name: 'propose_portal_action' },
    ])
    expect(calls.map((call) => call.ok)).toEqual([false, undefined])
    expect(portalToolTurn(calls).proposals).toEqual([{ verb: 'previewRestDef' }])
  })

  it('frames of other tools leave the list alone', () => {
    expect(fold([call('read_repo_file', { path: 'x' }), result('read_repo_file', false)])).toEqual([])
  })
})

describe('whole objects arrive as JSON text', () => {
  const flex = { apiVersion: 'widgets.templates.krateo.io/v1beta1', kind: 'Flex', metadata: { annotations: { 'krateo.io/nav-path': '/x' }, name: 'page-x' } }

  it('previewPage parses widgets into the CRs, and takes one object as one widget', () => {
    const calls = fold([call('previewPage', { label: 'Preview', widgets: JSON.stringify([flex]) }), result('previewPage', false)])
    expect(portalToolTurn(calls).proposals).toEqual([{ label: 'Preview', verb: 'previewPage', widgets: [flex] }])
    const one = fold([call('previewPage', { widgets: JSON.stringify(flex) }), result('previewPage', false)])
    expect(portalToolTurn(one).proposals[0].widgets).toEqual([flex])
  })

  it('applyResourceSet parses each payload; an op without one is left as it is', () => {
    const ops = [
      { gvr: { group: '', resource: 'configmaps', version: 'v1' }, namespace: 'demo', payload: JSON.stringify({ data: { 'a.json': '{"k": 1}' }, metadata: { name: 'x' } }), verb: 'POST' },
      { gvr: { group: '', resource: 'configmaps', version: 'v1' }, name: 'y', namespace: 'demo', verb: 'DELETE' },
    ]
    const calls = fold([call('applyResourceSet', { ops }), result('applyResourceSet', false)])
    expect(portalToolTurn(calls).proposals[0].ops).toEqual([
      { ...ops[0], payload: { data: { 'a.json': '{"k": 1}' }, metadata: { name: 'x' } } },
      ops[1],
    ])
  })

  it('text that does not parse stays text, and object arguments pass through unchanged', () => {
    expect(decodePortalArgs('previewPage', { widgets: '[{' })).toEqual({ widgets: '[{' })
    expect(decodePortalArgs('previewPage', { widgets: [flex] })).toEqual({ widgets: [flex] })
    expect(decodePortalArgs('prefillForm', { values: { name: '{"a":1}' } })).toEqual({ values: { name: '{"a":1}' } })
  })
})

describe('readToolPart reads a failed MCP tool as failed', () => {
  it('adk-go reports an MCP isError result as {error}', () => {
    const part = {
      data: { id: 'c1', name: 'composeAdd', response: { error: 'Tool execution failed. Details: Not sent to the portal. Fix the call…' } },
      kind: 'data',
      metadata: { adk_type: 'function_response' },
    }
    expect(readToolPart(part)).toMatchObject({ id: 'c1', isError: true, name: 'composeAdd', type: 'result' })
    expect(readToolPart(part)?.output).toMatch(/^Tool execution failed/)
  })

  it('a plain output stays a success', () => {
    const part = { data: { id: 'c1', name: 'navigate', response: { output: 'navigate sent to the portal.' } }, kind: 'data', metadata: { adk_type: 'function_response' } }
    expect(readToolPart(part)).toMatchObject({ isError: false, output: 'navigate sent to the portal.' })
  })
})
