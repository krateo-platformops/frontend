/**
 * The claim check's kernel. Two halves, weighted the way the risk is: the claims it MUST catch (the
 * 057 pod-sizing-23 sentence first), and the far larger set of ordinary replies it must NEVER flag —
 * offers, questions, futures, negations, conditionals and look-backs. A false notice teaches the
 * reader to ignore the line, so the negatives are the half that keeps the feature worth having.
 */
import { describe, expect, it } from 'vitest'

import { attemptOf, checkClaims, chipOutcome, claimNotice, claimRetryNudge, CLAIM_RULES, denialOutcome, findClaims, isRetryable, refusalReason, type TurnAction } from './claimCheck'
import type { EvidenceEntry } from './types'

/** The exact reply observed on krateo-057 (frontend 1.6.81) — no previewPage ever arrived. */
const POD_SIZING = 'I have authored and previewed the pod-sizing-23 page in the live sandbox drawer. You can review the layout there and tell me when to publish.'

const families = (text: string) => findClaims(text).map((claim) => claim.family)

describe('findClaims — claims it must catch', () => {
  it.each([
    [POD_SIZING, 'preview'],
    ['I previewed the page for you.', 'preview'],
    ["I've now previewed the blueprint.", 'preview'],
    ['I’ve previewed it — take a look.', 'preview'],
    ['I have built, linted and previewed the chart.', 'preview'],
    ['The page is now rendering in your preview drawer.', 'preview'],
    ['It is live in the sandbox preview.', 'preview'],
    ["I've opened it in the preview drawer.", 'preview'],
    ['The preview is now open on the right.', 'preview'],
    ["I've published the page.", 'publish'],
    ['I have opened a pull request against krateo-platformops/portal.', 'publish'],
    ['I opened a change request for review.', 'publish'],
    ['The blueprint has been published to GHCR.', 'publish'],
    ['The pull request has been opened.', 'publish'],
    ['I applied the change to the composition.', 'apply'],
    ["I've patched replicas to 3.", 'apply'],
    ['The resources have been applied.', 'apply'],
    ['I have bound it to a multi-stage RESTAction using quantity.jq.', 'compose'],
    ['I added a Table to the page.', 'compose'],
    ["I've moved the chart card into the page-root Flex.", 'compose'],
    ["I've updated values.schema.json with the new field.", 'chart'],
    ['I rewrote `templates/deployment.yaml` to add the probe.', 'chart'],
  ])('%s → %s', (text, family) => {
    expect(families(text)).toContain(family)
  })

  it('reports the words that made the claim', () => {
    expect(findClaims(POD_SIZING)).toEqual([{ family: 'preview', phrase: 'I have authored and previewed' }])
  })

  it('finds one claim per family even when the reply repeats itself', () => {
    expect(findClaims('I previewed it. I have previewed the page again.')).toHaveLength(1)
  })

  it('finds a claim that is not in the first sentence', () => {
    expect(families('Sure. Here is what I did. I have published the page.')).toEqual(['publish'])
  })
})

describe('findClaims — ordinary replies it must NEVER flag', () => {
  it.each([
    // offers and futures
    'I can preview the page for you.',
    'I will publish it once you confirm.',
    "I'll open a pull request when you are ready.",
    'I could apply this change for you.',
    'Want me to preview it first?',
    'Shall I publish?',
    'Should I apply the patch?',
    'To preview it, say "preview".',
    'Next, I need to preview the page before it can be published.',
    'I am going to preview the page now.',
    // negations
    "I haven't published anything yet.",
    'I have not previewed the page.',
    'I did not apply the change.',
    'Nothing has been published yet.',
    'The page has not been published.',
    'No pull request has been opened.',
    "The page isn't rendering in your preview drawer yet.",
    // conditionals and premises
    'Once it has been published, the page appears under Portal.',
    'If I previewed it, it would appear in the drawer.',
    'After the pull request has been opened, CI runs the lint.',
    'When the preview is ready, the drawer opens on the right.',
    // questions
    'Have I published it?',
    'Is it showing in the preview?',
    // looking back at an earlier turn
    'The page I previewed earlier had two tables.',
    'In my previous reply I published the blueprint; this one only explains it.',
    // the passive "applied" of a filter is navigation, not a write
    'I applied the status filter so only failing compositions show.',
    'The filter has been applied.',
    // describing the verbs in general
    'Publishing opens a pull request; previewing renders the page in a sandbox.',
    'A preview renders the page; a publish commits it.',
    'The portal applies the set after you confirm.',
    // quoting and code are not the agent speaking
    '> I have published the page\n\nThat line is what the old version used to say.',
    '```\nI have published the page\n```',
    // someone else did it
    'You previewed this page yesterday.',
    'The page you published is healthy.',
    // plain answers
    'The composition has 3 replicas and is Ready.',
    'Here are the widgets on this page: a Table and two Statistics.',
  ])('%s', (text) => {
    expect(findClaims(text)).toEqual([])
  })
})

