import { readdirSync, readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import { parseAutopilotDirectives, sanitizeChatText, refused } from './actionBridge'

const railSource = (file: string): string =>
  readFileSync(new URL(`./${file}`, import.meta.url), 'utf-8')

/**
 * THE FRONTEND'S WIRE CONTRACT: a turn carries the `<page_context>` delta and the user's
 * text, and NOTHING else. No instruction preamble, no override seam, no config key that can
 * add to it — the portal-rail protocol lives in the orchestrator's system prompt (the
 * `portal-protocol` key of the krateo-prompts-eng ConfigMap, krateo-autopilot >= 0.1.49),
 * where it is sent once per LLM call and never compacted. Assert its CONTENT there, not here.
 *
 * These are STRUCTURAL assertions over the source rather than behavioural ones over a
 * helper, because there is no assembly step left to call. They are tripwires: if you
 * deliberately change the wire shape, update them in the same commit and say why.
 */
describe('the turn carries NO instruction preamble', () => {
  it('passes the page-context delta to the transport unmodified', () => {
    const provider = railSource('AutopilotProvider.tsx')
    // `baseContext` is assigned straight from buildContextDelta and handed to transport.send
    // as `context` with nothing wrapped around it. A prefix/concat would break one of these.
    expect(provider).toMatch(/const baseContext = buildContextDelta\(/)
    expect(provider).toMatch(/context: baseContext,/)
    // No template-literal or concatenation building the context field.
    expect(provider).not.toMatch(/context: [`'"]/)
    expect(provider).not.toMatch(/\$\{\w*[Pp]rompt\w*\}|\$\{\w*[Rr]ules\w*\}/)
  })

  it('reads no prompt-override config key', () => {
    // A config-supplied prompt is per-turn instruction text by another name: same cost, same
    // decay under compaction. Iterate the prompt in the agent's ConfigMap instead.
    for (const file of ['AutopilotProvider.tsx', 'actionBridge.ts']) {
      expect(railSource(file)).not.toMatch(/config\?\.api\.AUTOPILOT_PORTAL/)
    }
  })

  it('carries none of the instruction text that belongs to the system prompt', () => {
    const promptMarkers = [
      // Constant names, so a re-declaration is caught by name alone.
      'PORTAL_CAPABILITIES_PROMPT =', 'PORTAL_HOUSE_RULES =',
      'GROUNDING_GUARDRAIL_PROMPT =', 'PORTAL_BUILDER_ROUTING_DIRECTIVE =',
      // Load-bearing headings, matched in FULL form: the bare phrase "BLUEPRINT BUILDER"
      // legitimately appears in prose that REFERS to the prompt (e.g. blueprintPublish.ts naming
      // where its repo defaults come from), and that is not a regression.
      'BLUEPRINT BUILDER — AUTHOR', 'PORTAL BUILDER — AUTHOR', 'HOUSE RULES —',
      'AUTHORITATIVE ROUTING', 'CHECK THE SCHEMA FIRST', 'TOURS ARE OFF BY DEFAULT',
      'REMEDIATION ORDER (always in this order)',
      // The fence tags such a block would be wrapped in.
      '<portal_capabilities>', '<house_rules>', '<grounding_rules>', '<portal_builder_routing>',
    ]
    // Scans EVERY module in the rail (not just this one), so a new constant cannot simply be
    // parked in a neighbouring file. Excludes tests — this file names the markers on purpose.
    const modules = readdirSync(new URL('.', import.meta.url))
      .filter((name) => /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name))
    const offenders = modules.flatMap((file) => {
      const source = railSource(file)
      return promptMarkers.filter((marker) => source.includes(marker)).map((marker) => `${file}: ${marker}`)
    })
    expect(offenders).toEqual([])
    // Sanity: the scan actually looked at the rail, so an empty glob can't fake a pass.
    expect(modules).toContain('actionBridge.ts')
    expect(modules.length).toBeGreaterThan(20)
  })
})

describe('parseAutopilotDirectives — fenced (baseline)', () => {
  it('parses + strips a fenced portal-action', () => {
    const text = 'Opening your blueprints.\n```portal-action\n{"verb":"navigate","route":"/blueprints","label":"open blueprints"}\n```'
    const result = parseAutopilotDirectives(text)
    expect(result.proposals).toHaveLength(1)
    expect(result.proposals[0].verb).toBe('navigate')
    expect(result.cleanedText).toBe('Opening your blueprints.')
    expect(result.cleanedText).not.toMatch(/verb|route/)
  })
})

describe('parseAutopilotDirectives — un-fenced fallback (the leak fix)', () => {
  it('parses a bare {"verb":…} action so it FIRES, and strips it from the prose', () => {
    const text = 'Sure, taking you there.\n{"verb":"navigate","route":"/blueprints","label":"viewed your blueprints"}'
    const result = parseAutopilotDirectives(text)
    expect(result.proposals).toHaveLength(1)
    expect(result.proposals[0].verb).toBe('navigate')
    expect((result.proposals[0] as { route?: string }).route).toBe('/blueprints')
    expect(result.cleanedText).toBe('Sure, taking you there.')
    expect(result.cleanedText).not.toContain('"verb"')
  })

  it('parses a bare single-line prefillForm with a nested values object', () => {
    const text = 'Drafting the form.\n{"verb":"prefillForm","values":{"name":"demo-vpc","region":"eu-central-1"},"label":"drafted"}'
    const result = parseAutopilotDirectives(text)
    expect(result.proposals).toHaveLength(1)
    expect(result.proposals[0].verb).toBe('prefillForm')
    expect(result.cleanedText).toBe('Drafting the form.')
  })

  it('parses a bare {"steps":…} tour and strips it', () => {
    const text = 'Here is a quick tour.\n{"steps":[{"anchor":"nav:Compositions","title":"Compositions","description":"All resources."}]}'
    const result = parseAutopilotDirectives(text)
    expect(result.tour?.steps).toHaveLength(1)
    expect(result.cleanedText).toBe('Here is a quick tour.')
    expect(result.cleanedText).not.toContain('"steps"')
  })

  it('leaves a malformed bare directive line in place (no crash) rather than dropping prose', () => {
    const text = 'Note: the {"verb": is part of our protocol.'
    const result = parseAutopilotDirectives(text)
    // not a standalone JSON-object line → not parsed, prose preserved
    expect(result.proposals).toHaveLength(0)
    expect(result.cleanedText).toContain('part of our protocol')
  })

  it('does not match prose that merely mentions verb', () => {
    const text = 'The form needs a name and a region value.'
    const result = parseAutopilotDirectives(text)
    expect(result.proposals).toHaveLength(0)
    expect(result.cleanedText).toBe('The form needs a name and a region value.')
  })
})

// NOTE: sanitizeChatText deliberately does NOT trim trailing whitespace (so the streaming cursor
// doesn't jump); parseAutopilotDirectives trims. So assert on `.trim()` for exact equality.
describe('sanitizeChatText — bare directive JSON', () => {
  it('strips a completed bare {"verb":…} line', () => {
    expect(sanitizeChatText('Done.\n{"verb":"navigate","route":"/dashboard"}').trim()).toBe('Done.')
  })

  it('strips a still-streaming incomplete bare directive (no closing brace yet)', () => {
    expect(sanitizeChatText('Working...\n{"verb":"navi').trim()).toBe('Working...')
  })

  it('strips a bare {"steps":…} line', () => {
    expect(sanitizeChatText('Tour:\n{"steps":[{"anchor":"nav:X"}]}').trim()).toBe('Tour:')
  })

  it('leaves ordinary prose untouched', () => {
    const prose = 'Your VPC failed because the AWS controller is not installed. Install it from the Marketplace.'
    expect(sanitizeChatText(prose)).toBe(prose)
  })
})

describe('sanitizeChatText — existing hardening still holds', () => {
  it('#103: PRESERVES a fenced code/YAML block the agent outputs', () => {
    const out = sanitizeChatText('Here is the manifest:\n```yaml\napiVersion: v1\nkind: ConfigMap\n```')
    expect(out).toContain('```yaml')
    expect(out).toContain('apiVersion: v1')
    expect(out).toContain('kind: ConfigMap')
  })

  it('#103: still HIDES a directive fence (portal-action) from the rendered text', () => {
    expect(sanitizeChatText('Opening it.\n```portal-action\n{"verb":"navigate","route":"/x"}\n```').trim()).toBe('Opening it.')
  })

  it('still strips a bare kubectl line', () => {
    expect(sanitizeChatText('Run this:\nkubectl get pods')).not.toContain('kubectl get pods')
  })
})

describe('refused — A18: a verb that cannot act says so', () => {
  it('names the verb when there is no reason to give', () => {
    expect(refused('navigate')).toEqual({
      label: 'navigate — this portal did not run it',
      readOnly: true,
      verb: 'navigate',
    })
  })

  it('keeps the no-reason label BYTE-IDENTICAL to the #204 wording', () => {
    // A6 (#204) shipped this exact sentence and the design doc quotes it. Widening the helper for
    // A18 must not silently reword every existing refusal — hence a literal, not a template.
    expect(refused('patchField').label).toBe('patchField — this portal did not run it')
  })

  it('appends the reason in parentheses when one is given', () => {
    expect(refused('runAction', 'no control sync on compositions-table').label)
      .toBe('runAction — this portal did not run it (no control sync on compositions-table)')
  })

  it('stays read-only, so a refusal never reads as an action taken', () => {
    expect(refused('runAction', 'no control x on y').readOnly).toBe(true)
  })

  it('carries the verb through unchanged so the rail can group it', () => {
    expect(refused('previewPage').verb).toBe('previewPage')
  })
})

/**
 * A tripwire, in this file's existing structural style, because `lookupAction` is module-private
 * and there is no seam to call.
 *
 * `getQueriesData` without a filter reads the WHOLE react-query cache, including entries whose
 * widget has unmounted and is merely sitting out its gc window. "Find a REAL on-screen action"
 * was therefore a claim the code did not enforce: the agent could drive a control on a page the
 * user had navigated away from, and the write would land on something they were no longer
 * looking at. `type: 'active'` restricts the scan to queries with a live observer.
 *
 * If you deliberately widen this, update the tripwire in the same commit and say why — but be
 * aware you are widening what "the agent presses the control you can see" means.
 */
describe('the agent can only drive a control that is actually mounted', () => {
  it('scopes the widget-cache lookup to ACTIVE queries', () => {
    const bridge = railSource('actionBridge.ts')
    const call = /getQueriesData<unknown>\(\{[^}]*\}\)/.exec(bridge)
    expect(call, 'lookupAction no longer calls getQueriesData — re-point this tripwire').toBeTruthy()
    expect(call![0]).toContain("queryKey: ['widgets']")
    expect(call![0]).toContain("type: 'active'")
  })
})

/**
 * A tripwire, like the one above, because the compose branches live inside the hook and there is
 * no seam to call — and because the property at stake is precisely the one a behavioural test on
 * a mocked bus would not catch: that NO compose branch returns a success label without first
 * hearing the composer say it applied.
 *
 * This is what shipped broken on krateo-057: the chip read "Added a Card inside page-x", read-only
 * and with no error, over a canvas with no card in it. Restoring fire-and-forget — dropping the
 * `await`, or returning the label without the `applied` check — must fail here.
 */
describe('a compose chip never claims an outcome the composer did not report', () => {
  const composeBranches = (): string[] => {
    const bridge = railSource('actionBridge.ts')
    return [...bridge.matchAll(/const result = await requestCompose\(\{[\s\S]{0,400}?\n(\s*)\}\n/g)]
      .map((match) => match[0])
  }

  it('awaits the composer on every compose call site', () => {
    const bridge = railSource('actionBridge.ts')
    const calls = [...bridge.matchAll(/requestCompose\(/g)]
    // Five: move, addContainer, addWidget, addExisting, bindData. The last two arrived with the
    // agent's authoring verbs and are held to the same contract as the three that predate them.
    expect(calls.length, 'compose call sites changed — re-point this tripwire').toBe(5)
    // Every one of them is awaited into a result. A bare `requestCompose({...})` is fire-and-forget.
    expect([...bridge.matchAll(/await requestCompose\(/g)]).toHaveLength(5)
  })

  it('gates each success label behind result.applied', () => {
    const branches = composeBranches()
    expect(branches.length, 'compose call sites changed — re-point this tripwire').toBe(5)
    for (const branch of branches) {
      expect(branch).toMatch(/if \(!result\.applied\) \{/)
      // Every refusal goes through the one helper, which is where the reason and the alternatives
      // are assembled. A branch hand-rolling its own `refused(...)` would skip both.
      expect(branch).toMatch(/return composeRefusal\('compose(Move|Add|Bind)', result, '[^']+'\)/)
    }
  })

  it("prefers the composer's reason over the bridge's fallback wording", () => {
    // The fallback exists only for an answer that carries no reason, never as the wording a real
    // refusal is reported with.
    const helper = /const composeRefusal = [\s\S]{0,600}?\n\}/.exec(railSource('actionBridge.ts'))
    expect(helper, 'composeRefusal is gone — re-point this tripwire').toBeTruthy()
    expect(helper![0]).toMatch(/result\.reason \?\? fallback/)
  })

  it('hands the alternatives to the reader instead of dropping them', () => {
    // `where` is the half of a refusal that makes the next attempt something other than a guess.
    // It reaches the model the only way a chip does: through the chip's own text.
    const helper = /const composeRefusal = [\s\S]{0,600}?\n\}/.exec(railSource('actionBridge.ts'))
    expect(helper![0]).toMatch(/result\.where\?\.length/)
    expect(helper![0]).toMatch(/result\.where\.join/)
  })
})

/**
 * THE AUTHORING DIRECTIVES — the bridge half of the verb that did not exist.
 *
 * `composeAdd` could create a CONTAINER or place an EXISTING widget. Neither is "make a Table", so
 * an agent asked for one reached for the place arm and named a widget that was not there; the page
 * published clean with a hole in it.
 *
 * Structural, like the rest of this file, because `apply` is a hook and there is no assembly step
 * to call. The ops' own RULES are pinned behaviourally in composeAuthoring.test.ts and
 * PageComposer.agent.test.tsx; what these assert is that the directive can reach them at all.
 */
describe('the authoring directives reach the composer', () => {
  const bridge = () => railSource('actionBridge.ts')

  it('routes a composeAdd carrying a KIND to the addWidget op', () => {
    const source = bridge()
    expect(source).toMatch(/if \(proposal\.kind\)/)
    expect(source).toMatch(/op: 'addWidget'/)
    // …and carries the widgetData through, or the CRD's required fields never arrive.
    expect(source).toMatch(/widgetData: proposal\.widgetData/)
  })

  it('checks KIND before the place arm — a proposal naming a kind is unambiguously a creation', () => {
    const source = bridge()
    expect(source.indexOf("if (proposal.kind)")).toBeLessThan(source.indexOf("proposal.name && proposal.resource"))
  })

  it('refuses a create with no name, since the name becomes the CR name', () => {
    expect(bridge()).toMatch(/creating a widget needs a name/)
  })

  it('routes composeBind to the bindData op with every part of the binding', () => {
    const source = bridge()
    expect(source).toMatch(/proposal\.verb === 'composeBind'/)
    expect(source).toMatch(/op: 'bindData'/)
    for (const part of ['action: proposal.action', 'actionRef: proposal.actionRef',
      'dataTemplate: proposal.dataTemplate', 'refsTemplate: proposal.refsTemplate']) {
      expect(source, part).toContain(part)
    }
  })

  it('still names all three arms in its ambiguity refusal', () => {
    // The refusal is what an agent reads when it guessed wrong, so it has to list what IS on offer
    // — otherwise the only way to discover the new verb is to already know it.
    // Anchored on 'a layout kind', not just 'an add needs' — there are two refusals starting that
    // way and the shorter one (a missing target) matches first under a non-greedy scan.
    const refusal = (/'an add needs a layout kind[^']*'/.exec(bridge()) ?? [''])[0]
    expect(refusal).toContain('layout kind')
    expect(refusal).toContain('widget kind')
    expect(refusal).toContain('existing widget')
  })
})
