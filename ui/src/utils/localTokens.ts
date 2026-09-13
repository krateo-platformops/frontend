/**
 * Client-side token resolution for widget TEXT — used by Paragraph and by PageHeader.
 *
 * It lived under widgets/Paragraph/ while Paragraph was the only caller. It moved here when the
 * dashboard greeting migrated to PageHeader and shipped reading `Good {localTimeOfDay},
 * {displayName}` LITERALLY on screen: the tokens are resolved by whichever widget renders the
 * string, and the new one did not know to.
 *
 * The chart greeting jq emits literal
 * tokens ({localTimeOfDay}, {displayName}) instead of computing them server-side; the browser
 * resolves them on every render:
 *  - {localTimeOfDay}: snowplow caches a no-apiRef widget's RENDERED output with `now` FROZEN at
 *    resolve time, so a server-side time-of-day is cache-incoherent (an 11:50-Rome user saw a
 *    stale "Good evening"). Resolving in the browser makes the bucket correct for the viewer's
 *    clock AND TZ on every render, immune to snowplow's render cache. See snowplow-cache-coherence.
 *  - {displayName}: the greeting is the ONLY server-side consumer of the login displayName. Under
 *    the identity-injection migration the frontend stops volunteering identity in `?extras=` (see
 *    hooks/useWidgetQuery buildExtrasParam + the api.SNOWPLOW_IDENTITY_INJECTION capability flag),
 *    so the greeting renders the name from the browser's own login state (localStorage `K_user`).
 *    Matches the chart greeting's `.displayName // "there"` fallback so either rollout order reads
 *    identically. See snowplow docs/definitive-cache-identity-architecture-2026-07-07.md §1.2/§4.2.
 */

import { getUserInfo } from './getUserInfo'

export const LOCAL_TIME_OF_DAY_TOKEN = '{localTimeOfDay}'
export const DISPLAY_NAME_TOKEN = '{displayName}'

/** Neutral fallback when the browser holds no logged-in displayName — matches the chart
 * greeting's server-side `.displayName // "there"` so the migration is greeting-invisible. */
export const DISPLAY_NAME_FALLBACK = 'there'

/** Browser-local time-of-day bucket from the viewer's clock (injectable for tests). */
export const localTimeOfDay = (now: Date = new Date()): string => {
  const hour = now.getHours()
  if (hour < 12) { return 'morning' }
  if (hour < 18) { return 'afternoon' }
  return 'evening'
}

/** Name-or-fallback for the greeting: a non-blank displayName, else the neutral "there" (matches
 * the chart greeting's `.displayName // "there"`). PURE — the localStorage read lives in
 * resolveLocalTokens, so this stays trivially testable and never touches the DOM. */
export const viewerDisplayName = (displayName?: string): string => {
  return typeof displayName === 'string' && displayName.trim() !== '' ? displayName : DISPLAY_NAME_FALLBACK
}

/** Replace client-side tokens ({localTimeOfDay}, {displayName}) in a widget text string. A
 * non-string input is returned unchanged; a token-free string reads neither clock nor localStorage
 * (the login-state read fires only when {displayName} is actually present). */
export const resolveLocalTokens = (text: string | undefined): string | undefined => {
  if (typeof text !== 'string') {
    return text
  }
  let out = text
  if (out.includes(LOCAL_TIME_OF_DAY_TOKEN)) {
    out = out.split(LOCAL_TIME_OF_DAY_TOKEN).join(localTimeOfDay())
  }
  if (out.includes(DISPLAY_NAME_TOKEN)) {
    out = out.split(DISPLAY_NAME_TOKEN).join(viewerDisplayName(getUserInfo().displayName))
  }
  return out
}