describe('checkClaims — a claim is backed only by a successful action of its family', () => {
  const previewed: TurnAction = { outcome: 'applied', verb: 'previewPage' }

  it('flags the pod-sizing-23 reply when no action arrived', () => {
    expect(checkClaims(POD_SIZING, [])).toEqual([{ family: 'preview', outcome: 'missing', phrase: 'I have authored and previewed' }])
  })

  it('does not flag it when a previewPage ran', () => {
    expect(checkClaims(POD_SIZING, [previewed])).toEqual([])
  })

  it('any verb of the family backs the claim (previewBlueprint backs "previewed")', () => {
    expect(checkClaims('I previewed the chart.', [{ outcome: 'applied', verb: 'previewBlueprint' }])).toEqual([])
  })

  it('an action of ANOTHER family does not back it', () => {
    expect(checkClaims(POD_SIZING, [{ outcome: 'applied', verb: 'navigate' }])).toEqual([
      { family: 'preview', outcome: 'missing', phrase: 'I have authored and previewed' },
    ])
  })

  it('a REFUSED preview leaves a claim of success unbacked', () => {
    expect(checkClaims(POD_SIZING, [{ outcome: 'refused', verb: 'previewPage' }])[0]?.outcome).toBe('refused')
  })

  it('a FAILED apply leaves "I applied" unbacked', () => {
    expect(checkClaims('I applied the change.', [{ outcome: 'failed', verb: 'applyResourceSet' }])[0]?.outcome).toBe('failed')
  })

  it('a publish the PERSON declined leaves "I have published" unbacked — as declined', () => {
    expect(checkClaims("I've published the page.", [{ outcome: 'declined', verb: 'publishPage' }])).toEqual([
      { family: 'publish', outcome: 'declined', phrase: "I've published" },
    ])
  })

  it('names the person\'s decision first when several actions failed differently', () => {
    const actions: TurnAction[] = [{ outcome: 'refused', verb: 'publishPage' }, { outcome: 'declined', verb: 'applyResourceSet' }]
    expect(checkClaims('I have published it.', actions)[0]?.outcome).toBe('declined')
  })

  it('a proposal the one-action cap dropped does not back a claim', () => {
    expect(checkClaims('I previewed it.', [{ outcome: 'dropped', verb: 'previewPage' }])[0]?.outcome).toBe('dropped')
  })

  it('one success among failures backs it', () => {
    expect(checkClaims('I previewed it.', [{ outcome: 'refused', verb: 'previewPage' }, previewed])).toEqual([])
  })

  it('checks each family independently', () => {
    const text = "I've previewed the page and I have opened a pull request."
    expect(checkClaims(text, [previewed])).toEqual([{ family: 'publish', outcome: 'missing', phrase: 'I have opened a pull request' }])
  })

  it('an approved HITL write backs "I applied" — the agent did it through its own tool', () => {
    expect(checkClaims('I applied the manifest.', [{ outcome: 'applied', verb: 'approval' }])).toEqual([])
  })

  it('a denied HITL write does not', () => {
    expect(checkClaims('I applied the manifest.', [{ outcome: 'declined', verb: 'approval' }])[0]?.outcome).toBe('declined')
  })

  it('a write tool in the evidence backs publish/apply, but never a preview', () => {
    const evidence: EvidenceEntry[] = [{ done: true, id: '1', kind: 'cluster', tool: 'k8s_apply_manifest' }]
    expect(checkClaims('I applied the manifest.', [], evidence)).toEqual([])
    expect(checkClaims(POD_SIZING, [], evidence)).toHaveLength(1)
  })

  it('a FAILED write tool does not back it', () => {
    const evidence: EvidenceEntry[] = [{ done: true, failed: true, id: '1', kind: 'cluster', tool: 'k8s_apply_manifest' }]
    expect(checkClaims('I applied the manifest.', [], evidence)).toHaveLength(1)
  })

  it('a read-only tool in the evidence backs nothing', () => {
    const evidence: EvidenceEntry[] = [{ done: true, id: '1', kind: 'cluster', tool: 'k8s_get_resources' }]
    expect(checkClaims("I've published the page.", [], evidence)).toHaveLength(1)
  })

  it('text that is not a claim is never flagged, whatever the turn did', () => {
    expect(checkClaims('I can preview the page for you.', [])).toEqual([])
    expect(checkClaims('Shall I publish?', [{ outcome: 'refused', verb: 'publishPage' }])).toEqual([])
  })
})

