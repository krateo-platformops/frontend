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
import { extractArchitecture, extractNameExpression } from './gateExtract'

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

  it('names every node as its template\'s metadata.name does — through a variable, or inline', () => {
    const names = Object.fromEntries(architecture.resources.map((node) => [node.id, node.name]))
    expect(names).toEqual({
      // Inline at localresources.yaml:100 — `$i` is the file range's own index.
      localresources: 'printf "%s-%03d" $.Values.name (int $i) | trunc 63 | trimSuffix "-"',
      // `$name`, set once at pullrequest.yaml:95.
      pullrequest: 'printf "%s-pr" .Values.name | trunc 63 | trimSuffix "-"',
      // Inline at repo.yaml:77.
      repo: 'printf "%s-source" .Values.name | trunc 63 | trimSuffix "-"',
      // `$repo`, set once at repository.yaml:37 — and NOT the two-space `name:` under spec at :75.
      repository: 'printf "%s-repo" .Values.name | trunc 63 | trimSuffix "-"',
      // `$legacyName`, set once at username-secret.yaml:25.
      'username-secret': 'printf "%s-git-username" .Values.name | trunc 63 | trimSuffix "-"',
    })
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

describe('extractNameExpression — only what the scan can pin down', () => {
  const doc = (head: string, name: string) => `${head}apiVersion: v1\nkind: ConfigMap\nmetadata:\n  labels:\n    a: b\n  name: ${name}\n`

  it('an inline action, `| quote` dropped; a literal as the string Helm reads', () => {
    expect(extractNameExpression(doc('', '{{ include "x.fullname" . | quote }}'))).toBe('include "x.fullname" .')
    expect(extractNameExpression(doc('', '{{- printf "%s-a" .Release.Name -}}'))).toBe('printf "%s-a" .Release.Name')
    expect(extractNameExpression(doc('', 'plain-name'))).toBe('"plain-name"')
    expect(extractNameExpression(doc('', '"quoted-name"'))).toBe('"quoted-name"')
  })

  it('a variable assigned once resolves; assigned twice (:= or =) it is not guessed', () => {
    expect(extractNameExpression(doc('{{- $n := printf "%s-a" .Release.Name -}}\n', '{{ $n }}'))).toBe('printf "%s-a" .Release.Name')
    expect(extractNameExpression(doc('{{- $n := "a" -}}\n{{- if .Values.b }}{{- $n = "b" -}}{{- end }}\n', '{{ $n }}'))).toBeNull()
    expect(extractNameExpression(doc('{{- $n := "a" -}}\n{{- $n := "b" -}}\n', '{{ $n }}'))).toBeNull()
  })

  it('refuses text around an action, an unknown variable, and one the graph block would not have bound', () => {
    expect(extractNameExpression(doc('', '{{ .Release.Name }}-cm'))).toBeNull()
    expect(extractNameExpression(doc('', '{{ $unknown }}'))).toBeNull()
    expect(extractNameExpression(doc('{{- $base := .Release.Name -}}\n', '{{ printf "%s-a" $base }}'))).toBeNull()
    expect(extractNameExpression(doc('', '{{ printf "%s-%d" $.Release.Name $i }}'))).toBe('printf "%s-%d" $.Release.Name $i')
  })

  it('a template action is read as the include that names the same object — one with no argument, not at all', () => {
    expect(extractNameExpression(doc('', '{{ template "x.fullname" . }}'))).toBe('include "x.fullname" .')
    expect(extractNameExpression(doc('', '{{- template "x.fullname" $ -}}'))).toBe('include "x.fullname" $')
    expect(extractNameExpression(doc('', '{{ template "x.fullname" }}'))).toBeNull()
  })

  it('inside a range or a with, a name read relative to the dot is left out — where the block evaluates it, `.` is the root', () => {
    const ranged = (open: string, name: string) => `${open}\napiVersion: v1\nkind: ConfigMap\nmetadata:\n  name: ${name}\n{{- end }}\n`
    expect(extractNameExpression(ranged('{{- range .Values.items }}', '{{ printf "%s-%s" $.Release.Name .name }}'))).toBeNull()
    expect(extractNameExpression(ranged('{{- with .Values.db }}', '{{ .name }}'))).toBeNull()
    expect(extractNameExpression(ranged('{{- with .Values.db }}', '{{ include "x.fullname" . }}'))).toBeNull()
    // Read from the root or a range variable, the same place names the same object there too.
    expect(extractNameExpression(ranged('{{- range $i, $f := .Values.items }}', '{{ printf "%s-%d" $.Release.Name $i }}'))).toBe('printf "%s-%d" $.Release.Name $i')
    // An `if` rebinds nothing.
    expect(extractNameExpression(ranged('{{- if .Values.db }}', '{{ .Values.db.name }}'))).toBe('.Values.db.name')
  })

  it('only the name under the first object\'s metadata — nothing below it, nothing without it', () => {
    expect(extractNameExpression('apiVersion: v1\nkind: ConfigMap\nmetadata:\n  labels: {}\nspec:\n  name: not-mine\n')).toBeNull()
    expect(extractNameExpression('apiVersion: v1\nkind: ConfigMap\ndata:\n  name: not-mine\n')).toBeNull()
    expect(extractNameExpression('{{- /* kind: Fake\nmetadata:\n  name: in-a-comment */}}\nkind: ConfigMap\nmetadata:\n  name: real\n')).toBe('"real"')
  })
})
