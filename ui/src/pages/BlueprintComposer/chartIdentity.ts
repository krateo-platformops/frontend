/**
 * A blueprint chart's IDENTITY — its Chart.yaml name and version — and whether every name
 * core-provider derives from it can exist. Pure. ONE rule, run in two places:
 *
 *   - the Start modal (validateStartChart), as the person types a name and a first version;
 *   - the draft lint (lintBlueprintDraft), on the held Chart.yaml after EVERY write.
 *
 * The lint is not a formality. The version is half of the identity and it CHANGES over a chart's
 * life — every release bumps Chart.yaml — and the longest name core-provider creates grows with it.
 * A name that fit at 0.1.0 can stop fitting at 10.20.30, and nothing at Start can see that coming.
 *
 * WHAT core-provider CREATES, and the limit each one sets (core-provider helm/core-provider/assets,
 * rendered by internal/tools/deploy/deploy.go, which returns the apply error — the
 * CompositionDefinition wedges; NOTHING truncates these names):
 *
 *   the CRD            plural `lower(flect.Pluralize(Kind))`, singular `lower(Kind)` and list type
 *                      `Kind + "List"` (plumbing crdgen, transpile.go). apiextensions validates each,
 *                      lower-cased, as a DNS-1035 label: at most 63. ListKind is the longest → Kind ≤ 59.
 *   the CDC Service    `<plural>-<apiVersion>-controller-service` (assets/cdc/service.yaml). A Service
 *                      name is a DNS-1035 label: at most 63. THE BINDING ONE. core-provider creates it
 *                      when its chart runs with cdc.metrics.enabled (off in the chart's own defaults);
 *                      the portal cannot see that setting, so the rule assumes the install has it on.
 *   the container      `<plural>-<apiVersion>-controller` (assets/cdc/deployment.yaml): a DNS-1123
 *                      label, eight shorter than the Service, so the Service bounds it too — and it
 *                      is what binds, eight characters looser, on an install without the Service.
 *   everything else    the Deployment, ConfigMaps, ServiceAccount, (Cluster)Roles and bindings are
 *                      `<plural>-<apiVersion>-…` too, but DNS-1123 subdomains (253) or looser.
 *
 * So, with V = the API version's length (`0.1.0` → `v0-1-0`, 6):
 *
 *   plural + 1 + V + 19 ≤ 63   and   plural ≤ Kind + 3   ⇒   Kind ≤ 40 − V   (and Kind ≤ 59 always)
 *
 * The +3 is flect v1.0.3's worst growth — `-s` is one, `-es`/`y → ies` one or two, `child →
 * children` and `quiz → quizzes` three (measured by running flect in Go). It is the bound, not
 * flect's own answer: a Kind whose plural only adds `s` is refused two characters early. Porting
 * flect.Pluralize's dictionary to get those two back would make this rule as wrong as the port.
 * Kind length = the name without its dashes (compositionKind only re-cases letters).
 *
 * THE DERIVATIONS are core-provider's own rules, ported so the modal cannot promise a Kind the
 * cluster will not generate (go/core-provider/internal/tools/chart/chartfs/gvr.go): group
 * `composition.krateo.io`; version `v` + the chart version with dots as dashes; Kind
 * `flect.Pascalize(strutil.ToGolangName(name))` — including flect's acronym rule, so `api-gateway`
 * is `APIGateway`, not `ApiGateway`.
 */

/** A DNS-1123/1035 label's limit — what a chart name, a plural, a version and a Service name share. */
export const CHART_NAME_MAX = 63

/**
 * The longest Kind whose CRD can exist at ANY version: `lower(Kind + "List")` must fit in 63. The
 * version-dependent Service budget (kindBudget) is always tighter today; this is the ceiling that
 * holds even if core-provider ever renames or truncates its Service.
 */
export const KIND_MAX = CHART_NAME_MAX - 'List'.length

/** What core-provider appends to `<plural>-<apiVersion>` to name the CDC's Service. */
export const CDC_SERVICE_SUFFIX = '-controller-service'

/** flect v1.0.3's longest plural suffix growth: `quiz → quizzes`, `child → children`. */
export const PLURAL_GROWTH_MAX = 3

export const COMPOSITION_GROUP = 'composition.krateo.io'

export interface ChartIdentity {
  name: string
  version: string
}

export interface ChartIdentityProblem {
  field: keyof ChartIdentity
  message: string
}