describe('chipOutcome — the bridge outcome, read from the chip', () => {
  it.each([
    [{ label: 'Page preview — pod-sizing', readOnly: true, verb: 'previewPage' }, 'applied'],
    [{ label: 'previewPage — this portal did not run it', readOnly: true, verb: 'previewPage' }, 'refused'],
    [{ label: 'composeBind — this portal did not run it (no such widget)', readOnly: true, verb: 'composeBind' }, 'refused'],
    [{ label: 'preview blocked — 2 validation errors', readOnly: true, verb: 'previewPage' }, 'refused'],
    [{ label: 'preview denied — drafts fall outside the sandbox write scope', readOnly: true, verb: 'previewPage' }, 'refused'],
    [{ label: 'preview apply failed — 403', readOnly: false, verb: 'previewPage' }, 'failed'],
    [{ label: 'preview unavailable — render service not configured', readOnly: true, verb: 'previewBlueprint' }, 'refused'],
    [{ label: 'preview demo (draft rejected)', readOnly: true, verb: 'previewBlueprint' }, 'refused'],
    [{ label: 'preview demo (render failed)', previewFailed: true, readOnly: true, verb: 'previewBlueprint' }, 'failed'],
    [{ failure: 'forbidden', label: 'Publish', readOnly: false, verb: 'applyResourceSet' }, 'failed'],
  ] as const)('%o → %s', (chip, outcome) => {
    expect(chipOutcome(chip)).toBe(outcome)
  })

  it('a cancelled destination form is the person\'s decision; any other denial is a refusal', () => {
    expect(denialOutcome('Publish cancelled — no destination chosen')).toBe('declined')
    expect(denialOutcome('denied — preview the draft first')).toBe('refused')
  })
})

describe('the notice and the retry', () => {
  it('says what was claimed and what is true', () => {
    expect(claimNotice({ family: 'preview', outcome: 'missing', phrase: 'x' })).toBe('Autopilot said it previewed this, but no preview was produced.')
    expect(claimNotice({ family: 'preview', outcome: 'refused', phrase: 'x' })).toBe('Autopilot said it previewed this, but the preview did not succeed.')
    expect(claimNotice({ family: 'publish', outcome: 'declined', phrase: 'x' })).toBe('Autopilot said it published this, but the publish was not confirmed, so nothing was published.')
    expect(claimNotice({ family: 'apply', outcome: 'failed', phrase: 'x' })).toBe('Autopilot said it applied this change, but the change did not go through.')
  })

  it('every family has notice copy', () => {
    for (const rule of CLAIM_RULES) {
      expect(claimNotice({ family: rule.family, outcome: 'missing', phrase: 'x' })).toMatch(/^Autopilot said it .+, but .+\.$/)
    }
  })

  it('offers Retry only when nothing arrived', () => {
    expect(isRetryable({ family: 'preview', outcome: 'missing', phrase: 'x' })).toBe(true)
    expect(isRetryable({ family: 'preview', outcome: 'refused', phrase: 'x' })).toBe(false)
    expect(isRetryable({ family: 'publish', outcome: 'declined', phrase: 'x' })).toBe(false)
  })

  it('the retry nudge quotes the claim, names the verb, and carries no brace placeholder', () => {
    const nudge = claimRetryNudge([{ family: 'preview', outcome: 'missing', phrase: 'I have authored and previewed' }])
    expect(nudge).toContain('"I have authored and previewed"')
    expect(nudge).toContain('previewPage')
    expect(nudge).toMatch(/say plainly that it was NOT done/)
    expect(nudge).not.toMatch(/[{}]/)
  })
})

