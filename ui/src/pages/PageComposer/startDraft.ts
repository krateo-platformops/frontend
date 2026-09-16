/**
 * Seed an empty page draft — the half that makes this a BUILDER rather than a viewer.
 *
 * WHY THIS IS THE KEYSTONE. Everything else on this page edits a draft that already exists, and
 * until now the only thing that could create one was Autopilot proposing it. So the surface that
 * was built to let a person author a page could only ever receive the agent's. The design's first
 * of "the four things a person does" is *Start a draft*, and its absence quietly inverted the whole
 * premise — the parity rule says the agent is a faster path to a draft, never the only one.
 *
 * WHAT IT SEEDS. The root `Flex` named `page-<slug>` — the page ENTRY, which `previewPageV2`
 * requires by name and `pageRootSlug` reads the slug back out of — plus a `PageHeader`, because a
 * page with no title renders as an unlabelled stack and every shipped portal page has one. Nothing
 * else: what goes ON the page is the author's next decision, and guessing it produces a draft whose
 * defaults look chosen.
 *
 * WHY CONCRETE NAMESPACES. Every page Autopilot publishes today carries one — `pageDraftFiles`
 * dumps the CR verbatim — so this matches the existing publisher rather than inventing a second
 * convention. There is a real argument that a published page should instead carry the literal
 * `{{ .Release.Namespace }}`, the way `form.compose-page` does, since these files are chart
 * TEMPLATES; that is a change to what BOTH publishers emit and it belongs at publish time, not
 * here. Seeding what the cluster already holds keeps this piece honest and reversible.
 */
import { dump } from 'js-yaml'

const WIDGET_API_VERSION = 'widgets.templates.krateo.io/v1beta1'
const DUMP = { lineWidth: -1, noRefs: true, sortKeys: false } as const

/** Lower-case, dashes — it becomes `/‹slug›`, the CR `page-‹slug›`, and the nav fragment's key. */
export const SLUG_PATTERN = /^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/

export interface StartDraftInput {
  /** The page's URL slug and CR-name suffix. */
  slug: string
  /** Human title, rendered by the PageHeader. Defaults to the title-cased slug. */
  title?: string
  /** Namespace both seeded CRs are created in. */
  namespace: string
}

export type StartDraftResult =
  | { ok: true; widgets: Record<string, unknown>[] }
  | { ok: false; error: string }

/** "cost-report" → "Cost Report". Same rule `pageNavFragment` uses for a default sidebar label. */
const titleCaseSlug = (slug: string): string =>
  slug.split(/[-_]+/).filter(Boolean).map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')

export const validateStartDraft = (input: StartDraftInput): string | null => {
  if (!SLUG_PATTERN.test(input.slug)) {
    return 'the slug must be lower-case letters, digits and dashes — it becomes the page URL and two resource names'
  }
  if (!SLUG_PATTERN.test(input.namespace)) {
    return 'a namespace is required — the widget CRDs demand one and default it nowhere'
  }
  return null
}

/**
 * The seed CRs, in the order they are placed.
 *
 * Returns the raw CR objects rather than YAML because that is what `recordPagePreview` takes — the
 * SAME entry point an agent-proposed page goes through, so a human-started draft and a proposed one
 * are byte-identical in how they are held, gated and published. A second seeding path would be a
 * second thing to keep in agreement with the publish rules.
 */
export const startDraft = (input: StartDraftInput): StartDraftResult => {
  const error = validateStartDraft(input)
  if (error) {
    return { error, ok: false }
  }
  const { namespace, slug } = input
  const headerName = `page-${slug}-header`
  const title = input.title?.trim() || titleCaseSlug(slug)

  const header: Record<string, unknown> = {
    apiVersion: WIDGET_API_VERSION,
    kind: 'PageHeader',
    metadata: { name: headerName, namespace },
    // `resourcesRefs` is REQUIRED even though a PageHeader holds no children — the CRD lists it
    // beside `widgetData` in spec.required. Caught by a server dry-run, not by any unit test:
    // "The PageHeader ... is invalid: spec.resourcesRefs: Required value". Empty, because there is
    // genuinely nothing to resolve; the field's presence is what the apiserver checks.
    spec: { resourcesRefs: { items: [] }, widgetData: { title } },
  }

  const root: Record<string, unknown> = {
    apiVersion: WIDGET_API_VERSION,
    kind: 'Flex',
    // `page-<slug>` EXACTLY: previewPageV2 refuses a draft set with no `page-<slug>` root ("the
    // page ENTRY is undefined") and pageRootSlug reads the nav fragment's slug back out of it.
    metadata: { name: `page-${slug}`, namespace },
    spec: {
      resourcesRefs: {
        items: [{
          apiVersion: WIDGET_API_VERSION,
          id: headerName,
          name: headerName,
          namespace,
          resource: 'pageheaders',
          verb: 'GET',
        }],
      },
      widgetData: {
        // Required by the CRD, and carrying exactly what is placed — see structureEdit for the
        // three places a child lives and why omitting this one renders nothing.
        allowedResources: ['pageheaders'],
        gap: 'middle',
        items: [{ resourceRefId: headerName }],
        vertical: true,
      },
    },
  }

  return { ok: true, widgets: [root, header] }
}

/** The seeded CRs as the `{path: yaml}` the Files tab shows — used only for display in tests. */
export const startDraftYaml = (widgets: readonly Record<string, unknown>[]): string[] =>
  widgets.map((widget) => dump(widget, DUMP))
