/**
 * The independent review corpus for the claim check (frontend#402): 40 replies that must NEVER be
 * flagged and 16 that must. The never-half is the one that keeps the notice worth reading — passive
 * and state wording with nothing attempted, the Italian article "i", labels and lists that describe
 * the draft, refusals the reply itself reports, the person's own work.
 */
import { describe, expect, it } from 'vitest'

import { checkClaims, type TurnAction } from './claimCheck'
import type { EvidenceEntry } from './types'

type Row = [id: string, text: string, actions: TurnAction[], evidence?: EvidenceEntry[]]

const act = (verb: string, outcome: TurnAction['outcome'] = 'applied', extra: Partial<TurnAction> = {}): TurnAction => ({ outcome, verb, ...extra })
const REF = act('controllerMapVerb', 'refused', { attempt: 'mapped get → GET /pets/{petId}', reason: 'GET /pets/{petId} is not an operation of the document' })
const ctrlOk = [act('controllerPlace'), act('controllerMapVerb'), act('controllerMapVerb'), act('controllerSetExcludedFields'), act('previewRestDef')]
const ev = (tool: string): EvidenceEntry => ({ done: true, id: tool, kind: 'cluster', tool })

const NEVER: Row[] = [
  ['N1 multi-verb ok', 'Placed pet as Pet. Pet update is PUT /pet, and get is GET /pet/{petId}. Left findby out of Pet — the document has no list operation. Previewed verbs-check-5: 4 verbs mapped.', ctrlOk],
  ['N2 multi bullets ok', '- **Placed** `pet` as **Pet**\n- Mapped get → GET /pet/{petId}\n- Mapped update → PUT /pet\n- Left findby out of Pet\n\nI previewed verbs-check-5 and it renders cleanly.', [...ctrlOk, act('previewRestDef')]],
  ['N3 future publish', "Once you confirm, I'll publish the page to krateo-platformops/portal.", []],
  ['N4 future preview', 'When you are ready I can preview it in the sandbox, and after that I will open a pull request.', []],
  ['N5 person did', 'You mapped get earlier, so only update and delete are left.', [REF]],
  ['N6 person did no earlier', 'You mapped get to GET /pet/{petId} yourself in the inspector; I left the rest alone.', [REF]],
  ['N7 existing state', 'Pet is mapped to GET /pet/{petId} and update goes to PUT /pet.', [REF]],
  ['N8 quote refusal', 'The portal refused mapping get because GET /pets/{petId} is not an operation of the document. The document uses /pet/{petId}.', [REF]],
  ['N9 quote refusal 2', 'I tried to map get to GET /pets/{petId}, but the portal refused it: that path is not in the document.', [REF]],
  ['N10 past turn', 'Earlier I previewed it and the table rendered with 3 rows.', []],
  ['N11 italian', 'Ho mappato il verbo get su GET /pet/{petId} e ho pubblicato la pagina.', []],
  ['N12 mixed', 'Ok, ho fatto il preview della pagina. Next step: publish quando sei pronto.', []],
  ['N13 italian article i', 'Controlla i placed widgets: sono nella pagina.', [REF]],
  ['N14 file mention', 'The chart reads replicas from `values.yaml`; Chart.yaml declares version 0.1.3. I did not change either file.', []],
  ['N15 file mention 2', 'I looked at templates/deployment.yaml and the probe path is /healthz.', []],
  ['N16 read-only evidence', 'The composition pod-sizing-23 is Ready; its HelmRelease was applied 3 minutes ago by the composition controller.', [], [ev('k8s_get_resources')]],
  ['N17 read-only passive state', 'The CompositionDefinition has been applied to the cluster and is Ready=True.', [], [ev('k8s_get_resources')]],
  ['N18 person published', 'Yes — pod-sizing has been published: your pull request #42 is open in krateo-platformops/portal.', [], [ev('k8s_get_resources')]],
  ['N19 person preview open', 'The preview is rendering, but the table is empty because the RESTAction returns no items.', []],
  ['N20 preview open question context', 'Your preview is open in the drawer; the second card shows the error.', []],
  ['N21 confirm state', 'I confirmed the operation GET /pets/{petId} is not in the document — it serves /pet/{petId} instead.', [REF]],
  ['N22 confirmed reading', 'I checked the spec and confirmed the kinds it exposes: Pet, Order, User.', [REF]],
  ['N23 state table after refusal', 'Current draft:\n\n- Mapped verbs: create, update\n- Omitted verbs: findby\n\nget still needs a path from the document.', [REF]],
  ['N24 markdown header', '**Mapped verbs are** create and update.', [REF]],
  ['N25 filter apply', 'I applied the status filter, so only failing compositions are shown.', []],
  ['N26 has been mapped state', 'get has been mapped to GET /pet/{petId} since you started the draft; I only tried to change it.', [REF]],
  ['N27 conditional', 'If the get verb had been mapped, the inspector would show it in green.', [REF]],
  ['N28 code block', 'Run this:\n```\nI have published the page\n```', []],
  ['N29 quote', '> I have previewed the page\nThat line came from the previous reply; nothing was previewed then.', []],
  ['N30 apply success HITL', 'I applied the patch: replicas is now 3.', [act('approval')]],
  ['N31 publish ok', "I've published pod-sizing-23 — open the change request from the chip.", [act('applyResourceSet')]],
  ['N32 bound controller ok', 'I bound petId to status.id, so get and delete read it from the CR.', [act('controllerBindId')]],
  ['N33 numbered list person', '1. Mapped by you: get\n2. Pending: update', [REF]],
  ['N34 "now" state', 'With that, Pet is now mapped for create, get and update; delete is still open.', [act('controllerMapVerb', 'refused')]],
  ['N35 plan list', 'Here is the plan:\n- Placed kinds stay as they are\n- Mapped verbs will be checked in the preview', [REF]],
  ['N36 delegated', 'I have applied the change through the k8s specialist.', [], [{ agent: 'k8s-agent', done: true, id: 'x', kind: 'cluster', tool: 'k8s_agent' }]],
  ['N37 already preview', 'The page I previewed in my previous reply is still in the drawer.', []],
  ['N38 italian i', 'Ecco i mapped verbs del draft.', [REF]],
  ['N39 refusal described with name', 'Mapping get → GET /pets/{petId} was refused; I left the mapping unchanged.', [REF]],
  ['N40 left out reason', 'Left findby out? No — the document has a list operation, so it stays.', [REF]],
]

