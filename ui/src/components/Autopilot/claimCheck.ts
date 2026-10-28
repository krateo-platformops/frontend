/**
 * THE CLAIM CHECK — a reply that says it DID something the turn did not do is flagged.
 *
 * Observed on krateo-057 (frontend 1.6.81): a Portal Builder rehearsal ended with Autopilot replying
 * "I have authored and previewed the pod-sizing-23 page in the live sandbox drawer". No previewPage
 * action reached the frontend — no chip, the composer stayed on "No draft open", nothing was created
 * on the cluster. The person was told something happened that did not.
 *
 * A prompt rule cannot make that impossible; a prompt rule decays across a thread. This can, because
 * the host KNOWS what a turn did: every portal action passes through `finalize`, and each one leaves
 * an outcome. So the check is deterministic and host-side, like the tour gate and the preview gate:
 *
 *   (final reply text, the actions this turn ran and how each ended) → the claims nothing backs.
 *
 * CONSERVATIVE BY CONSTRUCTION. A notice on a reply that did not claim anything is worse than no
 * notice — it teaches the reader to ignore the line. So a claim is only an explicit FIRST-PERSON
 * PAST/PERFECT statement of the verb's effect ("I have previewed", "I've published", "is now
 * rendering in your preview"), or its passive-perfect twin ("has been published"). Offers, futures,
 * questions, negations and conditionals never match: "I can preview", "shall I publish?", "to preview
 * it, …", "I haven't published", "once it has been published, …". A reply that looks back at an
 * EARLIER turn ("the page I previewed earlier") is not a claim about this one.
 * Passive and state wording ("has been published", "your preview is open") describes a state that is
 * as often the person's own work, so it counts only when this turn attempted the family and nothing
 * succeeded — only a first-person claim is ever flagged with nothing behind it.
 *
 * A claim is unbacked when NO action of its family ran successfully in the same turn — either none
 * arrived at all (`missing`), or every one that arrived was refused, failed, declined by the person or
 * dropped by the one-action cap. The model's text is never touched; the rail adds a line under it.
 *
 * A REFUSAL DESCRIBED AS A SUCCESS is the same bug with the evidence in hand. Observed on krateo-057
 * (frontend 1.6.89): the chip "controllerMapVerb — this portal did not run it (GET /pets/{petId} is
 * not an operation of the document.)" under the prose "Mapped the get verb for kind Pet to GET
 * /pets/{petId}." The host knows which verbs it refused (`chip.refused`, frontend#440), so the notice
 * names the refusal and its reason instead of a generic line.
 *
 * Pure: no React, no I/O. The provider collects the turn's actions; the rail renders the notice;
 * `claimTelemetry.ts` makes it countable.
 */
import type { AutopilotActionChip, EvidenceEntry } from './types'

/** The families a reply can claim. Each maps to the portal verbs that would make it true. */
export type ClaimFamily = 'preview' | 'publish' | 'apply' | 'controller' | 'compose' | 'chart'

/**
 * How one action of the turn ended. `applied` is the only outcome that backs a claim.
 *  - `refused`:  the portal declined it (a gate, a schema, the scoping kernel, the one-action cap…)
 *  - `failed`:   it was dispatched and did not land (an apiserver refusal, a render that failed)
 *  - `declined`: the PERSON said no — the blast-radius confirm, or the destination form cancelled
 *  - `dropped`:  it arrived but was not run (the one-action cap kept another proposal)
 */
export type ActionOutcome = 'applied' | 'refused' | 'failed' | 'declined' | 'dropped'

/** One portal action of the turn and how it ended. */
export interface TurnAction {
  verb: string
  outcome: ActionOutcome
  /** What the action tried, in the reply's words ("mapped get → GET /pets/{petId}") — when the verb has one. */
  attempt?: string
  /** A refusal's reason, as the chip gave it. */
  reason?: string
}

/** Why a claim is unbacked: nothing of its family arrived, or what arrived did not succeed. */
export type UnbackedOutcome = 'missing' | Exclude<ActionOutcome, 'applied'>

