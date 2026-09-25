import { load } from 'js-yaml'
import { describe, expect, it } from 'vitest'

import { draftDisplayName, lintBlueprintDraft } from '../../components/Autopilot/blueprintDraft'

import { ARCHITECTURE_TEMPLATE_PATH, deriveStates, parseArchitecture, serializeArchitecture, unwrapFromConfigMapTemplate } from './architecture'
import { claimApiVersion, compositionKind, ociChartLocation, startChart, validateStartChart } from './startChart'

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
    expect(lintBlueprintDraft(started())).toEqual([])
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

  it('a 63-character name is the limit, not over it', () => {
    expect(validateStartChart({ ...INPUT, name: `a${'b'.repeat(62)}` })).toEqual([])
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
})