describe('a refusal described as a success — the controller family', () => {
  /** The exact chip and prose observed on krateo-057 (frontend 1.6.89, autopilot 0.6.6). */
  const MAP_CHIP = { label: 'controllerMapVerb — this portal did not run it (GET /pets/{petId} is not an operation of the document.)', readOnly: true, refused: true, verb: 'controllerMapVerb' }
  const MAP_PROPOSAL = { kind: 'Pet', method: 'GET', path: '/pets/{petId}', restAction: 'get', verb: 'controllerMapVerb' }
  const MAP_REPLY = 'Mapped the get verb for kind Pet to GET /pets/{petId}.'
  const refusedMap: TurnAction = { attempt: attemptOf(MAP_PROPOSAL), outcome: chipOutcome(MAP_CHIP), reason: refusalReason(MAP_CHIP), verb: 'controllerMapVerb' }

  it('the 057 reply and chip: flagged, and the notice names the refusal', () => {
    const claims = checkClaims(MAP_REPLY, [refusedMap])
    expect(claims).toHaveLength(1)
    expect(claimNotice(claims[0])).toBe('The reply says it mapped get → GET /pets/{petId}, but the portal refused it: GET /pets/{petId} is not an operation of the document.')
  })

  it('the verbs-check-5 happy path, every chip applied: nothing flagged', () => {
    const text = 'Starting the verbs-check-5 controller draft from the Petstore document. Pet update is PUT /pet. Left findby out of Pet. Previewed verbs-check-5 — the drawer shows the RestDefinition.'
    const actions: TurnAction[] = ['controllerStart', 'controllerPlace', 'controllerMapVerb', 'controllerMapVerb', 'previewRestDef'].map((verb) => ({ outcome: 'applied', verb }))
    expect(findClaims(text).map((claim) => claim.family)).toEqual(['controller'])
    expect(checkClaims(text, actions)).toEqual([])
  })

  it('a refused previewRestDef and "I previewed it": flagged', () => {
    const chip = { label: 'previewRestDef — this portal did not run it (no controller draft is open)', readOnly: true, refused: true, verb: 'previewRestDef' }
    const claims = checkClaims('I previewed it.', [{ outcome: chipOutcome(chip), reason: refusalReason(chip), verb: 'previewRestDef' }])
    expect(claims).toEqual([{ family: 'preview', outcome: 'refused', phrase: 'I previewed', reason: 'no controller draft is open' }])
    expect(claimNotice(claims[0])).toBe('The reply says it previewed this, but the portal refused it: no controller draft is open.')
  })

  it('one applied and one refused attempt of the same family: the applied one backs it', () => {
    expect(checkClaims(MAP_REPLY, [refusedMap, { outcome: 'applied', verb: 'controllerPlace' }])).toEqual([])
  })

  it('a controller claim with NO controller attempt is never flagged — those words are too ordinary alone', () => {
    expect(checkClaims('I confirmed the identifiers with you earlier. Placed Pet.', [])).toEqual([])
    expect(checkClaims(MAP_REPLY, [{ outcome: 'applied', verb: 'navigate' }])).toEqual([])
  })

  it('"I bound petId to status.id" with the bind refused is one notice, not also a page-draft one', () => {
    const claims = checkClaims('I bound petId to status.id.', [{ outcome: 'refused', verb: 'controllerBindId' }])
    expect(claims.map((claim) => claim.family)).toEqual(['controller'])
  })

  it('the chip field marks a refusal whatever its label says', () => {
    expect(chipOutcome({ label: 'Pet get is GET /pets/{petId}', readOnly: true, refused: true, verb: 'controllerMapVerb' })).toBe('refused')
  })

  it('without a reason the notice keeps the family copy', () => {
    expect(claimNotice({ family: 'controller', outcome: 'refused', phrase: 'x' })).toBe('Autopilot said it changed the controller draft, but the portal refused the edit.')
  })

  it.each([
    [MAP_REPLY],
    ['I mapped get to GET /pets/{petId}.'],
    ['- Mapped the get verb for kind Pet to GET /pets/{petId}.'],
    ['**Placed** Pet from the pet group.'],
    ['I have left findby out of Pet.'],
    ['I settled the verbs for Pet.'],
    ['Pet get is now mapped.'],
    ['The identifiers have been excluded.'],
  ])('claims: %s', (text) => {
    expect(findClaims(text).map((claim) => claim.family)).toContain('controller')
  })

  it.each([
    'Mapped verbs are listed in the inspector.',
    'Placed kinds appear on the left.',
    'I can map get to GET /pets/{petId}.',
    'Shall I leave findby out?',
    'I have not mapped get yet.',
    'Once mapped, the verb appears in the RestDefinition.',
    'If I mapped get to GET /pets/{petId}, the preview would fail.',
    'I confirmed with the person that the cluster is Ready.',
    'Mapping get needs an operation of the document.',
    'The get verb is not mapped.',
  ])('does not claim: %s', (text) => {
    expect(findClaims(text).map((claim) => claim.family)).not.toContain('controller')
  })
})
