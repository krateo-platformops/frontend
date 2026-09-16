/**
 * The controller (KOG) builder's chart shape — one authored RestDefinition, one Helm chart, one
 * repository, one CompositionDefinition.
 *
 * WHY THIS EXISTS. KOG used to publish into a single shared registry repo: every controller ever
 * authored landed as `apis/<kind>/restdefinition.yaml` in `krateo-platformops/oas`, whose repo root
 * is itself a chart that CDC renders as ONE singleton composition. That made the controller builder
 * the odd one out — portal-builder and blueprint-builder both emit a per-artifact chart in a
 * per-artifact repo, created on first publish.
 *
 * The registry's only argument was avoiding a CompositionDefinition, and therefore a
 * composition-dynamic-controller Deployment, per artifact. That argument was already overruled for
 * pages: everything Krateo deploys is a composition, which is a Helm release, and 50m CPU / 128Mi is
 * the ordinary cost of shipping anything. If it did not justify collapsing pages into one chart it
 * does not justify collapsing controllers either.
 *
 * WHAT RETIRING THE FIXED REPO REMOVES, beyond the inconsistency:
 *   - the 301/307 class. `krateo-oas` was renamed to `oas`; the frontend kept the old name; GitHub
 *     answered the API call with a redirect a browser follows silently and github-provider-kog dies
 *     on ("unexpected status: 307"). publish-pet sat wedged on exactly that for six days. A name
 *     that is derived from the artifact has nothing to go stale.
 *   - the `spec.repo == "krateo-oas"` discriminator in restaction.kog-deliverables, which existed
 *     only to tell KOG change requests apart from blueprint ones. That is already legacy: the
 *     SCM-agnostic path discriminates on the `krateo.io/builder` label.
 *   - the registry's "a version bump per merge" trade-off, which was recorded as accepted rather
 *     than good.
 *
 * Pure module (js-yaml + string helpers): no React, no network, no module state.
 */

import { dump } from 'js-yaml'

/** Where a chart keeps its manifests. Same convention as an authored page set. */
export const KOG_TEMPLATES_DIR = 'templates'

/**
 * The runtime namespace a committed manifest is created in.
 *
 * Templated, never baked: a chart that hardcodes the authoring namespace installs everywhere the
 * author happened to be working. Unlike a page set there is no tier to resolve — a RestDefinition
 * has no per-audience visibility concern — so the release namespace is the whole answer.
 */
export const KOG_RELEASE_NAMESPACE = '{{ .Release.Namespace }}'

/**
 * `version: CHART_VERSION` is the placeholder the org's release workflow substitutes from the git
 * tag. Writing a real version here would mint a chart claiming a version nothing published.
 *
 * The NAME becomes the generated CRD's Kind, so it is the authored kind itself.
 */
export const kogChartYaml = (kind: string): string => dump({
  apiVersion: 'v2',
  appVersion: 'CHART_VERSION',
  description: `Krateo API Builder — the ${kind} controller.`,
  name: kind,
  type: 'application',
  version: 'CHART_VERSION',
}, { lineWidth: -1, noRefs: true, sortKeys: false })

/**
 * values.schema.json IS the generated CRD's spec — core-provider reads this file and turns it into
 * the CRD, so a chart without one publishes, merges, releases, and then wedges its
 * CompositionDefinition at Ready=False with no CRD to serve.
 *
 * Deliberately closed and near-empty: a controller chart ships one RestDefinition and, in the paste
 * case, its OAS ConfigMap. There is nothing to parameterise yet, and an empty knob in an install
 * form is worse than no knob. NO subschema combinators — an `anyOf` in a values.schema.json is what
 * stranded builder-publish at Ready=False for two releases, because core-provider cannot turn a
 * combinator into a structural CRD.
 */
export const kogValuesSchema = (kind: string): string => `${JSON.stringify({
  $schema: 'http://json-schema.org/draft-07/schema#',
  additionalProperties: false,
  description: `Krateo API Builder — the ${kind} controller.`,
  properties: {},
  title: kind,
  type: 'object',
}, null, 2)}\n`

/** The defaults, written out so the chart's values are readable without parsing a JSON Schema. */
export const kogValuesYaml = (): string =>
  '# This chart ships one RestDefinition (and, for a pasted document, its OAS ConfigMap).\n'
  + '# Nothing is parameterised yet; the manifests are created in the release namespace.\n'
  + '{}\n'

/**
 * The CompositionDefinition that REGISTERS a published controller chart.
 *
 * Without one the chart releases to OCI and nothing installs it: core-provider generates the CRD
 * from values.schema.json and serves it as `composition.krateo.io/v<version>/<plural>`, and only
 * then can a claim put the RestDefinition on a cluster — which is what makes oasgen-provider
 * materialise the real CRD and controller.
 *
 * Written at PUBLISH time rather than into the held draft because it is the one file that depends on
 * the DESTINATION: the OCI url is `<owner>/charts/<chart name>`, and the owner is not settled until
 * the human confirms it.
 *
 * CHART_VERSION is stamped by the release workflow and the stamped copy is attached to the GitHub
 * release, so this file is applied FROM THE RELEASE, never from the branch.
 */
export const kogCompositionDefinition = (kind: string, owner: string): string => `# REGISTERS this controller as installable. Apply the STAMPED copy from the GitHub release, not
# this one: the branch carries the CHART_VERSION placeholder, and registering that pins a chart
# version that was never published.
#
#   kubectl apply -f https://github.com/${owner}/${kind}/releases/download/<tag>/compositiondefinition.yaml
#
# Installing a claim of the generated Kind creates the RestDefinition, which is what makes
# oasgen-provider materialise the ${kind} CRD and its controller. Deleting the claim removes them.
apiVersion: core.krateo.io/v1alpha1
kind: CompositionDefinition
metadata:
  name: ${kind}
  namespace: krateo-system
spec:
  chart:
    url: oci://ghcr.io/${owner}/charts/${kind}
    version: CHART_VERSION
`
