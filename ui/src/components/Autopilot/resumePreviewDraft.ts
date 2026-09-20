/**
 * Resuming an in-flight preview — the drafts a person previewed but has not published.
 *
 * WHY THIS EXISTS. A live preview applies its widget CRs to the preview sandbox and renders them
 * with the real server. Those CRs are not scratch: they are unfinished work. Until now they were
 * invisible — the only way back to a draft was to ask Autopilot to compose it again from scratch,
 * and closing a tab lost it silently. The chart even shipped an hourly janitor that DELETED them on
 * a TTL, so a page someone was midway through could vanish while they were away from the desk.
 *
 * The Portal Builder page now lists them (restaction.preview-drafts + table.preview-drafts) and the
 * row carries the slug back here as `?resume=<slug>`. That turns the sandbox from a hidden scratch
 * area into the drafts drawer it always was.
 *
 * IT MUST NOT ARM A TEARDOWN, and that is the whole point rather than an implementation detail. The
 * apply path records teardown ops so a drawer-close removes what that session created. Resuming
 * created nothing — the drafts were already on the cluster before this tab existed — so closing the
 * drawer must leave them exactly where they were. Arming a teardown here would make looking at your
 * own work the thing that destroys it.
 *
 * Pure module: builds a payload and fires the preview bus. No network, no writes, no module state.
 */

import { openAutopilotPreview } from './previewBus'
import { buildSandboxWidgetEndpoint, draftGvrOf, primeDraftKinds } from './previewSandbox'

/** The query parameter the drafts table's rowNavigateTo carries (`/portal-builder?resume=<slug>`). */
export const RESUME_PARAM = 'resume'

/** Slug shape, mirroring startDraft's SLUG_PATTERN: it became a route and a CR name already. */
const SLUG = /^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/

const RESUME_CAPTION
  = 'Picking up where you left off — these drafts are already in the preview sandbox, rendered by '
  + 'the real server with your identity and permissions. Closing this drawer leaves them in place.'

/** Read the slug a resume request carries, or null when there is nothing valid to resume. */
export const resumeSlugFrom = (search: string): string | null => {
  let raw: string | null = null
  try {
    raw = new URLSearchParams(search).get(RESUME_PARAM)
  } catch {
    return null
  }
  // Validated, not trusted: the slug becomes a CR name in the endpoint this opens. A malformed or
  // crafted value must resolve to nothing rather than to a request for someone else's object.
  return raw && SLUG.test(raw) ? raw : null
}

/**
 * Open the live drawer on a draft that is ALREADY in the sandbox.
 *
 * Returns false when the request cannot be honoured — no sandbox configured, or a slug that is not
 * a slug — so the caller can leave the page alone instead of opening an empty drawer.
 */
export const resumePreviewDraft = async (
  slug: string,
  sandboxNamespace: string,
  snowplowBaseUrl?: string,
): Promise<boolean> => {
  // Resolve `Flex` before reading its GVR — see draftGvrOf: an unprimed kind reads as unknown, so
  // without this a resume would refuse itself rather than reopen the drawer.
  await primeDraftKinds([{ kind: 'Flex' }], snowplowBaseUrl)
  const gvr = draftGvrOf('Flex')
  if (!gvr || !sandboxNamespace || !SLUG.test(slug)) {
    return false
  }
  // The page ENTRY is the `page-<slug>` root Flex — the same identity previewPageV2 mounts and the
  // publish gate keys on. Nothing else is a page.
  const root = { gvr, kind: 'Flex', name: `page-${slug}` }
  openAutopilotPreview({
    caption: RESUME_CAPTION,
    liveEndpoint: buildSandboxWidgetEndpoint(root, sandboxNamespace),
    title: `Draft — ${slug}`,
  })

  return true
}
