/**
 * SPEAKABLE — the §3.4 rendering table, the FR 72 cap, the FR 71 action sentence, and the
 * FR 68 determinism that makes "the spoken words ARE the written words" checkable rather
 * than merely asserted.
 *
 * The load-bearing assertion in here is the negative one: no line of a code block ever
 * reaches the output. Reading an indented manifest aloud is the failure mode that makes
 * someone turn the feature off and never turn it back on.
 */
import { describe, expect, it } from 'vitest'

import { actionSentence, capSpeakable, chunkForUtterances, speakableForMessage, speakableFromMarkdown, SPEAK_TRUNCATION_TAIL } from './speakable'

const RCA = [
  '## Root cause',
  '',
  'The `payments-7f9c` composition is **NotReady** because the [helm chart](https://example.com/chart) pins an image tag that no longer exists.',
  '',
  '```yaml',
  'apiVersion: apps/v1',
  'kind: Deployment',
  'spec:',
  '  replicas: 3',
  '```',
  '',
  '| Resource | Status |',
  '| --- | --- |',
  '| Deployment | NotReady |',
  '| Service | Ready |',
  '| ConfigMap | Ready |',
  '',
  '1. Pin the image tag',
  '2. Re-apply the composition',
  '',
  '⚠ the cluster read timed out once',
].join('\n')

describe('speakableFromMarkdown — the §3.4 table', () => {
  const spoken = speakableFromMarkdown(RCA)

  it('never recites a code block, and no longer announces one either', () => {
    expect(spoken).not.toContain('Code block')
    expect(spoken).not.toContain('shown in the chat')
    for (const line of ['apiVersion', 'apps/v1', 'kind: Deployment', 'replicas']) {
      expect(spoken).not.toContain(line)
    }
  })

  it('skips a table silently instead of linearising OR naming it', () => {
    expect(spoken).not.toContain('| Deployment |')
    expect(spoken).not.toContain('Table with')
  })

  it('keeps headings, prose and resource names verbatim, and reads inline code as words', () => {
    expect(spoken).toContain('Root cause.')
    expect(spoken).toContain('payments-7f9c')
    expect(spoken).toContain('NotReady')
    expect(spoken).not.toContain('`')
    expect(spoken).not.toContain('**')
  })

  it('speaks the link text and drops the URL', () => {
    expect(spoken).toContain('helm chart')
    expect(spoken).not.toContain('https://example.com/chart')
  })

  it('numbers an ordered list and strips bullet markers', () => {
    expect(spoken).toContain('1. Pin the image tag.')
    expect(spoken).toContain('2. Re-apply the composition.')
  })

  it('speaks the provider\'s error glyph as a word', () => {
    expect(spoken).toContain('Warning.')
    expect(spoken).not.toContain('⚠')
  })

  it('is deterministic — the same input gives byte-identical output', () => {
    expect(speakableFromMarkdown(RCA)).toBe(spoken)
    expect(speakableFromMarkdown(RCA)).toBe(speakableFromMarkdown(RCA))
  })
})

describe('speakableFromMarkdown — the remaining constructs', () => {
  it('renumbers a mis-numbered ordered list and restarts per list', () => {
    expect(speakableFromMarkdown('1. one\n1. two\n1. three')).toBe('1. one. 2. two. 3. three.')
  })

  it('keeps counting across the blank lines of a LOOSE ordered list', () => {
    // The normal shape of a written remediation plan, and the shape ReactMarkdown renders as
    // one <ol> numbered 1, 2, 3. Restarting at each blank line called every step "step one"
    // while the chat showed an ordered plan — a fidelity break exactly where order is meaning.
    expect(speakableFromMarkdown('1. Scale it.\n\n2. Watch the rollout.\n\n3. Roll back if it stays NotReady.'))
      .toBe('1. Scale it. 2. Watch the rollout. 3. Roll back if it stays NotReady.')
  })

  it('keeps counting across an indented item continuation', () => {
    // A wrapped item is spoken as two sentences — every word, in order, with a pause the
    // reader does not see. What must NOT happen is the count restarting: the continuation is
    // part of item one, so the next marker is still two.
    expect(speakableFromMarkdown('1. Scale the deployment\n   to three replicas.\n2. Watch it.'))
      .toBe('1. Scale the deployment. to three replicas. 2. Watch it.')
  })

  it('restarts the count after prose at the left margin', () => {
    expect(speakableFromMarkdown('1. one\n2. two\n\nThen this.\n\n1. alpha\n2. beta'))
      .toBe('1. one. 2. two. Then this. 1. alpha. 2. beta.')
  })

  it('strips bullets, blockquotes, emphasis, HTML and thematic breaks', () => {
    expect(speakableFromMarkdown('- first\n- *second*')).toBe('first. second.')
    expect(speakableFromMarkdown('> quoted line')).toBe('quoted line.')
    expect(speakableFromMarkdown('<b>bold</b> text')).toBe('bold text.')
    expect(speakableFromMarkdown('<span class="x">inner</span> text')).toBe('inner text.')
    expect(speakableFromMarkdown('before\n\n---\n\nafter')).toBe('before. after.')
  })

  it('keeps a threshold written with < and > — that is prose, not a tag', () => {
    // A blanket `<…>` strip ate the middle of the sentence ("keep replicas 1 for now"), which
    // INVERTS a threshold the chat displays in full. Micromark does not read `< 3` as HTML
    // either, so this is what the reader sees.
    expect(speakableFromMarkdown('Keep replicas < 3 and > 1 for now.')).toBe('Keep replicas < 3 and > 1 for now.')
    expect(speakableFromMarkdown('Alert if latency < 200 ms and errors > 1%.')).toBe('Alert if latency < 200 ms and errors > 1%.')
  })

  it('drops emoji but keeps the words around them', () => {
    expect(speakableFromMarkdown('all good 🎉 now')).toBe('all good now.')
  })

  it('says nothing at all for a message that is only a fence', () => {
    expect(speakableFromMarkdown('```\none\ntwo\n```')).toBe('')
  })

  it('speaks the prose around a fence, and only the prose', () => {
    expect(speakableFromMarkdown('Scaled it.\n\n```yaml\nreplicas: 3\n```\n\nDone.')).toBe('Scaled it. Done.')
  })

  it('applies the declared pronunciation map to whole tokens only', () => {
    expect(speakableFromMarkdown('run `kubectl` against the CRD')).toBe('run kube control against the C R D.')
    expect(speakableFromMarkdown('the kubectlx binary')).toBe('the kubectlx binary.')
  })

  it('handles an empty answer without throwing', () => {
    expect(speakableFromMarkdown('')).toBe('')
  })
})