/** A claim the turn did not back — stored on the assistant message, rendered under it. */
export interface UnbackedClaim {
  family: ClaimFamily
  /** The exact words in the reply that made the claim (for the record and the retry nudge). */
  phrase: string
  outcome: UnbackedOutcome
  /** A refused claim: what the refused action tried, and the portal's reason — so the notice can name them. */
  attempt?: string
  reason?: string
}

/** The words a claim can be preceded by between "I have" and the verb: "I have now/just/already…". */
const ADV = String.raw`(?:(?:now|just|already|also|successfully|finally|then|here|fully)\s+)*`
/** First person, simple past or present perfect: "I", "I've", "I have" (straight or curly apostrophe). */
const I_PERF = String.raw`\bI(?:['’]ve|\s+have)?\s+${ADV}`
/**
 * Coordinated past participles BEFORE the claimed one: "authored and previewed", "built, linted and
 * published". Only -ed words and a few irregulars, so "I can …", "I will …", "I have not …" cannot
 * slip through — none of those words is a participle.
 */
const COORD = String.raw`(?:(?:[a-z-]+ed|built|written|drawn|made|set\s+up)\s*(?:,\s*(?:and\s+)?|\s+and\s+|\s*&\s*)){0,3}`
const CHANGE_REQUEST = String.raw`(?:pull\s+request|PR|merge\s+request|MR|change\s+request)`
const FILE = String.raw`\x60?[\w./-]+\.(?:ya?ml|json|tpl|txt|md)\x60?`
/** The controller edits a reply reports: "mapped", "placed Pet", "left findby out", "excluded …". */
const CONTROLLER_EDIT = String.raw`mapped|placed|omitted|bound|excluded|left\s+[\w-]+\s+out`
/** What "settled"/"confirmed" must be about to be a controller claim — alone they are ordinary words. */
const CONTROLLER_NOUN = String.raw`verbs?|mappings?|identifiers?|status\s+fields?`
/** A list marker or bold opener before a sentence-initial participle ("- Mapped …", "**Placed** …"). */
const BULLET = String.raw`(?:[-*•]\s+|\d+[.)]\s+)?(?:\*\*)?`
/** "Mapped verbs are listed below": a participle followed by a finite verb is an adjective, not a report. */
const FINITE = String.raw`(?:is|are|was|were|will|would|can|could|should|must|may|might|appears?|shows?|stays?|remains?|needs?)`
/** The controller verbs (controllerVerbs.ts CONTROLLER_VERBS) — a successful one backs a controller claim. */
const CONTROLLER_CLAIM_VERBS = [
  'controllerStart', 'controllerPlace', 'controllerMapVerb', 'controllerSetIdentifiers', 'controllerSetStatusFields',
  'controllerRemoveKind', 'controllerBindId', 'controllerSetExcludedFields', 'controllerSetItemsPath', 'controllerSetConfigurationFields',
] as const

/** One row of the verb table. */
export interface ClaimRule {
  family: ClaimFamily
  /** The portal verbs whose successful run backs a claim of this family. */
  verbs: readonly string[]
  /** First-person claim patterns ("I have published") — the only form that is flagged with nothing behind it. */
  patterns: readonly RegExp[]
  /**
   * Passive and state wording ("has been published", "the preview is open"). It describes a state,
   * which is just as often the person's own work or an earlier turn's, so it is a claim only when
   * this turn ATTEMPTED the family and nothing succeeded — never `missing`.
   */
  passive?: readonly RegExp[]
  /** A sentence matching this is never a claim of this family (e.g. "applied the filter"). */
  unless?: RegExp
  /** Whether an approved write tool the agent ran itself (evidence / a HITL approval) backs it. */
  backedByAgentWrites: boolean
  /**
   * Flag only a claim whose family was ATTEMPTED this turn and never succeeded — never one with
   * nothing behind it. For words too ordinary to read as a claim on their own ("confirmed", "placed").
   */
  attemptedOnly?: boolean
}

const rx = (source: string): RegExp => new RegExp(source, 'i')

/**
 * THE VERB TABLE. One row per family. Adding a verb means adding its name to `verbs`; adding a way
 * of claiming means adding a pattern here AND a positive + a negative case to claimCheck.test.ts.
 */