// Lower-case alphanumerics and dashes, alphanumeric at both ends. The length is checked apart so the
// refusal can say which of the two it was.
const DNS_LABEL = /^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/

// semver.org's own pattern: MAJOR.MINOR.PATCH, optional -prerelease, optional +build.
const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/

// A Kubernetes API version is a DNS-1035 label: lower-case, starts with a letter.
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
 * The longest Kind whose names all fit at this chart version — the formula in the header:
 * min(KIND_MAX, 63 − len("-controller-service") − 1 − len(apiVersion) − PLURAL_GROWTH_MAX).
 * At 0.1.0 that is 34; at 10.20.30, 31. Below 1, no Kind fits and the VERSION is the problem.
 */
export const kindBudget = (version: string): number =>
  Math.min(KIND_MAX, CHART_NAME_MAX - CDC_SERVICE_SUFFIX.length - 1 - compositionVersion(version).length - PLURAL_GROWTH_MAX)

/**
 * The part of the rule EVERY chart name obeys, a page set's included: a DNS-1123 label. The name
 * becomes the repository, the branch, the release and the claim, and whichever of those checks
 * first fails the publish. Null when it is one.
 */
export const chartNameProblem = (raw: string): string | null => {
  const name = raw.trim()
  if (!DNS_LABEL.test(name)) {
    return 'not a valid chart name — lower-case letters, digits and dashes, starting and ending with a letter or digit; it names the chart, its releases, its repository and the generated resource'
  }
  if (name.length > CHART_NAME_MAX) {
    return `not a valid chart name — at most ${CHART_NAME_MAX} characters (it has ${name.length}); it becomes Kubernetes resource names`
  }
  return null
}

const nameProblem = (name: string, version: string, versionOk: boolean): string | null => {
  const label = chartNameProblem(name)
  if (label) {
    return label
  }
  const kind = compositionKind(name)
  if (/^\d/.test(name)) {
    return `must start with a letter — the generated Kind (${kind}) cannot begin with a digit`
  }
  if (kind.length > KIND_MAX) {
    return `the Kind (the name without dashes) can be at most ${KIND_MAX} characters — ${kind} has ${kind.length}, and the CRD's list type ${kind}List must fit in a ${CHART_NAME_MAX}-character DNS label`
  }
  // Only at a version that is itself valid: an unreadable version has no budget to measure against,
  // and its own refusal says so. The name is checked again the moment the version reads.
  const budget = kindBudget(version)
  if (versionOk && kind.length > budget) {
    return `at version ${version} the Kind (the name without dashes) can be at most ${budget} characters — ${kind} has ${kind.length}. core-provider names the controller's metrics Service <plural>-${compositionVersion(version)}${CDC_SERVICE_SUFFIX}, a Service name is at most ${CHART_NAME_MAX}, and the plural can run ${PLURAL_GROWTH_MAX} longer than the Kind. A release can lengthen the version (0.9.0 → 0.10.0), so leave room.`
  }
  return null
}

const versionProblem = (version: string): string | null => {
  if (!SEMVER.test(version)) {
    return 'a semantic version such as 0.1.0 (MAJOR.MINOR.PATCH)'
  }
  const apiVersion = compositionVersion(version)
  if (!API_VERSION_LABEL.test(apiVersion)) {
    return `becomes the API version ${apiVersion}, which Kubernetes refuses — no build metadata (+…) and a lower-case pre-release tag`
  }
  if (kindBudget(version) < 1) {
    return `becomes the API version ${apiVersion} (${apiVersion.length} characters), which leaves no room for any Kind in the controller's metrics Service core-provider names <plural>-${apiVersion}${CDC_SERVICE_SUFFIX} — at most ${CHART_NAME_MAX}`
  }
  return null
}

/**
 * Every reason this name, at this version, cannot become a CompositionDefinition — at most one per
 * field, so the Start modal can mark each field once. Empty: every name core-provider will create
 * from it is legal.
 */
export const chartIdentityProblems = (identity: ChartIdentity): ChartIdentityProblem[] => {
  const name = identity.name.trim()
  const version = identity.version.trim()
  const problems: ChartIdentityProblem[] = []
  const versionMessage = versionProblem(version)
  const nameMessage = nameProblem(name, version, versionMessage === null)
  if (nameMessage) {
    problems.push({ field: 'name', message: nameMessage })
  }
  if (versionMessage) {
    problems.push({ field: 'version', message: versionMessage })
  }
  return problems
}
