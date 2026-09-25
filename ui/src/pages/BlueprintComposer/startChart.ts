/**
 * Seed an empty blueprint chart — the Start modal's kernel. Pure.
 *
 * WHAT IT SEEDS, and why each file is there:
 *   Chart.yaml                  names the chart. Its presence is what makes the held draft a
 *                               BLUEPRINT (`isPageDraft` keys on its absence), and core-provider
 *                               derives the generated Kind and API version from its name/version.
 *   values.yaml                 the defaults; empty until the author places a field.
 *   values.schema.json          IS the generated CRD's spec — core-provider refuses a chart without
 *                               one. `{type: object, properties: {}}` and nothing else: an object or
 *                               array `default` is the core-provider#46 wedge (lintBlueprintDraft).
 *   templates/architecture.yaml the empty descriptor, wrapped as the ConfigMap template the
 *                               composition detail page reads. The graph starts from it.
 * Nothing else: what the chart deploys is the author's next decision, and a guessed resource
 * would look chosen.
 *
 * THE DERIVATIONS the modal shows as the person types are core-provider's own rules, ported so the
 * preview cannot promise a Kind the cluster will not generate (go/core-provider/internal/tools/
 * chart/chartfs/gvr.go): group `composition.krateo.io`; version `v` + the chart version with dots as
 * dashes; Kind `flect.Pascalize(strutil.ToGolangName(name))` — including flect's acronym rule, so
 * `api-gateway` is `APIGateway`, not `ApiGateway`.
 */
import { dump } from 'js-yaml'

import { CHART_YAML_PATH, VALUES_SCHEMA_PATH } from '../../components/Autopilot/blueprintDraft'
import { SLUG_PATTERN } from '../PageComposer/startDraft'

import { ARCHITECTURE_API_VERSION, ARCHITECTURE_KIND, ARCHITECTURE_TEMPLATE_PATH, serializeArchitecture, wrapAsConfigMapTemplate } from './architecture'

export const VALUES_YAML_PATH = 'values.yaml'

/** A DNS-1123 label's limit — the chart name becomes release, resource and CRD names. */
export const CHART_NAME_MAX = 63

export const COMPOSITION_GROUP = 'composition.krateo.io'

export interface StartChartInput {
  name: string
  version: string
  description: string
}

export interface StartChartProblem {
  field: keyof StartChartInput
  message: string
}

export type StartChartResult =
  | { ok: true; files: Record<string, string> }
  | { ok: false; problems: StartChartProblem[] }

// semver.org's own pattern: MAJOR.MINOR.PATCH, optional -prerelease, optional +build.
const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/

// A Kubernetes API version is a DNS-1035 label: lower-case, starts with a letter, at most 63.
const API_VERSION_LABEL = /^[a-z]([-a-z0-9]*[a-z0-9])?$/

/**
 * flect v1.0.3's baseAcronyms that an all-caps lookup can hit (acronyms.go). flect upper-cases a
 * word it finds here, so a chart named `sql-db` generates `SQLDb`. The mixed-case entries
 * (`Mbps`, `WiFi` …) are omitted: flect looks words up upper-cased, so they can never match.
 */
const ACRONYMS = new Set([
  'ACK', 'ACL', 'ADSL', 'AES', 'ANSI', 'API', 'ARP', 'ATM', 'BGP', 'BSS', 'CCITT', 'CHAP', 'CIDR', 'CIR', 'CLI',
  'CMOS', 'CPE', 'CPU', 'CRC', 'CRT', 'CSMA', 'DCE', 'DEC', 'DES', 'DHCP', 'DMI', 'DNS', 'DRAM', 'DSL', 'DSLAM',
  'DTE', 'EHA', 'EIA', 'EIGRP', 'EOF', 'ESS', 'FCC', 'FCS', 'FDDI', 'FTP', 'GBIC', 'GEPOF', 'HDLC', 'HTML', 'HTTP',
  'HTTPS', 'IANA', 'ICMP', 'ID', 'IDF', 'IDS', 'IEEE', 'IETF', 'IMAP', 'IP', 'IPS', 'ISDN', 'ISP', 'JSON', 'JWT',
  'LACP', 'LAN', 'LAPB', 'LAPF', 'LLC', 'MAC', 'MC', 'MDF', 'MIB', 'MPLS', 'MTU', 'NAC', 'NAT', 'NBMA', 'NIC',
  'NRZ', 'NRZI', 'NVRAM', 'OK', 'OSI', 'OSPF', 'OUI', 'PAP', 'PAT', 'PC', 'PCM', 'PDU', 'PIM', 'POP3', 'POTS',
  'PPP', 'PPTP', 'PTT', 'PVST', 'RAM', 'RARP', 'RCP', 'RFC', 'RIP', 'RLL', 'ROM', 'RSTP', 'RTP', 'SDLC', 'SFD',
  'SFP', 'SLARP', 'SLIP', 'SMTP', 'SNA', 'SNAP', 'SNMP', 'SOF', 'SQL', 'SRAM', 'SSH', 'SSID', 'STP', 'SYN', 'TDM',
  'TFTP', 'TIA', 'TOFU', 'UDP', 'URI', 'URL', 'USB', 'UTF8', 'UTP', 'UUID', 'VC', 'VLAN', 'VLSM', 'VPN', 'W3C',
  'WAN', 'WEP', 'WPA', 'WWW',
])

const isAcronym = (word: string): boolean => ACRONYMS.has(word.toUpperCase())
const isUpper = (char: string): boolean => char >= 'A' && char <= 'Z'

