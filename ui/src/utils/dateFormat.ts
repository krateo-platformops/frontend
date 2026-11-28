/**
 * Dates and ages, written one way on every page (approved design "Dates and ages", 2026-11-24; visual
 * audit TIME-1 and TIME-2). Before it the portal wrote the same kind of value about twelve ways ("7w",
 * "49d ago", "19 d 23 h", "September 10, 2026" in an age column beside "4w", "2026-11-04 10:10 UTC", a
 * raw RFC3339 stamp), and charts were in the browser's zone while text was in UTC.
 *
 * Four forms, and only these:
 * - `age`, how old, in a column: "7 weeks".
 * - `ago`, how long ago, in a sentence: "52 minutes ago".
 * - `moment`, a point in time: "4 Nov, 11:10" this year, "10 Sep 2025, 09:30" another year.
 * - `date`, a calendar day, the moment without its clock: "4 Nov", "10 Sep 2025".
 * Every one of them carries the full date on hover and focus (`formatFull`):
 * "Wed 4 November 2026, 11:10:27 (UTC+1)".
 *
 * Always the VIEWER's time zone (the browser's), text and charts alike: `timeZone` is a parameter only
 * so a test can pin one. Built on Intl, so a locale can be passed once the portal has i18n
 * (frontend#317); until then every caller gets English.
 *
 * Thresholds, on whole units (rounded down, as kubectl does): under a minute "just now"; then minutes;
 * hours; days up to 6; weeks up to 8 (under 60 days); months up to 11; then years.
 */

export type TimeForm = 'age' | 'ago' | 'date' | 'moment'

export interface TimeFormatOptions {
  /** BCP 47 locale. English until the portal has i18n (frontend#317). */
  locale?: string
  /** The clock, as an epoch in milliseconds. Defaults to `Date.now()`. */
  now?: number
  /** An IANA zone. Leave it out: the default is the viewer's own zone. Tests pin one. */
  timeZone?: string
}

const DEFAULT_LOCALE = 'en'

/** An RFC3339 / ISO-8601 date or date-time. Anything else is not read as a time: `Date.parse` accepts "5". */
const ISO_RE = /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/i
const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/

/**
 * The instant a value names, or undefined when it names none: a `Date`, an epoch in milliseconds, or an
 * ISO string (fractions of any length, "2026-10-06T04:35:04.158732159Z" included).
 */
export const toInstant = (value: unknown): Date | undefined => {
  if (value instanceof Date) { return Number.isNaN(value.getTime()) ? undefined : value }
  if (typeof value === 'number') { return Number.isFinite(value) ? new Date(value) : undefined }
  if (typeof value !== 'string' || !ISO_RE.test(value.trim())) { return undefined }
  const at = Date.parse(value.trim())
  return Number.isNaN(at) ? undefined : new Date(at)
}

/**
 * A date with no time ("2026-09-18") is a calendar day, not midnight UTC: it is written in UTC so a
 * viewer west of Greenwich does not read the day before.
 */
const zoneFor = (value: unknown, timeZone: string | undefined): string | undefined => (
  typeof value === 'string' && DATE_ONLY_RE.test(value.trim()) ? 'UTC' : timeZone
)

type Parts = Partial<Record<Intl.DateTimeFormatPartTypes, string>>

const partsOf = (date: Date, options: Intl.DateTimeFormatOptions, locale: string, timeZone: string | undefined): Parts => {
  const parts: Parts = {}
  new Intl.DateTimeFormat(locale, { ...options, timeZone }).formatToParts(date).forEach(({ type, value }) => {
    if (type !== 'literal') { parts[type] = value }
  })
  return parts
}

const CLOCK: Intl.DateTimeFormatOptions = { hour: '2-digit', hourCycle: 'h23', minute: '2-digit' }

const yearOf = (date: Date, locale: string, timeZone: string | undefined): string | undefined => (
  partsOf(date, { year: 'numeric' }, locale, timeZone).year
)

