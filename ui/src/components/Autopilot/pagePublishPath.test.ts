/**
 * REGRESSION GUARD — the page-publish DESTINATION, and the agreement between the writers of it.
 *
 * WHY THIS FILE EXISTS: krateo-platformops/portal restructured `chart/` → `helm/portal/` on
 * 2026-08-03. The frontend kept writing pages into `chart/`, and for five weeks every page publish
 * SUCCEEDED and shipped nothing. Nothing could have caught it: the git-provider creates whatever
 * path it is handed, so the branch pushed, the change request opened green, the merge was clean,
 * and the only symptom was a page that never appeared. A repo RENAME is survivable — GitHub
 * 301-redirects a stale repo name — but a redirect fixes which repository you land in and does
 * nothing for a path inside it. That asymmetry is why the destination is worth its own test.
 *
 * WHAT CHANGED, and why this file still exists. A page set is now its own Helm chart rather than
 * files posted into the portal's chart. Its held keys are already chart-relative — `Chart.yaml`,
 * `templates/flex.page-<slug>.yaml` — exactly as a blueprint's always were, so the routing step
 * this file used to guard is gone and `pagePublishPath` is the identity function.
 *
 * The DRIFT it guards is not gone. The bug was never really about one prefix; it was about three
 * writers computing a destination independently — the legacy github git-write op set, the
 * BuilderPublish claim (the path that runs when AUTOPILOT_PUBLISH_VIA_GIT_PROVIDER=true), and the
 * preview drawer's Files tab, which is the user's only chance to notice a wrong destination before
 * the merge. Three computations can still disagree; now they must agree on doing nothing.
 */

import { describe, expect, it } from 'vitest'

import { heldPublishFiles, type BlueprintDraftHeld } from './blueprintDraftStore'
import { heldKeyForDisplayedPath, pagePublishPath } from './pageDraft'
import { buildPagePublishOps } from './pagePublish'
import { buildPagePreviewPayload } from './previewBridge'

/** The directory the portal repo abandoned on 2026-08-03 — no writer may emit it again. */
const DEAD_PREFIX = 'chart/'

const SLUG = 'cost-report'
const WIDGETS = [
  { apiVersion: 'widgets.templates.krateo.io/v1beta1', kind: 'Flex', metadata: { name: `page-${SLUG}` }, spec: { widgetData: {} } },
  { apiVersion: 'widgets.templates.krateo.io/v1beta1', kind: 'Card', metadata: { name: 'cost-summary' }, spec: { widgetData: {} } },
]

/** The same page as a held draft — a chart tree, keyed exactly as it is committed. */
const HELD: BlueprintDraftHeld = {
  bytes: 1,
  files: {
    'Chart.yaml': 'name: cost-report\n',
    'templates/card.cost-summary.yaml': 'kind: Card\n',
    'templates/flex.page-cost-report.yaml': 'kind: Flex\n',
    'values.schema.json': '{}\n',
  },
  kind: 'page',
}

const specOf = (op: { payload?: unknown }) => (op.payload as { spec: Record<string, string> }).spec
const gitWritePaths = () => buildPagePublishOps({}, HELD, SLUG)
  .filter((op) => op.gvr.resource === 'repocontents').map((op) => specOf(op).path)
const claimPaths = () => heldPublishFiles(HELD.files).map((file) => file.path)
const previewPaths = () => (buildPagePreviewPayload(WIDGETS).files ?? []).map((file) => file.path)

