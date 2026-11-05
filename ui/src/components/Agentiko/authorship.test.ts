/**
 * FE-BP3 — host-stamped authorship:
 *   - managed-by + authored-by always stamped; agent-session only when a sessionId is
 *     given; authoring-prompt annotation only when a prompt is given (truncated);
 *   - host keys OVERWRITE a model-supplied same-key; unrelated model metadata survives;
 *   - ops with no object payload ride through; the input ops are never mutated;
 *   - odd session ids are sanitized to a valid k8s label value.
 */
import { describe, expect, it } from 'vitest'

import type { ApplyResourceSetOp } from './applyResourceSet'
import {
  AGENT_SESSION_LABEL,
  AUTHORED_BY_LABEL,
  AUTHORING_PROMPT_ANNOTATION,
  AUTHORING_PROMPT_MAX,
  MANAGED_BY_LABEL,
  sanitizeLabelValue,
  stampAuthorship,
} from './authorship'

const cdOp = (labels?: Record<string, string>): ApplyResourceSetOp => ({
  gvr: { group: 'core.krateo.io', resource: 'compositiondefinitions', version: 'v1alpha1' },
  name: 'hello',
  namespace: 'krateo-system',
  payload: {
    apiVersion: 'core.krateo.io/v1alpha1',
    kind: 'CompositionDefinition',
    metadata: { name: 'hello', namespace: 'krateo-system', ...(labels ? { labels } : {}) },
    spec: { chart: { url: 'oci://…/hello', version: '0.1.0' } },
  },
  verb: 'POST',
})

const metaOf = (op: ApplyResourceSetOp) => (op.payload as { metadata: { labels: Record<string, string>; annotations: Record<string, string> } }).metadata

describe('stampAuthorship', () => {
  it('always stamps managed-by + authored-by', () => {
    const [out] = stampAuthorship([cdOp()], {})
    expect(metaOf(out).labels[MANAGED_BY_LABEL]).toBe('krateo')
    expect(metaOf(out).labels[AUTHORED_BY_LABEL]).toBe('autopilot')
  })

  it('stamps agent-session only when a sessionId is given', () => {
    expect(metaOf(stampAuthorship([cdOp()], {})[0]).labels[AGENT_SESSION_LABEL]).toBeUndefined()
    const [out] = stampAuthorship([cdOp()], { sessionId: '26d903c4-733b-4152-9291-78178c980b68' })
    expect(metaOf(out).labels[AGENT_SESSION_LABEL]).toBe('26d903c4-733b-4152-9291-78178c980b68')
  })

  it('stamps the authoring-prompt annotation (truncated) only when a prompt is given', () => {
    expect(metaOf(stampAuthorship([cdOp()], {})[0]).annotations[AUTHORING_PROMPT_ANNOTATION]).toBeUndefined()
    const long = 'x'.repeat(AUTHORING_PROMPT_MAX + 500)
    const [out] = stampAuthorship([cdOp()], { prompt: `  ${long}  ` })
    expect(metaOf(out).annotations[AUTHORING_PROMPT_ANNOTATION].length).toBe(AUTHORING_PROMPT_MAX)
  })

  it('host keys overwrite a model-supplied same-key; other model labels survive', () => {
    const [out] = stampAuthorship([cdOp({ 'app.kubernetes.io/managed-by': 'the-model-lied', team: 'platform' })], {})
    expect(metaOf(out).labels[MANAGED_BY_LABEL]).toBe('krateo')
    expect(metaOf(out).labels.team).toBe('platform')
  })

  it('rides ops with no object payload through unchanged', () => {
    const del: ApplyResourceSetOp = { gvr: { group: 'core.krateo.io', resource: 'compositiondefinitions', version: 'v1alpha1' }, name: 'x', namespace: 'ns', verb: 'DELETE' }
    const [out] = stampAuthorship([del], { sessionId: 's' })
    expect(out).toEqual(del)
  })

  it('never mutates the input ops', () => {
    const ops = [cdOp()]
    const before = JSON.parse(JSON.stringify(ops)) as unknown
    stampAuthorship(ops, { prompt: 'hi', sessionId: 's' })
    expect(ops).toEqual(before)
  })

  it('sanitizes an odd session id to a valid k8s label value', () => {
    expect(sanitizeLabelValue('  weird//id@!  ')).toBe('weird--id')
    expect(sanitizeLabelValue('a'.repeat(80)).length).toBe(63)
    const [out] = stampAuthorship([cdOp()], { sessionId: 'sess:with/bad*chars' })
    expect(metaOf(out).labels[AGENT_SESSION_LABEL]).toBe('sess-with-bad-chars')
  })
})