/** "4 Nov" this year, "10 Sep 2025" another; the year is the viewer's, as is the day. */
const dayLabel = (date: Date, options: TimeFormatOptions, timeZone: string | undefined): string => {
  const locale = options.locale ?? DEFAULT_LOCALE
  const parts = partsOf(date, { day: 'numeric', month: 'short', year: 'numeric' }, locale, timeZone)
  const thisYear = yearOf(new Date(options.now ?? Date.now()), locale, timeZone)
  return `${parts.day} ${parts.month}${parts.year === thisYear ? '' : ` ${parts.year}`}`
}

/** "11:10", 24-hour, in the viewer's zone. */
export const formatClock = (value: unknown, options: TimeFormatOptions = {}): string => {
  const date = toInstant(value)
  if (!date) { return typeof value === 'string' ? value : '' }
  const parts = partsOf(date, CLOCK, options.locale ?? DEFAULT_LOCALE, options.timeZone)
  return `${parts.hour}:${parts.minute}`
}

/** A calendar day: "4 Nov" this year, "10 Sep 2025" another. */
export const formatDate = (value: unknown, options: TimeFormatOptions = {}): string => {
  const date = toInstant(value)
  if (!date) { return typeof value === 'string' ? value : '' }
  return dayLabel(date, options, zoneFor(value, options.timeZone))
}

/** A point in time: "4 Nov, 11:10" this year, "10 Sep 2025, 09:30" another. A date alone stays a day. */
export const formatMoment = (value: unknown, options: TimeFormatOptions = {}): string => {
  const date = toInstant(value)
  if (!date) { return typeof value === 'string' ? value : '' }
  if (typeof value === 'string' && DATE_ONLY_RE.test(value.trim())) { return formatDate(value, options) }
  return `${dayLabel(date, options, options.timeZone)}, ${formatClock(date, options)}`
}

/** The zone's offset from UTC at that instant, in minutes (DST included): Rome in November is +60. */
const offsetMinutes = (date: Date, timeZone: string | undefined): number => {
  const parts = partsOf(date, { day: 'numeric', hour: 'numeric', hourCycle: 'h23', minute: 'numeric', month: 'numeric', second: 'numeric', year: 'numeric' }, 'en-US', timeZone)
  const wall = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute), Number(parts.second))
  return Math.round((wall - Math.floor(date.getTime() / 1000) * 1000) / 60_000)
}

/** "UTC", "UTC+1", "UTC-3", "UTC+5:30". Computed, not Intl's "GMT+1", so it reads the same in any locale. */
const offsetLabel = (minutes: number): string => {
  if (minutes === 0) { return 'UTC' }
  const sign = minutes > 0 ? '+' : '-'
  const hours = Math.floor(Math.abs(minutes) / 60)
  const rest = Math.abs(minutes) % 60
  return `UTC${sign}${hours}${rest ? `:${String(rest).padStart(2, '0')}` : ''}`
}

const fullDay = (date: Date, locale: string, timeZone: string | undefined): string => {
  const parts = partsOf(date, { day: 'numeric', month: 'long', weekday: 'short', year: 'numeric' }, locale, timeZone)
  return `${parts.weekday} ${parts.day} ${parts.month} ${parts.year}`
}

/**
 * The full date, for the hover and focus of every other form: "Wed 4 November 2026, 11:10:27 (UTC+1)".
 * A calendar day is "Fri 18 September 2026". '' when the value names no time.
 */
export const formatFull = (value: unknown, options: TimeFormatOptions = {}): string => {
  const date = toInstant(value)
  if (!date) { return '' }
  const timeZone = zoneFor(value, options.timeZone)
  const day = fullDay(date, options.locale ?? DEFAULT_LOCALE, timeZone)
  if (typeof value === 'string' && DATE_ONLY_RE.test(value.trim())) { return day }
  const clock = partsOf(date, { ...CLOCK, second: '2-digit' }, options.locale ?? DEFAULT_LOCALE, timeZone)
  return `${day}, ${clock.hour}:${clock.minute}:${clock.second} (${offsetLabel(offsetMinutes(date, timeZone))})`
}

