import { readdirSync, readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import { parseAutopilotDirectives, sanitizeChatText } from './actionBridge'

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
