/**
 * THE ONE PLACE an Agentiko runtime config key is read.
 *
 * The product was renamed from Autopilot to Agentiko, and its config keys with it: every
 * `AUTOPILOT_<KEY>` in config.json now has an `AGENTIKO_<KEY>` name. The installer writes these keys
 * and the frontend reads them, so the rename is ordered:
 *   1. the frontend reads `AGENTIKO_<KEY>` first and falls back to `AUTOPILOT_<KEY>` (this file), and
 *      the chart accepts and emits both;
 *   2. the installer switches its values to the `AGENTIKO_` names;
 *   3. once every cluster (057, demo, alpitour) runs past step 2, the fallback goes: delete the
 *      `AUTOPILOT_` read below and `AutopilotApiConfig` in ConfigContext.tsx.
 *
 * PRECEDENCE: the `AGENTIKO_` value wins whenever it is PRESENT, meaning anything but `undefined` or
 * `null`. An empty string is present, so `AGENTIKO_X: ""` beside `AUTOPILOT_X: "something"` yields
 * `""`, and the reader then treats that `""` exactly as it treated an `AUTOPILOT_X: ""` before the
 * rename (for one key that means "off", for another "use the default"). The resolver never decides
 * what `""` means; it only decides which name it came from.
 *
 * agentikoConfig.reads.test.ts fails on a read of either name anywhere else in ui/src.
 */
import type { AgentikoConfigValues, Config } from './ConfigContext'

/** An Agentiko config key, by the name after its prefix: `'API_BASE_URL'`, `'VOICE_TTS_URL'`, … */
export type AgentikoKey = keyof AgentikoConfigValues

/** Anything shaped like (part of) `config.api`. */
type ApiLike = Partial<Config['api']>

const CURRENT_PREFIX = 'AGENTIKO_'
/** @deprecated Read only as the fallback; see the header. */
const DEPRECATED_PREFIX = 'AUTOPILOT_'

/** `config.api` as what it is at runtime: parsed JSON, any key, any value. */
type RawApi = Readonly<Record<string, unknown>> | null | undefined

/** The fallback itself, for a key given by the name after its prefix. */
const readEither = (api: RawApi, key: string): unknown =>
  api?.[`${CURRENT_PREFIX}${key}`] ?? api?.[`${DEPRECATED_PREFIX}${key}`] ?? undefined

/** The value of an Agentiko config key: `AGENTIKO_<key>` when present, else the deprecated `AUTOPILOT_<key>`. */
export const agentikoConfig = <K extends AgentikoKey>(api: ApiLike | null | undefined, key: K): AgentikoConfigValues[K] | undefined =>
  readEither(api, key) as AgentikoConfigValues[K] | undefined

/**
 * The Agentiko key a config-key NAME refers to, under either spelling — `'AGENTIKO_GIT_HOST'` and
 * `'AUTOPILOT_GIT_HOST'` are both `'GIT_HOST'` — or `null` for a name with neither prefix.
 *
 * For a key named by data rather than code: a Builder CR's `spec.publish.targetKey`/`templateKey`
 * names the config key its destination comes from, and the Builders deployed today spell it
 * `AUTOPILOT_…`.
 */
export const agentikoKeyOf = (name: string): string | null => {
  if (name.startsWith(CURRENT_PREFIX)) { return name.slice(CURRENT_PREFIX.length) }
  if (name.startsWith(DEPRECATED_PREFIX)) { return name.slice(DEPRECATED_PREFIX.length) }
  return null
}

/**
 * Read a config key named at runtime. An Agentiko name, under either spelling, goes through the
 * same fallback as `agentikoConfig` (so `'AUTOPILOT_X'` still finds a value set only as `AGENTIKO_X`); any other name
 * is read as it is.
 */
export const configValueByName = (api: ApiLike | null | undefined, name: string): string | undefined => {
  const key = agentikoKeyOf(name)
  const raw: RawApi = api
  const value = key === null ? raw?.[name] : readEither(raw, key)
  return typeof value === 'string' ? value : undefined
}