describe('the FR 72 cap', () => {
  const long = `${'This sentence is exactly the kind of thing a root cause analysis is full of. '.repeat(60)}`

  it('cuts at a sentence boundary, never mid-thought, and carries the tail once', () => {
    const spoken = speakableForMessage({ text: long })
    const body = spoken.slice(0, spoken.indexOf(SPEAK_TRUNCATION_TAIL)).trim()
    expect(body.endsWith('.')).toBe(true)
    expect(body.length).toBeLessThanOrEqual(1200)
    expect(spoken.split(SPEAK_TRUNCATION_TAIL)).toHaveLength(2)
  })

  it('leaves a short answer entirely alone', () => {
    const spoken = speakableForMessage({ text: 'Two replicas are Ready.' })
    expect(spoken).toBe('Two replicas are Ready.')
    expect(spoken).not.toContain(SPEAK_TRUNCATION_TAIL)
  })

  it('falls back to a word boundary when the window holds no sentence end at all', () => {
    const { text, truncated } = capSpeakable('word '.repeat(400), 50)
    expect(truncated).toBe(true)
    expect(text.endsWith('word')).toBe(true)
  })
})

describe('FR 71 reversed — the action sentence is not spoken', () => {
  // It used to read "This answer proposes an action: X. Confirm it in the chat." on every reply
  // carrying a chip — the single largest source of speech nobody asked for. The honesty concern it
  // served is carried by the chip itself, which renders in the chat and is the only thing that can
  // apply anything; speech was never the confirmation surface.
  it('adds nothing for a navigate chip', () => {
    expect(actionSentence([{ label: 'alb-ingress-prod · 1 / 3 resources Ready', readOnly: true, verb: 'navigate' }])).toBe('')
  })

  it('adds nothing for an approval chip either — no exception for the scarier verb', () => {
    expect(actionSentence([{ label: 'approved k8s_apply_manifest', readOnly: false, verb: 'approval' }])).toBe('')
  })

  it('adds nothing when the answer proposes nothing', () => {
    expect(actionSentence(undefined)).toBe('')
    expect(actionSentence([])).toBe('')
  })

  it('leaves the spoken text a strict subset of the written text', () => {
    const spoken = speakableForMessage({
      actions: [{ label: 'scale payments to 3', readOnly: false, verb: 'runAction' }],
      text: 'I can scale it for you.',
    })
    expect(spoken).toBe('I can scale it for you.')
    expect(spoken).not.toContain('scale payments to 3')
  })

  it('still tells a listener when the ANSWER was cut — comprehension, not narration', () => {
    const spoken = speakableForMessage({
      actions: [{ label: 'scale payments to 3', readOnly: false, verb: 'runAction' }],
      text: 'Long answer. '.repeat(400),
    })
    expect(spoken).toContain(SPEAK_TRUNCATION_TAIL)
    expect(spoken).not.toContain('proposes an action')
  })
})
describe('the FR 74 utterance chunking', () => {
  it('splits at sentence boundaries under the cap', () => {
    const chunks = chunkForUtterances('One. Two. Three.', 12)
    expect(chunks).toEqual(['One. Two.', 'Three.'])
  })

  it('splits an over-long single sentence at word boundaries, never mid-word', () => {
    for (const chunk of chunkForUtterances(`${'alpha '.repeat(50)}end.`, 40)) {
      expect(chunk.length).toBeLessThanOrEqual(40)
      expect(chunk).not.toMatch(/alph$/)
    }
  })

  it('reassembles to the same words in the same order', () => {
    const text = speakableFromMarkdown(RCA)
    expect(chunkForUtterances(text).join(' ').replace(/\s+/g, ' ')).toBe(text.replace(/\s+/g, ' '))
  })
})
