/**
 * Running a Table export and handing the browser the file (snowplow#980, 1.12.62).
 *
 * Separate from `tableExport.ts` on purpose: that module is pure and says WHAT to ask for, this one
 * performs the request. It follows the widget fetch's own conventions — same base URL, the caller's
 * bearer token, and a 401 raising the in-place session-resume modal rather than failing the
 * download, because an export is exactly the sort of thing a person starts after leaving a tab open.
 *
 * THE THREE FORMATS FAIL DIFFERENTLY at the 50,000-row bound, and that is the whole reason this is
 * not a two-line fetch:
 *   - csv and json are TRUNCATED: the first 50,000 rows come back with `X-Export-Truncated: true`,
 *     so the file is valid and the caller must say it is partial;
 *   - pdf is NOT truncated: hitting the bound answers 422 with a JSON body and NO FILE, so there is
 *     nothing to download and the caller must show the error instead.
 * Reporting either as a plain success would hand someone a silently incomplete export, which is the
 * failure this whole feature is meant to avoid.
 */
import { getAccessToken } from '../../utils/getAccessToken'

import type { ExportFormat } from './tableExport'

/** snowplow's marker that a csv/json export stopped at the row bound. */
export const TRUNCATED_HEADER = 'x-export-truncated'

export type ExportOutcome =
  /** A file was produced. `truncated` means it holds the first 50,000 rows and no more. */
  | { ok: true; truncated: boolean }
  /** No file. `message` is snowplow's own, when it gave one. */
  | { ok: false; message: string }
  /** The token was refused; the session-resume modal has been raised and the caller shows nothing. */
  | { ok: false; sessionExpired: true; message: string }

export interface ExportTransport {
  /** Injected so the outcome logic is testable without a network or a DOM. */
  fetch?: typeof fetch
  /** Called on a 401, mirroring the widget query's own handling. */
  onSessionExpired?: () => void
  /** Hands the file to the browser. Replaced in tests. */
  deliver?: (blob: Blob, filename: string) => void
}

/** The download the Markdown widget already performs, factored out so both read the same. */
const deliverDefault = (blob: Blob, filename: string): void => {
  const url = URL.createObjectURL(blob)
  const file = document.createElement('a')
  file.href = url
  file.download = filename
  file.click()
  URL.revokeObjectURL(url)
}

/** snowplow's error message, when the body carries one. */
const messageOf = async (response: Response): Promise<string> => {
  try {
    const body: unknown = await response.clone().json()
    const message = (body as { message?: unknown })?.message
    if (typeof message === 'string' && message.length > 0) {
      return message
    }
  } catch {
    // A non-JSON body is normal for some failures; fall through to the status line.
  }
  return `${response.status} ${response.statusText}`.trim()
}

/**
 * Fetch an export and deliver it, returning what the caller must tell the person.
 *
 * `url` is the full widget URL with the export query already on it (`buildExportRequest`).
 */
export const runExport = async (url: string, format: ExportFormat, filename: string, transport: ExportTransport = {}): Promise<ExportOutcome> => {
  const doFetch = transport.fetch ?? fetch
  const deliver = transport.deliver ?? deliverDefault

  let response: Response
  try {
    response = await doFetch(url, { headers: { Authorization: `Bearer ${getAccessToken()}` } })
  } catch (error) {
    return { message: (error as Error).message || 'the export could not be requested', ok: false }
  }

  if (response.status === 401) {
    transport.onSessionExpired?.()
    return { message: 'your session expired before the export finished', ok: false, sessionExpired: true }
  }
  // pdf at the row bound. Named explicitly because it is the ONE case where the request was
  // well-formed, the data was there, and there is still no file to hand over.
  if (response.status === 422 && format === 'pdf') {
    return { message: await messageOf(response), ok: false }
  }
  if (!response.ok) {
    return { message: await messageOf(response), ok: false }
  }

  const truncated = response.headers.get(TRUNCATED_HEADER) === 'true'
  const blob = await response.blob()
  // A zero-byte 200 would otherwise download as an empty file and read as a successful export.
  if (blob.size === 0) {
    return { message: 'the export came back empty', ok: false }
  }
  deliver(blob, filename)
  return { ok: true, truncated }
}