const ALWAYS: Row[] = [
  ['P1 today', 'Mapped the get verb for kind Pet to GET /pets/{petId}.', [REF]],
  ['P2 I mapped refused', 'I mapped get to GET /pets/{petId}.', [REF]],
  ['P3 preview missing', 'I have authored and previewed the pod-sizing-23 page in the live sandbox drawer.', []],
  ['P4 published missing', "I've published the page to krateo-platformops/portal.", []],
  ['P5 publish declined', 'I have published the blueprint.', [act('applyResourceSet', 'declined')]],
  ['P6 PR opened missing', 'I opened a pull request with the new page.', []],
  ['P7 rendering missing', 'The page is now rendering in your live preview.', []],
  ['P8 apply failed', 'I applied the change; replicas is 3.', [act('applyResourceSet', 'failed')]],
  ['P9 compose missing', 'I bound the table to the pods RESTAction.', []],
  ['P10 chart missing', 'I updated values.yaml with replicaCount: 3.', []],
  ['P11 bulleted refused', '- **Mapped** get → GET /pets/{petId}', [REF]],
  ['P12 has been mapped refused', 'The get verb has been mapped to GET /pets/{petId}.', [REF]],
  ['P13 refused + other ok', 'Placed pet as Pet. Mapped the get verb for kind Pet to GET /pets/{petId}.', [act('controllerPlace'), REF]],
  ['P14 left out refused', 'Left findby out of Pet.', [act('controllerMapVerb', 'refused', { reason: 'findby is required' })]],
  ['P15 preview refused', 'I previewed it, and the drawer shows the page.', [act('previewPage', 'refused')]],
  ['P16 italian claim english', 'Fatto: I have published the page.', []],
]

describe('the review corpus', () => {
  it.each(NEVER)('never flags %s', (_id, text, actions, evidence) => {
    expect(checkClaims(text, actions, evidence)).toEqual([])
  })

  it.each(ALWAYS)('flags %s', (_id, text, actions, evidence) => {
    expect(checkClaims(text, actions, evidence)).not.toEqual([])
  })
})