/** The full day an instant falls on, in the viewer's zone, without the clock: "Tue 24 November 2026" (a chart's daily bucket). */
export const formatFullDay = (value: unknown, options: TimeFormatOptions = {}): string => {
  const date = toInstant(value)
  return date ? fullDay(date, options.locale ?? DEFAULT_LOCALE, zoneFor(value, options.timeZone)) : ''
}

type Unit = 'day' | 'hour' | 'minute' | 'month' | 'week' | 'year'

/** Whole units in a span of seconds (>= 60), on the thresholds above. */
const magnitude = (seconds: number): [number, Unit] => {
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) { return [minutes, 'minute'] }
  const hours = Math.floor(minutes / 60)
  if (hours < 24) { return [hours, 'hour'] }
  const days = Math.floor(hours / 24)
  if (days < 7) { return [days, 'day'] }
  if (days < 60) { return [Math.floor(days / 7), 'week'] }
  if (days < 365) { return [Math.max(2, Math.floor(days / 30.4375)), 'month'] }
  return [Math.floor(days / 365), 'year']
}

const JUST_NOW = 'just now'

const secondsSince = (date: Date, options: TimeFormatOptions): number => ((options.now ?? Date.now()) - date.getTime()) / 1000

/**
 * How long ago, in a sentence: "52 minutes ago", "1 day ago", "just now". A time still to come is
 * "in 3 hours", never a negative age.
 */
export const formatAgo = (value: unknown, options: TimeFormatOptions = {}): string => {
  const date = toInstant(value)
  if (!date) { return typeof value === 'string' ? value : '' }
  const seconds = secondsSince(date, options)
  if (Math.abs(seconds) < 60) { return JUST_NOW }
  const [count, unit] = magnitude(Math.abs(seconds))
  return new Intl.RelativeTimeFormat(options.locale ?? DEFAULT_LOCALE, { numeric: 'always' }).format(seconds > 0 ? -count : count, unit)
}

/**
 * How old, in a column: "7 weeks", "1 minute", "just now". Words, so a column of ages reads and
 * compares as one ("7w" and "49d ago" did not). A time still to come is said as `formatAgo` says it.
 */
export const formatAge = (value: unknown, options: TimeFormatOptions = {}): string => {
  const date = toInstant(value)
  if (!date) { return typeof value === 'string' ? value : '' }
  const seconds = secondsSince(date, options)
  if (Math.abs(seconds) < 60) { return JUST_NOW }
  if (seconds < 0) { return formatAgo(date, options) }
  const [count, unit] = magnitude(seconds)
  return new Intl.NumberFormat(options.locale ?? DEFAULT_LOCALE, { style: 'unit', unit, unitDisplay: 'long' }).format(count)
}

/**
 * A time in one of the four forms. A value that names no time is returned as it came: a RESTAction's
 * own text is never reparsed.
 */
export const formatTime = (value: unknown, form: TimeForm, options: TimeFormatOptions = {}): string => {
  switch (form) {
    case 'age': return formatAge(value, options)
    case 'ago': return formatAgo(value, options)
    case 'date': return formatDate(value, options)
    default: return formatMoment(value, options)
  }
}

/**
 * The display formats widgets already offered before this module, mapped onto its forms so existing
 * CRs keep working: `relative` was the column age ("3h", no "ago"), `datetime` a moment, `date` a day.
 */
export const LEGACY_TIME_FORMATS: Record<string, TimeForm> = { date: 'date', datetime: 'moment', relative: 'age' }

/** The form a widget's `format` value asks for, or undefined when it asks for no time form (`text`). */
export const timeFormOf = (format: string | undefined): TimeForm | undefined => {
  if (format === 'age' || format === 'ago' || format === 'date' || format === 'moment') { return format }
  return format ? LEGACY_TIME_FORMATS[format] : undefined
}
