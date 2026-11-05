/**
 * FE — post-publish LocalResource status for the SCM-agnostic path.
 *
 * A claim publish (buildClaimPublish) POSTs ONE BuilderPublish claim; the builder-publish composition
 * expands it into N git-provider `LocalResource`s named `<publishName>-000..NNN` (one per held file,
 * a deterministic zero-padded index — see helm/builder-publish/templates/localresources.yaml). Each
 * LocalResource CLONES the target repo and commits its file to the builder branch. git-provider does
 * NOT create the repo: a publish to a repository that does not exist fails EVERY LocalResource with a
 * clone/auth error, and until now the rail said nothing after "Open change request" — a publish could
 * sit failed for hours with no signal (observed live: a blueprint publish stuck 12h, 0/6 committed).
 *
 * This module reads each LocalResource's `Synced` condition over the SAME snowplow `/call` transport
 * builderPublishGvr uses (per-user, RBAC-bounded — no new grant), so the rail can show per-file
 * progress and the exact error instead of a silent hang. Read-only: it never writes.
 */

import type { Config } from '../../context/ConfigContext'
import { getAccessToken } from '../../utils/getAccessToken'

import type { AgentikoMessage } from './types'

/** git-provider LocalResource GVR — STABLE (not composition-version-derived like the BuilderPublish claim). */
const LOCALRESOURCE_API_VERSION = 'git.krateo.io/v1alpha1'
const LOCALRESOURCE_RESOURCE = 'localresources'

/** One held file's publish state. `ok`: true = committed, false = failed, null = still reconciling / not created yet. */
export interface LocalResourceStatus {
  /** The held file path this LocalResource carries — the human-facing label (the CR name is index-based). */
  path: string
  /** The deterministic LocalResource CR name (`<publishName>-NNN`). */
  name: string
  ok: boolean | null
  message: string
}

/** The destination a publish targets — named in the status header + the repo-must-exist hint. */
export interface PublishStatusTarget {
  owner: string
  repo: string
  branch: string
}

/** Deterministic LocalResource name for the i-th held file — mirrors the composition's
 *  `printf "%s-%03d" name i`. Exported for the caller + the test. */
export const localResourceName = (publishName: string, index: number): string =>
  `${publishName}-${String(index).padStart(3, '0')}`

/** Read a LocalResource's `Synced` condition. Pure (unit-tested). A missing/!object → still pending. */
export const readLocalResourceCondition = (obj: unknown): { ok: boolean | null; message: string } => {
  if (!obj || typeof obj !== 'object') {
    return { message: 'pending — not created yet', ok: null }
  }
  const conditions = (obj as { status?: { conditions?: unknown } }).status?.conditions
  const list = Array.isArray(conditions) ? conditions : []
  const synced = list.find((entry) => (entry as { type?: unknown })?.type === 'Synced') as
    { status?: unknown; message?: unknown; reason?: unknown } | undefined
  if (!synced) {
    return { message: 'pending — not reconciled yet', ok: null }
  }
  const message = (typeof synced.message === 'string' && synced.message)
    || (typeof synced.reason === 'string' ? synced.reason : '')
  if (synced.status === 'True') {
    return { message: message || 'committed', ok: true }
  }
  return { message: message || 'failed', ok: false }
}

/** GET one LocalResource by name over snowplow `/call`. null on any non-OK (404 = not created yet). */
const fetchLocalResource = async (base: string, namespace: string, name: string): Promise<unknown> => {
  try {
    const url = new URL(`${base.replace(/\/+$/, '')}/call`)
    url.searchParams.set('resource', LOCALRESOURCE_RESOURCE)
    url.searchParams.set('apiVersion', LOCALRESOURCE_API_VERSION)
    url.searchParams.set('name', name)
    url.searchParams.set('namespace', namespace)
    const headers: Record<string, string> = {}
    try {
      headers.Authorization = `Bearer ${getAccessToken()}`
    } catch {
      /* no token (e.g. tests) — send unauthenticated, the server decides */
    }
    const response = await fetch(url.toString(), { headers })
    if (!response.ok) {
      return null
    }
    return await response.json().catch(() => null)
  } catch {
    return null
  }
}

/** Fetch the `Synced` status of every LocalResource a publish rendered (one per held file, in order). */
export const fetchLocalResourceStatuses = async (
  config: Config | undefined,
  namespace: string,
  publishName: string,
  paths: string[],
): Promise<LocalResourceStatus[]> => {
  const base = config?.api.SNOWPLOW_API_BASE_URL
  if (!base) {
    return paths.map((path, index) => ({ message: 'unavailable — no snowplow endpoint configured', name: localResourceName(publishName, index), ok: null, path }))
  }
  return Promise.all(paths.map(async (path, index) => {
    const name = localResourceName(publishName, index)
    const { message, ok } = readLocalResourceCondition(await fetchLocalResource(base, namespace, name))
    return { message, name, ok, path }
  }))
}

/** True once every LocalResource has resolved (committed or failed) — the poll's stop condition. */
export const allResolved = (statuses: LocalResourceStatus[]): boolean =>
  statuses.length > 0 && statuses.every((status) => status.ok !== null)

/** All-pending seed statuses for a publish — the rail's first render, before the first poll round. */
export const pendingStatuses = (publishName: string, paths: string[]): LocalResourceStatus[] =>
  paths.map((path, index) => ({ message: 'pending — not created yet', name: localResourceName(publishName, index), ok: null, path }))

