/**
 * The A2A URL and the agent it reaches come from one value.
 *
 * The agent name decides whether a stored contextId may be replayed (kagent refuses a write to a
 * session another agent owns). In gateway mode the configured value ends in the agent name itself;
 * in same-origin mode it is a proxy path, and the agent behind it is decided by a rewrite in
 * nginx.conf (and the vite dev proxy). The second half of this file is what keeps that proxy path
 * naming its agent: a location rewritten to a different agent than the one it is named after would
 * make the portal record threads against the wrong agent, with nothing else failing.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { a2aUrl, agentOfA2aBase } from './a2aEndpoint'

const UI = join(__dirname, '..', '..', '..')

describe('agentOfA2aBase', () => {
  it('reads the agent from a gateway A2A URL, as the chart writes it', () => {
    expect(agentOfA2aBase('https://gateway.example:8080/api/a2a/krateo-system/autopilot')).toBe('autopilot')
    expect(agentOfA2aBase('https://gateway.example:8080/api/a2a/krateo-system/agentiko')).toBe('agentiko')
  })

  it('reads the same agent whether or not the value ends in a slash', () => {
    expect(agentOfA2aBase('https://gateway.example/api/a2a/ns/agentiko/')).toBe('agentiko')
    expect(agentOfA2aBase('/autopilot/')).toBe('autopilot')
  })

  it('reads the proxy location from the same-origin default', () => {
    expect(agentOfA2aBase('/autopilot')).toBe('autopilot')
  })

  it('names the agent a2aUrl posts to', () => {
    for (const base of ['https://gw/api/a2a/ns/agentiko', 'https://gw/api/a2a/ns/agentiko/', '/autopilot']) {
      const url = a2aUrl(base)
      expect(url.endsWith(`/${agentOfA2aBase(base)}/`)).toBe(true)
    }
  })
})

describe('a same-origin proxy path is named after the agent it rewrites to', () => {
  it('nginx.conf: every `/api/a2a/` rewrite targets the agent its location is named after', () => {
    const nginx = readFileSync(join(UI, 'nginx.conf'), 'utf8')
    const rewrites = [...nginx.matchAll(/rewrite \^\/([\w-]+)\/\(\.\*\)\$ \/api\/a2a\/[^/\s]+\/([\w-]+)\/\$1/g)]

    // Guard against the pattern silently matching nothing after an edit to the file.
    expect(rewrites.length).toBeGreaterThan(0)
    for (const [line, location, agent] of rewrites) {
      expect(agentOfA2aBase(`/${location}`), line).toBe(agent)
    }
  })

  it('vite.config.ts: the dev proxy rewrites the same way', () => {
    const vite = readFileSync(join(UI, 'vite.config.ts'), 'utf8')
    const rewrites = [...vite.matchAll(/replace\(\/\^\\\/([\w-]+)\/, '\/api\/a2a\/[^/']+\/([\w-]+)'\)/g)]

    expect(rewrites.length).toBeGreaterThan(0)
    for (const [line, location, agent] of rewrites) {
      expect(agentOfA2aBase(`/${location}`), line).toBe(agent)
    }
  })
})
