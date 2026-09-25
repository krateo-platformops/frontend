/**
 * THE HYPOTHESIS TEST. `builder-publish` is a real chart whose five states are documented in its
 * own template comments (S1 Repository → S2 + Repo → S3 + LocalResources → S4 + PullRequest, and an
 * orthogonal username-secret shim). If reading its templates does not reproduce exactly that, the
 * architecture model is wrong, and it is cheaper to learn that here than in a composer.
 *
 * The fixture is a verbatim copy of portal:helm/builder-publish/templates at portal-kpo 4cd90ac.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { deriveStates, parseArchitecture, serializeArchitecture } from './architecture'
import { extractArchitecture } from './gateExtract'

const FIXTURE = join(__dirname, '__fixtures__', 'builder-publish')

const loadTemplates = (): Record<string, string> => {
  const dir = join(FIXTURE, 'templates')
  return Object.fromEntries(readdirSync(dir).map((file) => [`templates/${file}`, readFileSync(join(dir, file), 'utf8')]))
}

describe('extractArchitecture — builder-publish reproduces its own documented machine', () => {
  const { architecture, findings } = extractArchitecture('builder-publish', loadTemplates())

  it('reads every lookup into a named class; nothing is left unclassified', () => {
    const unclassified = findings.filter((finding) => finding.class === 'unclassified')
    expect(unclassified).toEqual([])
    // The six classes the fixture actually contains — counted, so a regression that quietly
    // reclassifies a preflight as a dependency shows up as a number, not a story.
    // preflight is FIVE, not three: the two `lookup "v1" "Namespace"` reads at repository.yaml:49
    // and pullrequest.yaml:56 sit on the same `if … fail` line as the configuration lookups — they
    // are the preflight's own disambiguation ("absent" vs "not yet applied"), not mere support.
    // The two support reads are the freeze block's Secret/Namespace checks (localresources.yaml:167-168).
    const tally = Object.fromEntries(
      ['dependency', 'preflight', 'capability', 'self', 'shim', 'support'].map((cls) => [cls, findings.filter((finding) => finding.class === cls).length]),
    )
    expect(tally).toEqual({ capability: 1, dependency: 4, preflight: 5, self: 1, shim: 1, support: 2 })
  })

  it('the dependency gates are exactly the four the chart comments describe', () => {
    const deps = findings
      .filter((finding) => finding.class === 'dependency')
      .map((finding) => `${finding.template}:${finding.line} ${finding.kind} ${finding.readyWhen}`)
    expect(deps).toEqual([
      'templates/localresources.yaml:41 Repository .status.default_branch',
      'templates/localresources.yaml:58 Repo .status.targetCommitId',
      'templates/pullrequest.yaml:91 LocalResource .status.targetCommitId',
      'templates/repo.yaml:65 Repository .status.default_branch',
    ])
  })

  it('serialises to the expected descriptor, byte for byte', () => {
    const expected = readFileSync(join(FIXTURE, 'expected.architecture.yaml'), 'utf8')
    expect(serializeArchitecture(architecture)).toBe(expected)
  })

  it('the descriptor it produces parses clean under the same rules an author is held to', () => {
    const parsed = parseArchitecture(serializeArchitecture(architecture))
    expect(parsed.ok).toBe(true)
  })

  it('derives S1..S4 with the shim orthogonal — the documented machine, from the edges alone', () => {
    const derived = deriveStates(architecture)
    expect(derived.ok).toBe(true)
    if (!derived.ok) { return }
    expect(derived.levels).toEqual({ localresources: 2, pullrequest: 3, repo: 1, repository: 0 })
    expect(derived.states.map((state) => state.renders)).toEqual([
      ['repository'],
      ['repo', 'repository'],
      ['localresources', 'repo', 'repository'],
      ['localresources', 'pullrequest', 'repo', 'repository'],
    ])
    // The shim never enters the sequence: it is not in any state's renders or withheld lists.
    expect(derived.states.flatMap((state) => [...state.renders, ...state.withheld])).not.toContain('username-secret')
  })
})
