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
 * What is left here is the values schema every controller chart carries (controllerStart.ts writes it
 * into a started draft). The rail's one-RestDefinition chart (Chart.yaml, values.yaml, the
 * CompositionDefinition it registered with) went with the legacy rail publish (frontend#429).
 *
 * Pure module: no React, no network, no module state.
 */

/**
 * values.schema.json IS the generated CRD's spec — core-provider reads this file and turns it into
 * the CRD, so a chart without one publishes, merges, releases, and then wedges its
 * CompositionDefinition at Ready=False with no CRD to serve.
 *
 * Deliberately closed and near-empty: a controller chart ships its RestDefinitions and the OAS
 * ConfigMap they read. There is nothing to parameterise yet, and an empty knob in an install
 * form is worse than no knob. NO subschema combinators — an `anyOf` in a values.schema.json is what
 * stranded builder-publish at Ready=False for two releases, because core-provider cannot turn a
 * combinator into a structural CRD.
 *
 * `global` is the one property it declares, and it is not a knob: nobody fills it in. The chart is
 * registered through a CompositionDefinition (controllerCompositionDefinition), composition-dynamic-
 * controller adds a top-level `global` block to the values of every render, and a closed root that
 * does not declare it refuses that block, so no claim of the controller could render (the same
 * defect, and the same fix, as pageValuesSchema). Left open, because the controller decides which
 * keys it carries.
 */
export const kogValuesSchema = (kind: string): string => `${JSON.stringify({
  $schema: 'http://json-schema.org/draft-07/schema#',
  additionalProperties: false,
  description: `Krateo API Builder — the ${kind} controller.`,
  properties: {
    global: {
      description: 'Set by composition-dynamic-controller on every render (composition name, namespace, kind, ...); not for a deployer to fill in.',
      type: 'object',
    },
  },
  title: kind,
  type: 'object',
}, null, 2)}\n`