describe('page publish destination — a page set is its own chart', () => {
  it('the held key IS the committed path — there is no routing step left', () => {
    // pagePublishPath prefixed `helm/portal/templates/` while a page's keys were bare tokens
    // destined for the PORTAL's chart. Prefixing chart-relative keys would reintroduce the exact
    // double-prefix this module used to warn about, with the sides swapped.
    expect(pagePublishPath('templates/flex.page-cost-report.yaml')).toBe('templates/flex.page-cost-report.yaml')
    expect(pagePublishPath('Chart.yaml')).toBe('Chart.yaml')
  })

  it('commits the chart files a CompositionDefinition needs, not only the templates', () => {
    // Without Chart.yaml there is no chart; without values.schema.json core-provider cannot build
    // the CRD, so the chart publishes, merges, releases and then wedges at Ready=False.
    expect(claimPaths().sort()).toEqual([
      'Chart.yaml',
      'templates/card.cost-summary.yaml',
      'templates/flex.page-cost-report.yaml',
      'values.schema.json',
    ])
  })

  it('NO writer emits the dead chart/ prefix — git-write, claim, and preview alike', () => {
    for (const path of [...gitWritePaths(), ...claimPaths(), ...previewPaths()]) {
      expect(path.startsWith(DEAD_PREFIX)).toBe(false)
    }
  })

  it('all three writers agree on the destination for the SAME page (no preview/publish drift)', () => {
    // The preview is built from the CRs and so carries no Chart.yaml or values.schema.json; it must
    // agree with the publish on exactly the files it does describe.
    expect(previewPaths().sort()).toEqual(gitWritePaths().filter((path) => path.startsWith('templates/')).sort())
    expect(claimPaths().filter((path) => path.startsWith('templates/')).sort()).toEqual(previewPaths().sort())
  })
})

describe('the preview names the destination the publish will actually use', () => {
  it('derives the repo from the page root, never a constant', () => {
    // It read `repo: 'portal'`, hardcoded — true only while every page was a file in the portal's
    // one chart. Post-#277 a page set is its own chart in its own repo named for the slug, so the
    // drawer was promising a destination the publish would not use. The drawer is the one place a
    // person can catch a wrong destination before a merge, which is exactly what makes a stale
    // constant here expensive.
    expect(buildPagePreviewPayload(WIDGETS).publishTarget?.repo).toBe(SLUG)
  })

  it('OMITS the chip entirely when there is no page root, rather than guessing', () => {
    // The surface renders on `payload.publishTarget ?`, so omitting hides the chip. A blank or
    // invented repo would be worse than no claim at all.
    const rootless = [{ apiVersion: 'widgets.templates.krateo.io/v1beta1', kind: 'Card', metadata: { name: 'lonely' }, spec: { widgetData: {} } }]
    expect(buildPagePreviewPayload(rootless).publishTarget).toBeUndefined()
  })

  it('carries no hardcoded repo literal at all', () => {
    // #163 and the braghettos -> krateo-platformops migration: a baked-in org or repo turns a
    // rename into a required frontend rebuild, which is why builderTargets forbids one.
    expect(JSON.stringify(buildPagePreviewPayload(WIDGETS))).not.toContain('"portal"')
  })
})

describe('the round trip back from the drawer (heldKeyForDisplayedPath)', () => {
  it('a page path resolves to itself, the way a blueprint path always did', () => {
    // The inversion this used to perform is gone with the routing: the drawer now displays a page
    // file at the key the draft holds it under, so an edit comes back addressed correctly.
    for (const key of Object.keys(HELD.files)) {
      expect(heldKeyForDisplayedPath(key, HELD)).toBe(key)
    }
  })

  it('refuses a path that is not held, rather than inventing a key', () => {
    expect(heldKeyForDisplayedPath('templates/flex.page-not-mine.yaml', HELD)).toBeNull()
    expect(heldKeyForDisplayedPath('', HELD)).toBeNull()
  })

  it('never basenames — two templates could share a name in different directories', () => {
    const blueprint: BlueprintDraftHeld = {
      bytes: 3,
      files: { 'Chart.yaml': 'name: x', 'chart/files/service.yaml': 'b', 'chart/templates/service.yaml': 'a' },
      kind: 'blueprint',
    }

    expect(heldKeyForDisplayedPath('chart/templates/service.yaml', blueprint)).toBe('chart/templates/service.yaml')
    expect(heldKeyForDisplayedPath('service.yaml', blueprint)).toBeNull()
  })
})
