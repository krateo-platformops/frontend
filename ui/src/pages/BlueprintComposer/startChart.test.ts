import { load } from 'js-yaml'
import { describe, expect, it } from 'vitest'

import { draftDisplayName, lintBlueprintDraft } from '../../components/Autopilot/blueprintDraft'

import { ARCHITECTURE_TEMPLATE_PATH, deriveStates, parseArchitecture, serializeArchitecture, unwrapFromConfigMapTemplate } from './architecture'
import { PUBLISH_NAME_MAX, chartIdentityProblems, pluralGrowthBound } from './chartIdentity'
import { KIND_MAX, blueprintCompositionDefinition, claimApiVersion, compositionKind, kindBudget, metricsKindBudget, ociChartLocation, startChart, startChartWarnings, validateStartChart } from './startChart'

const INPUT = { description: 'Publishes a page set as a pull request', name: 'builder-publish', version: '0.1.0' }

const started = (input = INPUT): Record<string, string> => {
  const result = startChart(input)
  if (!result.ok) { throw new Error(JSON.stringify(result.problems)) }
  return result.files
}

describe('startChart — the seeded draft', () => {
  it('seeds exactly the four files a blueprint needs, and nothing it would have to guess', () => {
    expect(Object.keys(started()).sort()).toEqual(['Chart.yaml', 'templates/architecture.yaml', 'values.schema.json', 'values.yaml'])
  })

  it('passes the same lint an agent-proposed chart is held to, with no problems', () => {
    expect(lintBlueprintDraft(started(), 'blueprint')).toEqual([])
  })

  it('Chart.yaml is an application chart that draftDisplayName reads the name back out of', () => {
    const files = started()
    expect(draftDisplayName(files)).toBe('builder-publish')
    expect(files['Chart.yaml']).toBe('apiVersion: v2\nname: builder-publish\ndescription: Publishes a page set as a pull request\ntype: application\nversion: 0.1.0\n')
  })

  it('an empty description is left out rather than written blank; an awkward one is quoted by YAML', () => {
    expect(started({ ...INPUT, description: '  ' })['Chart.yaml']).not.toMatch(/description/)
    const awkward = started({ ...INPUT, description: 'name: not a key # nor a comment' })['Chart.yaml']
    expect((load(awkward) as Record<string, unknown>).description).toBe('name: not a key # nor a comment')
  })

  it('values.schema.json is an empty object schema — no populated object/array default anywhere', () => {
    expect(JSON.parse(started()['values.schema.json'])).toEqual({ $schema: 'http://json-schema.org/draft-07/schema#', properties: {}, type: 'object' })
    expect(load(started()['values.yaml'])).toEqual({})
  })

  it('templates/architecture.yaml unwraps and parses to an empty descriptor for this chart, and round-trips', () => {
    const template = started()[ARCHITECTURE_TEMPLATE_PATH]
    const descriptor = unwrapFromConfigMapTemplate(template)
    expect(descriptor).not.toBeNull()
    const parsed = parseArchitecture(descriptor!)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) { return }
    expect(parsed.architecture).toMatchObject({ chart: 'builder-publish', resources: [] })
    expect(serializeArchitecture(parsed.architecture)).toBe(descriptor)
    // Zero resources derive zero states: the stepper's initial shape takes it from here.
    expect(deriveStates(parsed.architecture)).toEqual({ levels: {}, ok: true, states: [] })
  })

  // Kubernetes decodes the rendered ConfigMap as YAML 1.1: bare, each of these is a bool or null,
  // and a label value that is not a string fails the apply. Every one is a valid chart name.
  it.each(['on', 'off', 'yes', 'no', 'y', 'n', 'true', 'false', 'null'])('a chart named %j gets a QUOTED architecture label — a string under YAML 1.1 too', (name) => {
    const template = started({ ...INPUT, name })[ARCHITECTURE_TEMPLATE_PATH]
    const label = template.split('\n').find((line) => line.trim().startsWith('krateo.io/architecture:'))
    expect(label).toBe(`    krateo.io/architecture: "${name}"`)
    expect(load(label!.trim())).toEqual({ 'krateo.io/architecture': name })
  })
})