/** One row's status glyph — committed / failed / still reconciling. */
const statusIcon = (ok: boolean | null): string => {
  if (ok === true) { return '✓' }
  if (ok === false) { return '✗' }
  return '…'
}

/** A failed clone/auth almost always means the destination repo does not exist (git-provider clones, it
 *  never creates). Detected so the rail can spell out the fix rather than surfacing the raw git error. */
const looksLikeMissingRepo = (statuses: LocalResourceStatus[]): boolean =>
  statuses.some((status) => status.ok === false && /clone|authentication|not found|no such|credentials/i.test(status.message))

/** Render the statuses as a rail markdown block. Pure (unit-tested): the destination header, the
 *  repo-must-exist precondition when a clone failed, then one line per held file. */
export const summarizePublishStatus = (statuses: LocalResourceStatus[], target: PublishStatusTarget): string => {
  const committed = statuses.filter((status) => status.ok === true).length
  const failed = statuses.filter((status) => status.ok === false).length
  const pending = statuses.filter((status) => status.ok === null).length
  const counts = [`${committed}/${statuses.length} committed`, failed ? `${failed} failed` : '', pending ? `${pending} pending` : '']
    .filter(Boolean)
    .join(', ')
  const head = `**Publishing to \`${target.owner}/${target.repo}\`** on branch \`${target.branch}\` — ${counts}.`
  const lines = statuses.map((status) => `- ${statusIcon(status.ok)} \`${status.path}\` — ${status.message}`)
  const hint = looksLikeMissingRepo(statuses)
    ? `\n\n⚠ A failed clone usually means the repository \`${target.owner}/${target.repo}\` does not exist yet — a publish pushes a branch to an **existing** repository, it does not create it. Create the repository (with an initial \`main\` branch), then publish again.`
    : ''
  return `${head}\n\n${lines.join('\n')}${hint}`
}

/**
 * The bound's closing sentence. A publish that is still pending after the poll window is NOT a
 * failure — it is a publish we stopped watching, and saying otherwise would trade one wrong answer
 * for another. Names how long we watched, so "slow" and "stuck" stop looking identical, and points
 * at where the truth lives.
 */
export const stoppedWatchingNote = (statuses: LocalResourceStatus[], watchedMs: number): string => {
  const pending = statuses.filter((status) => status.ok === null).length
  if (pending === 0) { return '' }
  const failed = statuses.filter((status) => status.ok === false).length
  const seconds = Math.round(watchedMs / 1000)
  return failed > 0
    ? `\n\n⏱ Stopped watching after ${seconds}s with ${pending} file(s) still pending. The failures above are real; the rest may still complete.`
    : `\n\n⏱ Stopped watching after ${seconds}s — ${pending} file(s) still pending and **nothing has failed**. A publish can legitimately take longer than this; publish again to re-check, or look at the LocalResources named \`${statuses[0]?.name.replace(/-\d+$/, '')}-*\` in the cluster.`
}

/** A publish's per-file destination — everything the poll driver needs to address the LocalResources. */
export interface PublishStatusClaim {
  namespace: string
  paths: string[]
  publishName: string
  target: PublishStatusTarget
}

/** The conversation-store setter (same value-or-updater contract as React setState). */
type SetMessages = (updater: (prev: AgentikoMessage[]) => AgentikoMessage[]) => void

/**
 * Seed a rail status message and then poll the publish's LocalResources until every file resolves
 * (committed or failed) or the bound is hit, updating that message each round. Detached + bounded
 * (~30s) + read-only. `makeId` produces the message id; `delayMs`/`rounds` are injectable so the test
 * drives it without real timers. Call it fire-and-forget — it never throws.
 */
export const trackPublishStatus = (
  config: Config | undefined,
  claim: PublishStatusClaim,
  setMessages: SetMessages,
  makeId: () => string,
  delayMs = 2500,
  rounds = 12,
): void => {
  const statusId = makeId()
  const render = (text: string, streaming: boolean): void => {
    setMessages((prev) => (prev.some((message) => message.id === statusId)
      ? prev.map((message) => (message.id === statusId ? { ...message, streaming, text } : message))
      : [...prev, { createdAt: Date.now(), id: statusId, role: 'assistant', streaming, text }]))
  }
  render(summarizePublishStatus(pendingStatuses(claim.publishName, claim.paths), claim.target), true)
  void (async () => {
    let last = pendingStatuses(claim.publishName, claim.paths)
    for (let round = 0; round < rounds; round += 1) {
      // eslint-disable-next-line no-await-in-loop -- poll loop: rounds are sequential by nature
      await new Promise((resolve) => { setTimeout(resolve, delayMs) })
      // eslint-disable-next-line no-await-in-loop -- poll loop
      const statuses = await fetchLocalResourceStatuses(config, claim.namespace, claim.publishName, claim.paths)
      last = statuses
      const resolved = allResolved(statuses)
      render(summarizePublishStatus(statuses, claim.target), !resolved)
      if (resolved) { return }
    }
    // The bound expired with files still pending. Returning here would leave the last render
    // `streaming: true` forever — a message that LOOKS like it is still watching when nothing is.
    // That is the same silence this feature exists to remove, just 30 seconds later, so say plainly
    // that we stopped looking and that a still-pending publish is not a failed one.
    render(`${summarizePublishStatus(last, claim.target)}${stoppedWatchingNote(last, delayMs * rounds)}`, false)
  })()
}
