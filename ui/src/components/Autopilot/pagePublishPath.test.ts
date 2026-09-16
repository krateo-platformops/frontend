/**
 * REGRESSION GUARD — the page-publish DESTINATION, asserted against the live portal chart layout.
 *
 * WHY THIS FILE EXISTS: krateo-platformops/portal restructured `chart/` → `helm/portal/` on
 * 2026-08-03. The frontend kept writing pages into `chart/`, and for five weeks every page publish
 * SUCCEEDED and shipped nothing. Nothing could have caught it: the git-provider creates whatever path
 * it is handed, so the branch pushed, the change request opened green, the merge was clean, and the
 * only symptom was a page that never appeared in the portal. The repo RENAME was survivable —
 * GitHub 301-redirects a stale repo name — but a redirect only fixes which repository you land in; it
 * does nothing for a path inside it. That asymmetry is why the destination is worth its own test.
 *
 * The live facts these assertions encode (if the chart is ever restructured again, re-verify against
 * krateo-platformops/portal itself — not against this file):
 *   - `helm/portal/Chart.yaml` is the chart root, so `helm package` only sees files beneath it;
 *     anything outside is not in the published tgz and cannot render.
 *   - a page's widget CRs render from `helm/portal/templates/<kind-lower>.<name>.yaml`.
 *   - `helm/portal/templates/menu.sidebar-nav.yaml` appends each nav fragment via
 *     `.Files.Glob "files/nav-fragments/*.yaml"`, which is CHART-ROOT-relative and whose `*` does not
 *     cross a `/` — so the fragment must sit exactly one level in, at
 *     `helm/portal/files/nav-fragments/<slug>.yaml`, and must end in `.yaml`.
 *
 * It guards all THREE writers, because the bug was really one of drift between them: the legacy
 * github git-write op set, the BuilderPublish claim (the path that actually runs on installs with
 * AUTOPILOT_PUBLISH_VIA_GIT_PROVIDER=true), and the preview drawer's Files tab — which is the user's
 * only chance to notice a wrong destination before the merge.
 */

import { describe, expect, it } from 'vitest'

import type { BlueprintDraftHeld } from './blueprintDraftStore'
import { PORTAL_PAGE_CHART_ROOT, heldKeyForDisplayedPath, pagePublishFiles, pagePublishPath } from './pageDraft'
import { buildPagePublishOps } from './pagePublish'
import { buildPagePreviewPayload } from './previewBridge'

/** The directory the portal repo abandoned on 2026-08-03 — no writer may emit it again. */
const DEAD_PREFIX = 'chart/'

const SLUG = 'cost-report'
const WIDGETS = [
  { apiVersion: 'widgets.templates.krateo.io/v1beta1', kind: 'Flex', metadata: { name: `page-${SLUG}` }, spec: { widgetData: {} } },
  { apiVersion: 'widgets.templates.krateo.io/v1beta1', kind: 'Card', metadata: { name: 'cost-summary' }, spec: { widgetData: {} } },
]
/** The same page as a held draft: widget CRs keyed <kind-lower>.<name>.yaml. */
const HELD: BlueprintDraftHeld = {
  kind: 'page' as const,
  bytes: 1,
  files: {
    'card.cost-summary.yaml': 'kind: Card\n',
    'flex.page-cost-report.yaml': 'kind: Flex\n',
  },
}

/** Every repo path the legacy github git-write set commits. */
const gitWritePaths = (): string[] => buildPagePublishOps({}, HELD, SLUG)
  .filter((op) => op.gvr.resource === 'repocontents')
  .map((op) => ((op.payload as { spec: { path: string } }).spec.path))

/** Every repo path the BuilderPublish claim commits (the live path on the deployed default). */
const claimPaths = (): string[] => pagePublishFiles(HELD.files).map((file) => file.path)

/** Every repo path the preview drawer shows the user before they confirm. */
const previewPaths = (): string[] => (buildPagePreviewPayload(WIDGETS)?.files ?? []).map((file) => file.path)

describe('page publish destination — the live portal chart root', () => {
  it('the chart root is helm/portal (the packaged chart dir), not the abandoned chart/', () => {
    expect(PORTAL_PAGE_CHART_ROOT).toBe('helm/portal')
  })

  it('NO writer emits the dead chart/ prefix — git-write, claim, and preview alike', () => {
    for (const path of [...gitWritePaths(), ...claimPaths(), ...previewPaths()]) {
      expect(path.startsWith(DEAD_PREFIX)).toBe(false)
      expect(path.startsWith(`${PORTAL_PAGE_CHART_ROOT}/`)).toBe(true)
    }
  })

  it('the claim path prefixes page files instead of dropping them at the repo ROOT', () => {
    // The claim commits `files[].path` verbatim (builder-publish only splits basename/dir), and page
    // held keys are bare identity tokens — publishing them unrouted put every widget CR at the repo
    // root, outside the chart. A path with no directory is the exact failure to catch.
    for (const path of claimPaths()) {
      expect(path).toContain('/')
    }
    expect(claimPaths().sort()).toEqual([
      'helm/portal/templates/card.cost-summary.yaml',
      'helm/portal/templates/flex.page-cost-report.yaml',
    ])
  })

  it('all three writers agree on the destination for the SAME page (no preview/publish drift)', () => {
    expect(claimPaths().sort()).toEqual(gitWritePaths().sort())
    // Every held key is a widget CR now, so the three writers agree on the whole set rather than
    // on a filtered subset — the nav fragment that used to need excluding here is gone.
    expect(previewPaths().sort()).toEqual(gitWritePaths().sort())
  })
})

describe('the round trip back from the drawer (heldKeyForDisplayedPath)', () => {
  /**
   * The drawer DISPLAYS a page file at its repo destination but the draft HOLDS it under a bare
   * identity token. Without a resolver, updateFile's `path in held.files` check refuses every page
   * edit — silently, because a refused edit just leaves the previous bytes standing. That is why
   * per-file editing of a page has never worked, before the dead-path fix or after it.
   */
  it('resolves a displayed page path back to the key the draft holds', () => {
    for (const key of Object.keys(HELD.files)) {
      const displayed = pagePublishPath(key)
      // It really is routed, and it really comes back.
      expect(displayed).not.toBe(key)
      expect(heldKeyForDisplayedPath(displayed, HELD)).toBe(key)
    }
  })

  it('refuses a path that is not held, rather than inventing a key', () => {
    expect(heldKeyForDisplayedPath('helm/portal/templates/flex.page-not-mine.yaml', HELD)).toBeNull()
    expect(heldKeyForDisplayedPath('', HELD)).toBeNull()
  })

  it('never basenames a BLUEPRINT path — two templates could share a name in different directories', () => {
    // A blueprint's held keys ARE repo paths (it carries a Chart.yaml), so they resolve to
    // themselves. Basenaming here would collapse chart/templates/a.yaml and chart/files/a.yaml.
    const blueprint = {
      bytes: 3,
      files: {
        'Chart.yaml': 'name: x',
        'chart/files/service.yaml': 'b',
        'chart/templates/service.yaml': 'a',
      },
      kind: 'blueprint' as const,
    }
    expect(heldKeyForDisplayedPath('chart/templates/service.yaml', blueprint)).toBe('chart/templates/service.yaml')
    expect(heldKeyForDisplayedPath('service.yaml', blueprint)).toBeNull()
  })
})