describe('startChart — refusals, by field', () => {
  it.each([
    ['Builder-Publish', 'name'],
    ['builder_publish', 'name'],
    ['-publish', 'name'],
    ['publish-', 'name'],
    ['', 'name'],
    [`a${'b'.repeat(63)}`, 'name'],
    ['2fa-app', 'name'],
  ])('name %j is refused', (name, field) => {
    const result = startChart({ ...INPUT, name })
    expect(result.ok).toBe(false)
    if (result.ok) { return }
    expect(result.problems.map((problem) => problem.field)).toEqual([field])
  })

  // What binds is not the name's 63: it is the longest object core-provider names after the chart
  // on EVERY install, the CDC container `<plural>-<apiVersion>-controller`, at most 63 — so the Kind's
  // budget depends on the version. The plural lengths below are strings.ToLower(flect.Pluralize(Kind))
  // from flect v1.0.3, run in Go over the Kind — what core-provider's CRD generator names the resource.
  it('the budget is 63 − 11 − 1 − len(apiVersion) − the plural\'s growth for that ending', () => {
    // An `s` plural grows one: 44 at 0.1.0, 41 at 10.20.30, 39 at 1.0.0-rc.1.
    expect(kindBudget('0.1.0', 'Ab')).toBe(44)
    expect(kindBudget('10.20.30', 'Ab')).toBe(41)
    expect(kindBudget('1.0.0-rc.1', 'Ab')).toBe(39)
    // -es and y → ies grow two; -quizzes and -children three.
    expect(kindBudget('0.1.0', 'BuilderPublish')).toBe(43)
    expect(kindBudget('0.1.0', 'NetworkPolicy')).toBe(43)
    expect(kindBudget('0.1.0', 'AbQuiz')).toBe(42)
    expect(kindBudget('0.1.0', 'AbChild')).toBe(42)
  })

  it('the metrics Service\'s budget is eight tighter — advice, not a refusal: 36 at 0.1.0, 33 at 10.20.30', () => {
    expect(metricsKindBudget('0.1.0', 'Ab')).toBe(36)
    expect(metricsKindBudget('10.20.30', 'Ab')).toBe(33)
    expect(metricsKindBudget('0.1.0', 'AbQuiz')).toBe(34)
  })

  it('the growth bound never undercounts flect v1.0.3 (each pair is flect\'s own plural, run in Go)', () => {
    for (const [kind, plural] of [
      ['Repository', 'repositories'], ['BuilderPublish', 'builderpublishes'], ['Box', 'boxes'], ['Leaf', 'leaves'],
      ['Potato', 'potatoes'], ['Class', 'classes'], ['Waltz', 'waltzes'], ['Quiz', 'quizzes'], ['Fez', 'fezzes'],
      ['Child', 'children'], ['Ox', 'oxen'], ['Knife', 'knives'], ['Bureau', 'bureaus'], ['Config', 'configs'],
    ]) {
      expect(plural.length - kind.length, kind).toBeLessThanOrEqual(pluralGrowthBound(kind))
    }
    expect(['Config', 'Endpoint', 'Provider', 'Knife', 'Bureau'].map(pluralGrowthBound)).toEqual([1, 1, 1, 1, 1])
    expect(['Box', 'Match', 'Policy', 'Class', 'Leaf', 'Potato', 'Waltz'].map(pluralGrowthBound)).toEqual([2, 2, 2, 2, 2, 2, 2])
    expect(['Quiz', 'Fez', 'Child'].map(pluralGrowthBound)).toEqual([3, 3, 3])
  })

  it('at 0.1.0 a Kind of 44 is the limit, not over it — dashes do not count (Kind 44, plural 45, container 63)', () => {
    const name = `ab-cd-ef-${'g'.repeat(38)}`
    expect(name).toHaveLength(47)
    expect(compositionKind(name)).toHaveLength(44)
    expect(chartIdentityProblems({ ...INPUT, name })).toEqual([])
  })

  it('at 0.1.0 a Kind of 45 is refused, naming the container, the version, the budget and the growth', () => {
    const problems = chartIdentityProblems({ ...INPUT, name: `ab-cd-ef-${'g'.repeat(39)}` })
    expect(problems.map((problem) => problem.field)).toEqual(['name'])
    expect(problems[0].message).toMatch(/^at version 0\.1\.0 the Kind \(the name without dashes\) can be at most 44 characters — AbCdEfGg+ has 45\./)
    expect(problems[0].message).toContain('container <plural>-v0-1-0-controller,')
    expect(problems[0].message).toMatch(/the plural of AbCdEfGg+ can run 1 longer than the Kind/)
  })

  // Published krateoplatformops marketplace blueprints at 0.3.0 (their Kinds from aws/CATALOG.md).
  // A flat +3 refused the first two, whose container names are 62 and 63 — valid, and they deploy.
  it.each([
    ['aws-sagemaker-notebookinstancelifecycleconfig', 43],
    ['aws-sagemaker-modelexplainabilityjobdefinition', 44],
  ])('a real blueprint whose every name fits is accepted: %s@0.3.0 (Kind %i)', (name, kindLength) => {
    expect(compositionKind(name)).toHaveLength(kindLength)
    expect(chartIdentityProblems({ ...INPUT, name, version: '0.3.0' })).toEqual([])
  })

  it.each([
    ['aws-bedrockagentcorecontrol-agentruntimeendpoint', 46],
    ['aws-bedrockagentcorecontrol-apikeycredentialprovider', 50],
  ])('a real blueprint whose container name would not fit is still refused: %s@0.3.0 (Kind %i)', (name, kindLength) => {
    expect(compositionKind(name)).toHaveLength(kindLength)
    expect(chartIdentityProblems({ ...INPUT, name, version: '0.3.0' }).map((problem) => problem.field)).toEqual(['name'])
  })

  it('a name that fits at 0.1.0 does not fit at 10.20.30 — the version is half the budget', () => {
    // Kind 42, plural 43: container 61 at v0-1-0, 64 at v10-20-30.
    const name = `a${'b'.repeat(41)}`
    expect(chartIdentityProblems({ ...INPUT, name })).toEqual([])
    const problems = chartIdentityProblems({ ...INPUT, name, version: '10.20.30' })
    expect(problems.map((problem) => problem.field)).toEqual(['name'])
    expect(problems[0].message).toMatch(/^at version 10\.20\.30 the Kind .* at most 41 characters/)
  })

  it('a -quiz Kind\'s +3 is exact, not generous: -quiz pluralises to -quizzes', () => {
    // Kind …Quiz of 42 → plural 45 → container 63 at 0.1.0: fits. Of 43 → 46 → 64: does not.
    expect(chartIdentityProblems({ ...INPUT, name: `${'a'.repeat(38)}-quiz` })).toEqual([])
    expect(chartIdentityProblems({ ...INPUT, name: `${'a'.repeat(39)}-quiz` }).map((problem) => problem.field)).toEqual(['name'])
  })

  it('WARNS, without refusing, a name over the metrics Service budget — the Service exists only with CDC metrics on', () => {
    // Kind 37 at 0.1.0: plural 38, so the container is 56 on every install; the metrics Service
    // would be 64, and exists only where metrics run. (The rule itself — Start would also refuse a
    // 37-character name as unpublishable, below.)
    const name = `a${'b'.repeat(36)}`
    expect(chartIdentityProblems({ name, version: '0.1.0' })).toEqual([])
    const warnings = startChartWarnings({ ...INPUT, name })
    expect(warnings.map((warning) => warning.field)).toEqual(['name'])
    expect(warnings[0].message).toMatch(/^fits every install — but may not fit one that runs core-provider with CDC metrics on .* at most 36 characters \(the plural of Ab+ can run 1 longer\), and Ab+ has 37/)
    expect(startChartWarnings({ ...INPUT, name: `a${'b'.repeat(35)}` })).toEqual([])
    // A name Start takes can still earn the warning, at a longer version: Kind 34 over 33 at 10.20.30.
    const publishable = `a${'b'.repeat(33)}`
    expect(validateStartChart({ ...INPUT, name: publishable, version: '10.20.30' })).toEqual([])
    expect(startChartWarnings({ ...INPUT, name: publishable, version: '10.20.30' }).map((warning) => warning.field)).toEqual(['name'])
  })

  it('a VALID chart can still be unpublishable: Start refuses a name its publish claim cannot carry', () => {
    // The builders publish through a claim named publish-<name>, and core-provider refuses a
    // composition name over 44 — so a name over 36 failed at the LAST step of Publish.
    expect(PUBLISH_NAME_MAX).toBe(36)
    expect(validateStartChart({ ...INPUT, name: `a${'b'.repeat(35)}` })).toEqual([])
    const problems = validateStartChart({ ...INPUT, name: `a${'b'.repeat(36)}` })
    expect(problems.map((problem) => problem.field)).toEqual(['name'])
    expect(problems[0].message).toMatch(/^at most 36 characters to publish \(it has 37\) — publishing creates the claim publish-ab+, and core-provider refuses a composition name longer than 44/)
  })

  it.each([
    'github-scaffolding-with-composition-page',
    'aws-sagemaker-modelexplainabilityjobdefinition',
  ])('a real long-named blueprint is a VALID chart (the lint opens it) but not one Start creates: %s', (name) => {
    expect(chartIdentityProblems({ name, version: '0.3.0' })).toEqual([])
    expect(validateStartChart({ ...INPUT, name, version: '0.3.0' })[0].message).toMatch(/^at most 36 characters to publish/)
  })

  it('says nothing more for a name it already refuses — the refusal is the whole answer', () => {
    expect(startChartWarnings({ ...INPUT, name: `a${'b'.repeat(44)}` })).toEqual([])
  })

  it('a Kind of 60 is refused at ANY version: the CRD\'s list type (Kind + List) must be a 63-character label', () => {
    expect(KIND_MAX).toBe(59)
    const problems = validateStartChart({ ...INPUT, name: `a${'b'.repeat(59)}` })
    expect(problems.map((problem) => problem.field)).toEqual(['name'])
    expect(problems[0].message).toMatch(/can be at most 59 characters — Ab+ has 60, and the CRD's list type Ab+List must fit/)
  })

  it('a version so long that no Kind fits is the VERSION\'s problem, not the name\'s', () => {
    // v1-0-0-aaa… of 50 characters: 63 − 11 − 1 − 50 − 1 < 1 — no room even for a one-letter `s` plural.
    const problems = validateStartChart({ ...INPUT, name: 'x', version: `1.0.0-${'a'.repeat(43)}` })
    expect(problems.map((problem) => problem.field)).toEqual(['version'])
    expect(problems[0].message).toMatch(/leaves no room for any Kind/)
  })

  it.each(['1.0', 'v1.0.0', '01.0.0', '1.0.0.0', 'latest', ''])('version %j is not semantic and is refused', (version) => {
    expect(validateStartChart({ ...INPUT, version }).map((problem) => problem.field)).toEqual(['version'])
  })

  it.each(['1.0.0+build.5', '1.0.0-RC.1'])('version %j is SemVer but would become an API version Kubernetes refuses', (version) => {
    const problems = validateStartChart({ ...INPUT, version })
    expect(problems.map((problem) => problem.field)).toEqual(['version'])
    expect(problems[0].message).toMatch(/API version/)
  })

  it('a lower-case pre-release is fine', () => {
    expect(validateStartChart({ ...INPUT, version: '1.0.0-rc.1' })).toEqual([])
    expect(claimApiVersion('1.0.0-rc.1')).toBe('composition.krateo.io/v1-0-0-rc-1')
  })

  it.each([
    ['github-scaffolding-with-composition-page', '1.2.2'],
    ['portal-composition-page-cloudnative-stack', '1.4.2'],
    ['portal-composition-page-continuous-deployment', '1.0.0'],
  ])('the chart rule does not refuse a real blueprint that deploys on a default install: %s@%s', (name, version) => {
    // The CHART rule — what the lint holds an opened chart to. Start additionally asks that a NEW
    // chart be publishable, which these (over 36) are not; that is its own test above.
    expect(chartIdentityProblems({ name, version })).toEqual([])
  })

  it('reports every bad field at once, so the modal can mark both', () => {
    expect(validateStartChart({ description: '', name: 'Bad', version: 'x' }).map((problem) => problem.field)).toEqual(['name', 'version'])
  })
})

describe('the derivations the Start modal shows as the person types', () => {
  // The right-hand column is NOT hand-written: it is the output of core-provider's own
  // strutil.ToGolangName (copied verbatim) + github.com/gobuffalo/flect v1.0.3 Pascalize, run in Go
  // over the left-hand column. Surprising rows are flect's rules, reproduced on purpose:
  //   · a known acronym is upper-cased wherever it falls (my-api → MyAPI, json-api-url → JSONAPIURL);
  //   · flect splits words only at a lower→upper step, so single letters merge (x-ray → Xray,
  //     a-b-c → Abc, app-id-x → AppIDX) and a digit-led piece joins its neighbour (api-2x → Api2x).
  it.each([
    ['builder-publish', 'BuilderPublish'],
    ['fireworksapp', 'Fireworksapp'],
    ['my-app-2', 'MyApp2'],
    ['k8s-cluster', 'K8sCluster'],
    ['api-gateway', 'APIGateway'],
    ['my-api', 'MyAPI'],
    ['sql-db', 'SQLDb'],
    ['id', 'ID'],
    ['x-ray', 'Xray'],
    ['a-b-c', 'Abc'],
    ['http-proxy-api', 'HTTPProxyAPI'],
    ['pop3-server', 'POP3Server'],
    ['w3c-validator', 'W3CValidator'],
    ['utf8-thing', 'UTF8Thing'],
    ['dns', 'DNS'],
    ['vpn-site-to-site', 'VPNSiteToSite'],
    ['app-id-x', 'AppIDX'],
    ['idp', 'Idp'],
    ['a1-b2', 'A1B2'],
    ['api2-x', 'Api2X'],
    ['api-2x', 'Api2x'],
    ['ok', 'OK'],
    ['okapi', 'Okapi'],
    ['x', 'X'],
    ['db-id', 'DbID'],
    ['json-api-url', 'JSONAPIURL'],
    ['mac-os', 'MACOs'],
    ['ab-cd-ef-gh', 'AbCdEfGh'],
    ['uuid-gen', 'UUIDGen'],
    ['tofu-api', 'TOFUAPI'],
  ])('%s → Kind %s (core-provider: flect.Pascalize(ToGolangName(name)))', (name, kind) => {
    expect(compositionKind(name)).toBe(kind)
  })

  it('0.1.0 → composition.krateo.io/v0-1-0', () => {
    expect(claimApiVersion('0.1.0')).toBe('composition.krateo.io/v0-1-0')
  })

  it('the OCI location needs an owner; without one there is no location to show', () => {
    expect(ociChartLocation('krateo-blueprints', 'builder-publish')).toBe('oci://ghcr.io/krateo-blueprints/charts/builder-publish')
    expect(ociChartLocation('  ', 'builder-publish')).toBeNull()
  })

  it('the OCI location lower-cases the owner, because the registry path is lower-case', () => {
    // The release workflow pushes to ghcr.io/${owner,,}/charts and refuses a CD whose url differs,
    // so an owner typed with capitals must show — and register — where the chart actually is.
    expect(ociChartLocation('Krateo-Blueprints', 'orders-api')).toBe('oci://ghcr.io/krateo-blueprints/charts/orders-api')
  })
})

describe('blueprintCompositionDefinition — what REGISTERS a published blueprint', () => {
  const cd = () => blueprintCompositionDefinition('orders-api', 'Krateo-Blueprints', 'orders-api', '0.1.0')
  const body = () => (cd() ?? '').split('\n').filter((line) => !line.startsWith('#')).join('\n')

  it('is a CompositionDefinition in krateo-system, named for the chart', () => {
    // krateo-system is where the builder deliverables list joins a blueprint to its registration,
    // and where Register writes it.
    expect(body()).toContain('apiVersion: core.krateo.io/v1alpha1\nkind: CompositionDefinition\nmetadata:\n  name: orders-api\n  namespace: krateo-system\n')
  })

  it('points at the chart the release pushes — the owner lower-cased', () => {
    expect(body()).toContain('    url: oci://ghcr.io/krateo-blueprints/charts/orders-api\n')
  })

  it('carries Chart.yaml\'s version LITERALLY — no placeholder for a release to stamp', () => {
    // A merge releases exactly this version, once, so the file on main is what Register applies.
    expect(body()).toContain('    version: 0.1.0\n')
    expect(cd()).not.toContain('CHART_VERSION')
  })

  it('names the Kind and API version it will serve, and the release it is attached to', () => {
    // The destination REPO, not the chart name: they are the same only when the repo is seeded, because the form insists.
    const header = blueprintCompositionDefinition('orders-api', 'acme', 'orders-repo', '1.2.3') ?? ''
    expect(header).toContain('# and serves the Kind OrdersAPI as composition.krateo.io/v1-2-3.')
    expect(header).toContain('https://github.com/acme/orders-repo/releases/tag/1.2.3')
  })

  it('sends a person to Register, not to kubectl', () => {
    // Registering is a person's action in the portal (builder deliverables -> Register).
    expect(cd()).toMatch(/Register it from the portal once release 0\.1\.0 is green \(builder deliverables -> Register\)/)
    expect(cd()).not.toMatch(/kubectl/)
  })

  it('is YAML the release workflow can read — every comment line starts with #', () => {
    // The workflow reads name/url/version with sed, from the first line that starts with the key.
    // A wrapped comment line without its # would be read as the url.
    for (const line of (cd() ?? '').split('\n').filter((each) => /^(\s*)(url|version|name):/.test(each))) {
      expect(line).not.toMatch(/^#/)
    }
    expect((cd() ?? '').split('\n').filter((line) => /^\s*url:/.test(line))).toHaveLength(1)
  })

  it('is null without an owner — a location with no owner is not a location', () => {
    expect(blueprintCompositionDefinition('orders-api', ' ', 'orders-api', '0.1.0')).toBeNull()
  })
})