/** strutil.ToGolangName: split on anything not a letter or digit, capitalise each piece's first letter. */
const toGolangName = (name: string): string => {
  const pieces = name.split(/[^A-Za-z0-9]+/).filter(Boolean)
  const joined = pieces.map((piece) => piece.charAt(0).toUpperCase() + piece.slice(1)).join('')
  return /^\d/.test(joined) ? `_${joined}` : joined
}

/** flect.toParts for an alphanumeric identifier: words start at an upper-case letter. */
const flectParts = (ident: string): string[] => {
  if (isAcronym(ident)) { return [ident.toUpperCase()] }
  const parts: string[] = []
  const push = (word: string): void => {
    if (word) { parts.push(isAcronym(word) ? word.toUpperCase() : word) }
  }
  let word = ''
  let prev = ''
  for (const char of ident) {
    if (isUpper(char) && (!isUpper(prev) || isAcronym(word))) {
      push(word)
      word = ''
    }
    word += char
    prev = char
  }
  push(word)
  return parts
}

/** flect.Pascalize: camelize (first word lower-cased, the rest capitalised), then raise the head. */
const pascalize = (ident: string): string => {
  const parts = flectParts(ident)
  const camel = parts
    .map((part, idx) => {
      const clean = part.replace(/[^A-Za-z0-9]/g, '')
      return idx === 0 ? clean.toLowerCase() : clean.charAt(0).toUpperCase() + clean.slice(1)
    })
    .join('')
  if (!camel || !parts.length) { return camel }
  const head = isAcronym(parts[0]) ? parts[0].length : 1
  return camel.slice(0, head).toUpperCase() + camel.slice(head)
}

/** The Kind core-provider generates for a chart name: `builder-publish` → `BuilderPublish`. */
export const compositionKind = (name: string): string => pascalize(toGolangName(name.trim()))

/** The generated API version for a chart version: `0.1.0` → `v0-1-0`. */
export const compositionVersion = (version: string): string => `v${version.trim().replace(/\./g, '-')}`

/** The claim's apiVersion: `0.1.0` → `composition.krateo.io/v0-1-0`. */
export const claimApiVersion = (version: string): string => `${COMPOSITION_GROUP}/${compositionVersion(version)}`

/**
 * Where the release workflow pushes the chart — the convention pageDraft.ts and kogChart.ts write
 * into their CompositionDefinitions. Null until an owner is known: a location with an empty owner
 * segment is not a location.
 */
export const ociChartLocation = (owner: string, name: string): string | null => {
  const who = owner.trim()
  return who ? `oci://ghcr.io/${who}/charts/${name.trim()}` : null
}

export const validateStartChart = (input: StartChartInput): StartChartProblem[] => {
  const problems: StartChartProblem[] = []
  const name = input.name.trim()
  const version = input.version.trim()
  if (!SLUG_PATTERN.test(name)) {
    problems.push({ field: 'name', message: 'lower-case letters, digits and dashes, starting and ending with a letter or digit — it names the chart, its releases and the generated resource' })
  } else if (name.length > CHART_NAME_MAX) {
    problems.push({ field: 'name', message: `at most ${CHART_NAME_MAX} characters — it becomes Kubernetes resource names` })
  } else if (/^\d/.test(name)) {
    problems.push({ field: 'name', message: `must start with a letter — the generated Kind (${compositionKind(name)}) cannot begin with a digit` })
  }
  if (!SEMVER.test(version)) {
    problems.push({ field: 'version', message: 'a semantic version such as 0.1.0 (MAJOR.MINOR.PATCH)' })
  } else if (!API_VERSION_LABEL.test(compositionVersion(version)) || compositionVersion(version).length > CHART_NAME_MAX) {
    problems.push({ field: 'version', message: `becomes the API version ${compositionVersion(version)}, which Kubernetes refuses — no build metadata (+…) and a lower-case pre-release tag` })
  }
  return problems
}

/** Build by assignment: the lint alphabetises object literals, and a file's key order is its format. */
const chartYaml = (name: string, version: string, description: string): string => {
  const chart: Record<string, string> = {}
  chart.apiVersion = 'v2'
  chart.name = name
  if (description) { chart.description = description }
  chart.type = 'application'
  chart.version = version
  return dump(chart, { lineWidth: -1, noRefs: true, sortKeys: false })
}

const valuesSchema = (): string => {
  const schema: Record<string, unknown> = {}
  schema.$schema = 'http://json-schema.org/draft-07/schema#'
  schema.type = 'object'
  schema.properties = {}
  return `${JSON.stringify(schema, null, 2)}\n`
}

const VALUES_YAML = '# Defaults for this blueprint. Every field placed in values.schema.json gets its default here.\n{}\n'

export const startChart = (input: StartChartInput): StartChartResult => {
  const problems = validateStartChart(input)
  if (problems.length) {
    return { ok: false, problems }
  }
  const name = input.name.trim()
  const descriptor = serializeArchitecture({ apiVersion: ARCHITECTURE_API_VERSION, chart: name, kind: ARCHITECTURE_KIND, resources: [] })
  const files: Record<string, string> = {}
  files[CHART_YAML_PATH] = chartYaml(name, input.version.trim(), input.description.trim())
  files[VALUES_YAML_PATH] = VALUES_YAML
  files[VALUES_SCHEMA_PATH] = valuesSchema()
  files[ARCHITECTURE_TEMPLATE_PATH] = wrapAsConfigMapTemplate(descriptor, name)
  return { files, ok: true }
}