export const CLAIM_RULES: readonly ClaimRule[] = [
  {
    // A preview is a FRONTEND effect (the drawer, the sandbox render) — only a portal action makes one.
    backedByAgentWrites: false,
    family: 'preview',
    passive: [
      rx(String.raw`\b(?:is|are)\s+${ADV}(?:rendering|rendered|showing|shown|displayed|visible|live|open|up)\s+(?:in|on)\s+(?:your|the)\s+(?:live\s+)?(?:sandbox\s+)?(?:preview|drawer|sandbox)\b`),
      rx(String.raw`\bpreview\s+(?:is|has)\s+${ADV}(?:open(?:ed)?|ready|live|rendering|up|been\s+(?:opened|rendered|generated|created))\b`),
    ],
    patterns: [
      rx(String.raw`${I_PERF}${COORD}(?:re-?)?previewed\b`),
      rx(String.raw`${I_PERF}${COORD}(?:opened|rendered|launched|loaded|shown|showed|put|deployed)\b[^.!?\n]{0,60}?\b(?:preview|sandbox)\b`),
      // "now" makes it this turn's report ("The page is now rendering in your live preview"), not a state.
      rx(String.raw`\b(?:is|are)\s+now\s+${ADV}(?:rendering|rendered|showing|shown|displayed|visible|live|open|up)\s+(?:in|on)\s+(?:your|the)\s+(?:live\s+)?(?:sandbox\s+)?(?:preview|drawer|sandbox)\b`),
    ],
    verbs: ['previewPage', 'previewBlueprint', 'previewRestDef'],
  },
  {
    backedByAgentWrites: true,
    family: 'publish',
    passive: [
      rx(String.raw`\b(?:has|have)\s+been\s+${ADV}published\b`),
      rx(String.raw`\b(?:is|are)\s+now\s+published\b`),
      rx(String.raw`\b${CHANGE_REQUEST}\s+(?:has\s+been|was|is\s+now)\s+${ADV}(?:opened|created|raised|submitted)\b`),
    ],
    patterns: [
      rx(String.raw`${I_PERF}${COORD}(?:re-?)?published\b`),
      rx(String.raw`${I_PERF}${COORD}(?:opened|raised|created|submitted|filed)\s+(?:a|an|the|your)\s+(?:new\s+)?(?:draft\s+)?${CHANGE_REQUEST}\b`),
    ],
    verbs: ['publishPage', 'publishBlueprint', 'publishRestDef', 'applyResourceSet'],
  },
  {
    backedByAgentWrites: true,
    family: 'apply',
    passive: [
      rx(String.raw`\b(?:has|have)\s+been\s+${ADV}(?:applied|patched)\b`),
      rx(String.raw`\b(?:is|are)\s+now\s+applied\b`),
    ],
    patterns: [
      rx(String.raw`${I_PERF}${COORD}(?:re-?)?applied\b`),
      rx(String.raw`${I_PERF}${COORD}patched\b`),
    ],
    // "I applied the status filter" is a navigation (setExtras), not a write.
    unless: /\bfilters?\b/i,
    verbs: ['applyResourceSet', 'patchField', 'runAction', 'publishPage', 'publishBlueprint', 'publishRestDef'],
  },
  {
    // A controller draft edit. Observed on krateo-057 (frontend 1.6.89): "Mapped the get verb for kind
    // Pet to GET /pets/{petId}." beside the chip refusing exactly that mapping. The sentence-initial
    // participle with no "I" is how the reply reported its edits, so it is a claim form here.
    attemptedOnly: true,
    backedByAgentWrites: false,
    family: 'controller',
    passive: [
      rx(String.raw`\b(?:is|are)\s+now\s+(?:mapped|settled|placed|omitted|bound|excluded|left\s+out)\b`),
      rx(String.raw`\b(?:has|have)\s+been\s+${ADV}(?:mapped|placed|omitted|bound|excluded|left\s+out)\b`),
    ],
    patterns: [
      rx(String.raw`${I_PERF}${COORD}(?:${CONTROLLER_EDIT})\b`),
      // "I settled the verbs for Pet", never "I confirmed the operation X is not in the document".
      rx(String.raw`${I_PERF}${COORD}(?:settled|confirmed)\s+(?:the\s+)?(?:[\w-]+\s+)?(?:${CONTROLLER_NOUN})\b(?!\s+(?:is|are|was|were|exists?)\b)`),
      // Not "Mapped verbs are …" (an adjective), "- Mapped verbs: …" (a label) or "Mapped by you: …".
      rx(String.raw`^${BULLET}(?:${CONTROLLER_EDIT})(?:\*\*)?\s+(?!(?:[\w-]+\s+){0,2}${FINITE}\b|by\b|[\w-]+(?:\s+[\w-]+)?\s*:)`),
    ],
    verbs: [...CONTROLLER_CLAIM_VERBS],
  },
  {
    // A draft edit — observed: "bound it to a multi-stage RESTAction" with no composeBind (actionBridge).
    backedByAgentWrites: false,
    family: 'compose',
    patterns: [
      rx(String.raw`${I_PERF}${COORD}(?:bound|wired)\s+(?:it|them|the\s+[\w-]+(?:\s+[\w-]+)?|\x60?[\w-]+\x60?)\s+to\b`),
      rx(String.raw`${I_PERF}${COORD}(?:added|placed|inserted|moved|dropped)\s+[^.!?\n]{1,60}?\b(?:to|into|inside|onto|under)\s+(?:the|your)\s+(?:page|draft|canvas|layout)\b`),
    ],
    // A controller edit is a draft edit too: "I bound petId to status.id" is backed by controllerBindId.
    verbs: ['composeAdd', 'composeMove', 'composeBind', 'previewPage', ...CONTROLLER_CLAIM_VERBS],
  },
  {
    backedByAgentWrites: false,
    family: 'chart',
    patterns: [
      rx(String.raw`${I_PERF}${COORD}(?:written|wrote|rewritten|rewrote|updated|edited|changed|modified|deleted|removed|created|added)\s+(?:the\s+|a\s+new\s+|a\s+)?${FILE}`),
    ],
    verbs: ['chartPut', 'chartDelete', 'chartLink', 'previewBlueprint', 'previewPage'],
  },
]

