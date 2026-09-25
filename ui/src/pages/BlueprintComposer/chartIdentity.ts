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
 *   the container      `<plural>-<apiVersion>-controller` (assets/cdc/deployment.yaml): a DNS-1123
 *                      label, at most 63. THE BINDING ONE, because it exists on EVERY install — a name
 *                      over it cannot become a CompositionDefinition anywhere. Refused, here and in
 *                      the lint.
 *   the CDC Service    `<plural>-<apiVersion>-controller-service` (assets/cdc/service.yaml), eight
 *                      longer — but core-provider creates it ONLY with cdc.metrics.enabled, which is
 *                      false in its own chart and in the installer's (deploy.go applies the Service
 *                      only when its template is mounted, and the chart mounts it only under that
 *                      flag). The portal cannot see the setting. Refusing every name over the Service
 *                      budget refused real blueprints that deploy — github-scaffolding-with-
 *                      composition-page@1.2.2 (Kind 36), portal-composition-page-continuous-
 *                      deployment@1.0.0 (Kind 41) — and, through the lint, made them unpreviewable
 *                      and unpublishable. So it is a WARNING, at Start only: a NEW name can leave the
 *                      room for an install that turns metrics on, and is told how much.
 *   everything else    the Deployment, ConfigMaps, ServiceAccount, (Cluster)Roles and bindings are
 *                      `<plural>-<apiVersion>-…` too, but DNS-1123 subdomains (253) or looser.
 *
 * So, with V = the API version's length (`0.1.0` → `v0-1-0`, 6), and plural ≤ Kind + G:
 *
 *   refused    plural + 1 + V + 11 ≤ 63   ⇒   Kind ≤ 51 − V − G   (and Kind ≤ 59 always)
 *   warned     plural + 1 + V + 19 ≤ 63   ⇒   Kind ≤ 43 − V − G   (only with CDC metrics on)
 *
 * G is the most flect v1.0.3 can grow a Kind WITH THIS ENDING (pluralGrowthBound): three for
 * `-child`, `-ez`, `-iz` (children, quizzes), two for `-f -h -o -s -x -y -z` (leaves, matches,
 * potatoes, classes, boxes, policies, waltzes), one for anything else (`s`). A flat three refused
 * real marketplace blueprints whose every name fits — aws-sagemaker-notebookinstancelifecycleconfig
 * @0.3.0 (Kind 43, plural 44, container 62). It is a bound by the last letters, not flect's own
 * answer — run in Go against every suffix rule and dictionary word in flect's tables, and over 1.6M
 * names from a word list (bare, with my-/sql-/aws- before and -api/-dns/-https after), it undercounts
 * none. Porting flect.Pluralize's dictionary to get the rest back would make this rule as wrong as
 * the port. Kind length = the name without its dashes (compositionKind only re-cases letters).
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

/** What core-provider appends to `<plural>-<apiVersion>` to name the CDC's container — on every install. */
export const CDC_CONTAINER_SUFFIX = '-controller'

/** …and its metrics Service, which exists only when core-provider runs with cdc.metrics.enabled. */
export const CDC_SERVICE_SUFFIX = '-controller-service'

/**
 * The most flect v1.0.3 can lengthen a Kind with this ending when it pluralises it (the header):
 * 3 for `-child`/`-ez`/`-iz`, 2 for `-f -h -o -s -x -y -z`, 1 for anything else.
 */
export const pluralGrowthBound = (kind: string): number => {
  const lower = kind.toLowerCase()
  if (/(child|ez|iz)$/.test(lower)) { return 3 }
  return /[fhosxyz]$/.test(lower) ? 2 : 1
}

/** The smallest bound pluralGrowthBound gives (a Kind that only adds `s`): what "no Kind fits this version" is measured with. */
const PLURAL_GROWTH_MIN = 1

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

/** The longest Kind, growing by `growth`, whose `<plural>-<apiVersion><suffix>` fits in a 63-character label. */
const budgetFor = (suffix: string, version: string, growth: number): number =>
  Math.min(KIND_MAX, CHART_NAME_MAX - suffix.length - 1 - compositionVersion(version).length - growth)

/**
 * The longest Kind with `kind`'s ending whose names all fit at this chart version on ANY install —
 * the container bound in the header: min(KIND_MAX, 63 − len("-controller") − 1 − len(apiVersion) −
 * pluralGrowthBound(kind)). At 0.1.0 that is 44 for a Kind that only adds `s`, 42 for a `…Quiz`.
 */
export const kindBudget = (version: string, kind: string): number => budgetFor(CDC_CONTAINER_SUFFIX, version, pluralGrowthBound(kind))

/** The tighter budget on an install that runs CDC metrics (the Service): eight less, 36 at 0.1.0 for an `s` plural. */
export const metricsKindBudget = (version: string, kind: string): number => budgetFor(CDC_SERVICE_SUFFIX, version, pluralGrowthBound(kind))

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
  const budget = kindBudget(version, kind)
  if (versionOk && kind.length > budget) {
    return `at version ${version} the Kind (the name without dashes) can be at most ${budget} characters — ${kind} has ${kind.length}. core-provider names the controller's container <plural>-${compositionVersion(version)}${CDC_CONTAINER_SUFFIX}, a container name is at most ${CHART_NAME_MAX}, and the plural of ${kind} can run ${pluralGrowthBound(kind)} longer than the Kind. A release can lengthen the version (0.9.0 → 0.10.0), so leave room.`
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
  if (budgetFor(CDC_CONTAINER_SUFFIX, version, PLURAL_GROWTH_MIN) < 1) {
    return `becomes the API version ${apiVersion} (${apiVersion.length} characters), which leaves no room for any Kind in the controller container core-provider names <plural>-${apiVersion}${CDC_CONTAINER_SUFFIX} — at most ${CHART_NAME_MAX}`
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

/**
 * What this name, at this version, would NOT survive on an install that runs CDC metrics — the
 * metrics Service's tighter budget (the header). Advice, never a refusal: most installs do not create
 * the Service, and a chart that deploys must stay previewable and publishable. Empty when there is
 * nothing to say — including when the identity is refused outright (its problem says more).
 */
export const chartIdentityWarnings = (identity: ChartIdentity): ChartIdentityProblem[] => {
  if (chartIdentityProblems(identity).length) {
    return []
  }
  const name = identity.name.trim()
  const version = identity.version.trim()
  const kind = compositionKind(name)
  const budget = metricsKindBudget(version, kind)
  if (kind.length <= budget) {
    return []
  }
  return [{
    field: 'name',
    message: `fits every install — but may not fit one that runs core-provider with CDC metrics on (cdc.metrics.enabled): its Service <plural>-${compositionVersion(version)}${CDC_SERVICE_SUFFIX} leaves the Kind at most ${budget} characters (the plural of ${kind} can run ${pluralGrowthBound(kind)} longer), and ${kind} has ${kind.length}. A shorter name leaves that room.`,
  }]
}