/** A clause opened by one of these is a condition or a premise, not a report of this turn. */
const SUBORDINATE = /\b(?:if|once|when|whenever|after|before|until|unless|as\s+soon\s+as|so\s+that|since|now\s+that|because)\b/i
/** A clause whose subject is negated ("Nothing has been published", "No page is rendering in …"). */
const NEGATED = /(?:\b(?:nothing|nobody|none|never|not|no|neither|nor)\b|n['’]t\b)/i
/** A sentence looking back at an earlier turn is not a claim about this one. */
const RETROSPECTIVE = /\b(?:earlier|previously|last\s+time|in\s+(?:my|the|an?)\s+(?:previous|last|earlier|prior)\s+(?:turn|reply|message|answer|step))\b/i

/** Sentences (and lines) of the reply, in order. Quoted lines (`> …`) and code are not the agent speaking. */
const sentencesOf = (text: string): string[] => text
  .replace(/```[\s\S]*?```/g, '\n')
  .split('\n')
  .filter((line) => !/^\s*>/.test(line))
  .flatMap((line) => line.split(/(?<=[.!?])\s+/))
  .map((sentence) => sentence.trim())
  .filter(Boolean)

/** The clause a match sits in: from the last clause boundary before it up to the match itself. */
const clauseBefore = (sentence: string, index: number): string => {
  const head = sentence.slice(0, index)
  const cut = Math.max(head.lastIndexOf(','), head.lastIndexOf(';'), head.lastIndexOf(':'), head.lastIndexOf('('), head.lastIndexOf('—'))
  return head.slice(cut + 1)
}

/** One claim the text makes: its family, the words, the sentence they sit in, and whether it is passive wording. */
interface FoundClaim {
  family: ClaimFamily
  phrase: string
  sentence: string
  passive: boolean
}

/** The first claim `rule` finds in `sentence`, if any. */
const claimIn = (rule: ClaimRule, sentence: string): FoundClaim | null => {
  const tries: [RegExp, boolean][] = [...rule.patterns.map((pattern): [RegExp, boolean] => [pattern, false]), ...(rule.passive ?? []).map((pattern): [RegExp, boolean] => [pattern, true])]
  for (const [pattern, passive] of tries) {
    const match = pattern.exec(sentence)
    // The patterns are case-insensitive for the verbs, but the pronoun is "I", never the Italian
    // article ("Controlla i placed widgets").
    if (!match || /^i(?![a-z])/.test(match[0])) {
      continue
    }
    const clause = clauseBefore(sentence, match.index)
    if (!SUBORDINATE.test(clause) && !NEGATED.test(clause)) {
      return { family: rule.family, passive, phrase: match[0].trim(), sentence }
    }
  }
  return null
}

/** Every claim of every sentence, in order. */
const allClaims = (text: string): FoundClaim[] => sentencesOf(text)
  // A question claims nothing ("Have I published it?", "Is it showing in the preview?").
  .filter((sentence) => !sentence.endsWith('?') && !RETROSPECTIVE.test(sentence))
  .flatMap((sentence) => CLAIM_RULES.flatMap((rule) => {
    const found = rule.unless?.test(sentence) ? null : claimIn(rule, sentence)
    return found ? [found] : []
  }))

/** Every claim the text makes, at most one per family (the first phrase that made it). */
export const findClaims = (text: string): { family: ClaimFamily; phrase: string; passive?: true }[] => {
  const seen = new Set<ClaimFamily>()
  return allClaims(text).flatMap(({ family, passive, phrase }) => {
    if (seen.has(family)) { return [] }
    seen.add(family)
    return [{ family, phrase, ...(passive ? { passive: true as const } : {}) }]
  })
}

/** A tool the agent ran ITSELF that writes — backs a publish/apply claim when it did not fail. */
const WRITE_TOOL = /(?:apply|patch|create|delete|install|upgrade|rollback|scale|restart|annotate|label|publish|commit|push|pull_request|merge)/i

/**
 * Whether the agent's own tool calls could have made a publish/apply claim true. A delegated
 * specialist counts too: its calls are in its own session, which the rail cannot see from here, so
 * refusing it the benefit of the doubt would flag work that did happen.
 */
const agentWrote = (evidence: readonly EvidenceEntry[]): boolean =>
  evidence.some((entry) => !entry.failed && (Boolean(entry.agent) || WRITE_TOOL.test(entry.tool)))

/** When several actions of a family arrived and none applied, the reason worth naming first. */
const OUTCOME_PRIORITY: readonly UnbackedOutcome[] = ['declined', 'failed', 'refused', 'dropped']

/** The paths a sentence names ("/pets/{petId}"), without the sentence's own full stop. */
const pathsIn = (sentence: string): string[] => [...sentence.matchAll(/\/[\w{}.\-/]*/g)].map(([path]) => path.replace(/\.+$/, ''))
const escape = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** What a mapping attempt names: its verb and path, read off `attemptOf`'s words. */
const mappingOf = (attempt?: string): { action: string; path?: string } | null => {
  const mapped = /^mapped (\S+) → \S+ (\S+)$/.exec(attempt ?? '')
  if (mapped) { return { action: mapped[1], path: mapped[2] } }
  const left = /^left (\S+) out of /.exec(attempt ?? '')
  return left ? { action: left[1] } : null
}

/**
 * Whether a sentence is about this mapping attempt. A path decides when the sentence names one —
 * "get has been mapped to GET /pet/{petId}" is not about an attempt at /pets/{petId} — otherwise the
 * verb's own name, as a word.
 */
const isAbout = (sentence: string, action: TurnAction): boolean => {
  const mapping = mappingOf(action.attempt)
  if (!mapping) { return false }
  const paths = pathsIn(sentence)
  if (mapping.path && paths.length) { return paths.includes(mapping.path) }
  return new RegExp(String.raw`(?:^|[^\w-])${escape(mapping.action)}(?![\w-])`, 'i').test(sentence)
}

/**
 * THE KERNEL. The claims in `text` that no action of this turn backs.
 *
 * `actions` is every portal action the turn produced and how it ended (including approved or denied
 * HITL tool calls, as verb `approval`); `evidence` is the turn's tool trace.
 *
 * A claim about ONE mapping is backed by that mapping alone: "Placed pet as Pet. Mapped get to GET
 * /pets/{petId}." is not backed by the place when the mapping was refused. Every other claim is
 * backed by any success of its family.
 */
export const checkClaims = (
  text: string,
  actions: readonly TurnAction[],
  evidence: readonly EvidenceEntry[] = [],
): UnbackedClaim[] => {
  const unbacked = new Map<ClaimFamily, UnbackedClaim>()
  const claims = allClaims(text)
  // In a controller turn, "I bound petId to status.id" is ONE claim — the controller edit, not also a
  // page-draft edit (compose's verbs include the controller's, so this only spares a second notice).
  const controllerTurn = claims.some((claim) => claim.family === 'controller')
    && actions.some((action) => (CONTROLLER_CLAIM_VERBS as readonly string[]).includes(action.verb))
  for (const { family, passive, phrase, sentence } of claims) {
    const rule = CLAIM_RULES.find((candidate) => candidate.family === family)!
    if (unbacked.has(family) || (family === 'compose' && controllerTurn)) {
      continue
    }
    const mine = actions.filter((action) => rule.verbs.includes(action.verb) || (rule.backedByAgentWrites && action.verb === 'approval'))
    const about = family === 'controller' ? mine.filter((action) => isAbout(sentence, action)) : []
    // Passive wording names a state; for a controller, only a state of an attempt it names is this turn's.
    if (passive && family === 'controller' && !about.length) {
      continue
    }
    const backing = about.length ? about : mine
    if (backing.some((action) => action.outcome === 'applied')) {
      continue
    }
    if ((rule.backedByAgentWrites && agentWrote(evidence)) || ((rule.attemptedOnly || passive) && !backing.length)) {
      continue
    }
    const outcome = backing.length
      ? OUTCOME_PRIORITY.find((candidate) => backing.some((action) => action.outcome === candidate)) ?? 'refused'
      : 'missing'
    // A refusal is named only when it is the one the words are about — the attempt the sentence names,
    // or the turn's single refusal when the sentence names no other path. Otherwise the family copy.
    const refusals = backing.filter((action) => action.outcome === 'refused' && action.reason)
    const sole = refusals.length === 1 && !pathsIn(sentence).some((path) => path !== mappingOf(refusals[0].attempt)?.path)
    const named = outcome === 'refused' && (about.length || sole) ? refusals[0] : undefined
    unbacked.set(family, { family, outcome, phrase, ...(named?.attempt ? { attempt: named.attempt } : {}), ...(named?.reason ? { reason: named.reason } : {}) })
  }
  return [...unbacked.values()]
}

/**
 * How a chip the bridge returned ended. The bridge's structural signals come first (`failure`,
 * `previewFailed`); the rest are the fixed labels its refusal paths emit — `refused()`'s "this
 * portal did not run it", previewPage v2's "preview blocked/denied/apply failed", previewBlueprint's
 * "(draft rejected)" / "(render failed)" / "preview unavailable".
 */
export const chipOutcome = (chip: AutopilotActionChip): ActionOutcome => {
  if (chip.failure) {
    return 'failed'
  }
  // Both refusal helpers set it (actionBridge `refused`, controllerVerbs `refuse`); the label is the
  // fallback for a chip restored from a conversation saved before the field.
  if (chip.refused) {
    return 'refused'
  }
  if (chip.previewFailed || /^preview apply failed\b/i.test(chip.label) || /\(render failed\)$/.test(chip.label)) {
    return 'failed'
  }
  if (/ — this portal did not run it\b/.test(chip.label)
    || /^preview (?:blocked|denied|unavailable)\b/i.test(chip.label)
    || /\(draft rejected\)$/.test(chip.label)) {
    return 'refused'
  }
  return 'applied'
}

/** A refusal chip's reason — the parenthesis of "<verb> — this portal did not run it (<reason>)". */
export const refusalReason = (chip: AutopilotActionChip): string | undefined => {
  const reason = / — this portal did not run it \(([\s\S]+)\)$/.exec(chip.label)?.[1]?.trim().replace(/[.\s]+$/, '')
  return reason || undefined
}

/**
 * What a proposal tried, in the words a reply would use — so a refused claim's notice can say which
 * mapping the portal refused. Only verbs whose arguments say it plainly; the rest use the family copy.
 */
export const attemptOf = (proposal: { verb: string; restAction?: unknown; omit?: unknown; method?: unknown; path?: unknown; kind?: unknown }): string | undefined => {
  if (proposal.verb !== 'controllerMapVerb' || typeof proposal.restAction !== 'string') {
    return undefined
  }
  if (proposal.omit === true) {
    return typeof proposal.kind === 'string' ? `left ${proposal.restAction} out of ${proposal.kind}` : undefined
  }
  const method = typeof proposal.method === 'string' ? proposal.method.trim().toUpperCase() : ''
  const path = typeof proposal.path === 'string' ? proposal.path.trim() : ''
  return method && path ? `mapped ${proposal.restAction} → ${method} ${path}` : undefined
}

/** A denial string from the publish compile path — a cancelled destination form is the person's decision. */
export const denialOutcome = (denial: string): ActionOutcome => (/\bcancel/i.test(denial) ? 'declined' : 'refused')

/** Per family: what the reply said it did, and the truth for each way it can be unbacked. */
const COPY: Record<ClaimFamily, { said: string; missing: string; unsuccessful: string; declined: string }> = {
  apply: { declined: 'the change was not confirmed, so nothing was applied', missing: 'no change was applied', said: 'applied this change', unsuccessful: 'the change did not go through' },
  chart: { declined: 'no chart file was changed', missing: 'no chart file was changed', said: 'edited the chart', unsuccessful: 'the file edit was refused' },
  compose: { declined: 'the draft was not changed', missing: 'the draft was not changed', said: 'changed the page draft', unsuccessful: 'the draft edit was refused' },
  controller: { declined: 'the controller draft was not changed', missing: 'the controller draft was not changed', said: 'changed the controller draft', unsuccessful: 'the portal refused the edit' },
  preview: { declined: 'no preview was produced', missing: 'no preview was produced', said: 'previewed this', unsuccessful: 'the preview did not succeed' },
  publish: { declined: 'the publish was not confirmed, so nothing was published', missing: 'nothing was published', said: 'published this', unsuccessful: 'the publish did not go through' },
}

/** The notice line under the reply. Says what was claimed and what is true — never more. */
export const claimNotice = (claim: UnbackedClaim): string => {
  const copy = COPY[claim.family]
  if (claim.outcome === 'refused' && claim.reason) {
    return `The reply says it ${claim.attempt ?? copy.said}, but the portal refused it: ${claim.reason}.`
  }
  let truth = copy.unsuccessful
  if (claim.outcome === 'missing') {
    truth = copy.missing
  } else if (claim.outcome === 'declined') {
    truth = copy.declined
  }
  return `Autopilot said it ${copy.said}, but ${truth}.`
}

/** Only a claim with NOTHING behind it is worth re-asking; a refused or declined action has its answer. */
export const isRetryable = (claim: UnbackedClaim): boolean => claim.outcome === 'missing'

/** The verb the model should have emitted, for the retry nudge. */
const VERB_HINT: Record<ClaimFamily, string> = {
  apply: 'applyResourceSet (or patchField)',
  chart: 'chartPut / chartDelete',
  compose: 'composeAdd / composeMove / composeBind',
  controller: 'controllerPlace / controllerMapVerb',
  preview: 'previewPage (or previewBlueprint / previewRestDef)',
  publish: 'publishPage (or publishBlueprint / publishRestDef)',
}

/**
 * The hidden re-prompt behind Retry: the model is told, factually, that its words and the portal
 * disagree, and asked either to emit the action or to say plainly it was not done.
 */
export const claimRetryNudge = (claims: readonly UnbackedClaim[]): string => {
  const lines = claims.map((claim) => `- you wrote "${claim.phrase}", but no ${VERB_HINT[claim.family]} portal-action directive arrived, so nothing happened in the portal`)
  return [
    'Your previous reply described an action as DONE, but the portal received no directive for it:',
    ...lines,
    'Emit the fenced portal-action block for that step NOW, in this reply. If you cannot, say plainly that it was NOT done — do not describe it as done again.',
  ].join('\n')
}
