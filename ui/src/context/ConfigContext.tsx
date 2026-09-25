import type { UseQueryResult } from '@tanstack/react-query'
import { useQuery } from '@tanstack/react-query'
import React, { createContext, useContext } from 'react'
export interface Config {
  api: {
    AUTHN_API_BASE_URL: string
    SNOWPLOW_API_BASE_URL: string
    EVENTS_API_BASE_URL: string
    EVENTS_PUSH_API_BASE_URL: string
    INIT: string
    TERMINAL_SOCKET_URL: string
    /** Base URL of the Krateo Autopilot (kagent) A2A endpoint. Optional: when
     * absent the Autopilot rail + header toggle do not render (graceful absence
     * for installs without autopilot deployed). */
    AUTOPILOT_API_BASE_URL?: string
    /** Installer availability flag for Autopilot. When set to the string "false" (the installer
     * sets it when agents are not deployed/licensed, features.coreAgents=false) the header toggle
     * still RENDERS — so the capability is discoverable — but is grayed-out and non-clickable.
     * Any other value (absent/"true") leaves clickability to the runtime reachability probe. */
    AUTOPILOT_AVAILABLE?: string
    /** Kill-switch for snowplow's per-widget live-refresh SSE (`/refreshes`), which makes
     * widgets push-update when their backing cluster object changes (see hooks/refreshSse.ts).
     * **ON by default** (verified delivering on snowplow ≥1.5.13; older snowplow degrades to a
     * harmless idle stream). Set to `false` to opt an install OUT (widgets refetch as before). */
    WIDGET_LIVE_REFRESH_ENABLED?: boolean
    /** Capability flag — authored by the frontend chart from the bundled snowplow version, NOT an
     * operator knob. Typed `string | boolean` (#28): the installer/chart plumbing (chart-inspector)
     * can only emit STRINGS, so config.json carries `""` (hold-off) or `"true"` (flip); `boolean` is
     * kept for forward-compat. Consumed purely by JS truthiness in buildExtrasParam
     * (`!config.api.SNOWPLOW_IDENTITY_INJECTION`): when TRUTHY (`"true"`/`true`) snowplow injects the
     * authenticated identity (`displayName`/`username`) into the resolve input server-side, so the
     * browser STOPS volunteering them in `?extras=` — restoring per-widget L1 cache sharing for
     * identity-independent widgets. When falsy (`""`/absent/`false`) the frontend keeps the LEGACY
     * behavior (sends identity extras), byte-identical to before the flag existed, so a new frontend
     * against an old snowplow is safe. NB `"false"` is a non-empty string and thus TRUTHY (⇒ inject-OFF,
     * NOT legacy) — the rollout only ever uses `""` and `"true"`. The flag + its legacy branch are
     * removed once the fleet converges. See snowplow docs/definitive-cache-identity-architecture-2026-07-07.md §4.1. */
    SNOWPLOW_IDENTITY_INJECTION?: string | boolean
    /** W0-3 provenance flag. When `true`, every gated portal write (human OR agent origin)
     * fire-and-forgets ONE immutable AuditRecord CR (audit.krateo.io/v1alpha1, namespaced —
     * the CRD ships separately in the portal chart) after the write resolves. STRICTLY
     * best-effort: a missing CRD (404), RBAC (403), or network failure is swallowed and
     * never blocks/fails the primary write (see hooks/provenance.ts). **ON by default** (the
     * audit + remediation-outcome loop depends on it); set explicit `false`/`"false"` to opt out
     * — absent/empty resolves ON. Safe on a CRD-less cluster because emission is best-effort. */
    PROVENANCE_ENABLED?: boolean | string
    /** Base URL of the Wave-4 helm-render dry-run service (`POST {chart, values}` to
     * `${RENDER_API_BASE_URL}/render` → rendered manifests, NO cluster write). Optional
     * — the service is not deployed everywhere yet: when absent/empty the Autopilot
     * `previewBlueprint` verb degrades to a graceful "preview unavailable" chip and
     * issues ZERO network calls (see components/Autopilot/previewHandlers.ts). */
    RENDER_API_BASE_URL?: string
    /** Namespace of the QUARANTINED preview sandbox (portal-builder Addendum A.2 —
     * previewPage v2). When set, the Autopilot `previewPage` verb APPLIES the draft
     * widget CRs into EXACTLY this namespace (through the gated set fabric, under the
     * user's identity, agent-audited) and the preview drawer renders the ROOT draft's
     * REAL served `widgetEndpoint` — the deployed snowplow compiles the drafts like any
     * production page (zero snowplow changes). When absent the verb keeps its v1
     * ZERO-NETWORK source-preview behavior EXACTLY, and the applyResourceSet guard's
     * widgets/restactions sandbox carve-out stays fully closed (total deny). The
     * namespace itself (quota + author RBAC + TTL janitor) is chart-provisioned
     * infrastructure (CHART-SBX) — the frontend never creates it. */
    PREVIEW_SANDBOX_NAMESPACE?: string
    /** OTLP/HTTP traces endpoint of the OpenTelemetry collector. Optional and
     * default-OFF: when absent the browser starts NO trace provider and injects
     * no W3C `traceparent` header (byte-identical default runtime path). When
     * set, the browser starts spans and propagates traceparent on the configured
     * authn/snowplow/events backend origins so browser→backend spans link
     * end-to-end. The collector's OTLP/HTTP receiver must CORS-allow the portal
     * origin, and authn/snowplow must allow the `traceparent` request header. */
    OTEL_COLLECTOR_URL?: string
    /** Autopilot builder publish DESTINATIONS — the `owner/repo` slug each authoring builder
     * publishes against. Config-driven so an org/repo rename is an install-values change, never a
     * frontend rebuild — the `braghettos`→`krateo-platformops` (+ `krateo-oas`→`oas`) migration is
     * exactly why these exist. There is NO hardcoded fallback repo (#163): absent/empty/malformed →
     * an EMPTY prefill and the human supplies the destination (or the publish is denied). All three
     * supply the OWNER while the repo is per-artifact — each blueprint, RestDefinition and page set
     * gets its own repo, since a page set became its own chart (#277). Consumed as the publish-form
     * prefill — the human confirms every destination. For a page or a blueprint the repository
     * prefill is always the artifact's own name, so only the OWNER of a model-emitted destination
     * still wins; the repo segment here is a fallback nothing reaches while a draft is held. */
    AUTOPILOT_KOG_BUILDER_REPO?: string
    AUTOPILOT_PAGE_BUILDER_REPO?: string
    AUTOPILOT_BLUEPRINT_BUILDER_REPO?: string
    /** Template repos a NEW page-set / blueprint repository is seeded from, as `owner/repo` slugs.
     *
     * `builder-publish` creates the destination repo and auto-inits it, so without one a composed
     * chart lands in a bare repo: a valid chart with no release workflow, and therefore no way to
     * release itself. Setting one makes the claim render a git-provider `Repo` (`fromRepo` →
     * `toRepo`) that copies the template in first. The template must be chart-free — git-provider
     * copies every file, and `.krateoignore` only stops rendering — which is why both default to
     * `krateo-blueprints/builder-scaffold`: a release workflow, `.helmignore`, `.gitignore`, a
     * README, and nothing a composed chart could collide with. The CompositionDefinition is NOT
     * the template's: the publish writes one for the chart it commits.
     *
     * A seeded repository is one chart's, so with a template configured the publish refuses a
     * repository named anything but the chart (seededRepoProblem).
     *
     * Config-driven and with NO hardcoded fallback, for the same reason as the destinations above.
     * Absent/empty/malformed → no seeding. */
    AUTOPILOT_PAGE_BUILDER_TEMPLATE?: string
    AUTOPILOT_BLUEPRINT_BUILDER_TEMPLATE?: string
    /* SCM-agnostic publishing (git-provider LocalResource path). The builder publish targets are
     * install config; these two say WHICH SCM flavour + host so the frontend builds the right
     * change-request deep link + citation URLs (the write itself is scm-blind, done by git-provider).
     * Absent → github / github.com, so existing installs are unchanged. */
    AUTOPILOT_GIT_SCM?: string
    AUTOPILOT_GIT_HOST?: string
    /** Operator kill-switch for Autopilot SPEAK-BACK — reading an answer aloud when the
     * question was asked by voice (voice spec FR 46/76). `"off"` removes the feature and its
     * rail-header control entirely; any other value (absent/`"on"`) leaves it to the per-user
     * preference, which defaults on. Independent of the capture half: speak-back needs no
     * microphone, no HTTPS and no transcription URL — only a local (on-device) voice. */
    AUTOPILOT_VOICE_SPEAK_BACK?: string
    /** Where dictated audio is POSTed — a full absolute URL to an OpenAI-shaped
     * `/chat/completions` on the agent gateway (the dedicated `/stt/v1` route when the
     * platform ships it, `<gateway>/llm/v1/chat/completions` otherwise). ITS PRESENCE IS
     * THE ON/OFF SWITCH (voice spec FR 4): absent or empty, the microphone control does
     * not render and the composer's DOM is unchanged. Nothing is hard-coded — no default
     * path, no derived origin — because the route is still with the platform team.
     * Dictation ALSO requires `isSecureContext`, so this key alone does not enable it. */
    AUTOPILOT_VOICE_TRANSCRIBE_URL?: string
    /** The model that transcribes. Must be one the gateway routes to a backend that
     * accepts an inline audio `file` part; defaults to `gemini-3.8-flash`. */
    AUTOPILOT_VOICE_MODEL?: string
    /** Where an answer is sent to be SPOKEN — a full absolute URL to a Google Cloud
     * Text-to-Speech `text:synthesize` on the agent gateway (`<portal-origin>/tts/v1/text:synthesize`
     * on the platform TLS listener). ITS PRESENCE IS THE ON/OFF SWITCH, the same way
     * `AUTOPILOT_VOICE_TRANSCRIBE_URL` gates dictation: absent or empty, speak-back keeps
     * using the browser's `speechSynthesis` pinned to on-device voices, byte for byte as
     * before this key existed. The browser carries only ITS OWN portal bearer — the gateway
     * route is Strict-JWT gated and holds the GCP credential, so no Google credential ever
     * reaches the page. Independent of `AUTOPILOT_VOICE_SPEAK_BACK`, which stays the
     * operator kill-switch and still wins over this. */
    AUTOPILOT_VOICE_TTS_URL?: string
    /** Gemini-TTS model. Absent = the Chirp/standard request shape, unchanged. Naming one
     *  switches to the generative tier and enables `AUTOPILOT_VOICE_STYLE_PROMPT`.
     *
     *  CLOUD TTS NAMES ARE NOT GEMINI API NAMES — this is a trap worth stating, because the
     *  obvious cross-check gives the wrong answer. This value goes to Cloud TTS
     *  `text:synthesize`, whose Gemini models are `gemini-3.1-flash-tts-preview` (newest),
     *  `gemini-2.5-flash-tts`, `gemini-2.5-flash-lite-preview-tts`, `gemini-2.5-pro-tts`. The
     *  Gemini API's own list spells the 2.5 one `gemini-2.5-flash-preview-tts`, so reading THAT
     *  list makes the value here look like a typo and invites a "fix" that would break a working
     *  install. Check the Cloud TTS docs, not the Gemini API docs.
     *
     *  `gemini-3.1-flash-tts-preview` is the current choice for a new install. */
    AUTOPILOT_VOICE_TTS_MODEL?: string
    /** Gemini-TTS styling instruction, sent as `input.prompt`. This is the field that can ask
     *  for one language's prose with another language's pronunciation for the jargon inside
     *  it — which no single locale-pinned voice can do. Read only when a model is named. */
    AUTOPILOT_VOICE_STYLE_PROMPT?: string
    /** The Cloud TTS voice that reads answers, e.g. `en-US-Chirp3-HD-Achernar` (the
     * in-code default). Only consulted when `AUTOPILOT_VOICE_TTS_URL` is set. The NAME
     * carries the language — a voice serves one — so an install that wants answers read in
     * another language names a voice for it here rather than relying on the browser's
     * `navigator.language`. */
    AUTOPILOT_VOICE_NAME?: string
  }
  params: {
    FRONTEND_NAMESPACE: string
    DELAY_SAVE_NOTIFICATION: string
  }
  /** Optional login-screen branding. Fetched pre-auth (before any backend
   * identity), so it lives in the static config (ConfigMap-mountable per install)
   * rather than a snowplow widget. Absent keys fall back to built-in defaults. */
  login?: {
    /** Branding logo for the login panel. A URL (absolute, or a path the
     * frontend serves). Should be a light/white mark — it sits on the brand
     * gradient. Falls back to the bundled Krateo logo when absent. */
    logoUrl?: string
    /** Accessible alt text for the logo. Falls back to 'Krateo | PlatformOps'. */
    logoAlt?: string
    headline?: string
    subtitle?: string
    highlights?: string[]
    /** Optional "Request an account" link target (e.g. an internal access-request
     * form or mailto). Krateo has no self-signup, so the link only renders when an
     * install sets this — no dead link by default. */
    requestAccountUrl?: string
  }
}

interface ConfigContextType {
  config: Config | undefined
  isLoading: boolean
  refetch: UseQueryResult<Config, Error>['refetch']
}

/**
 * Exported so a surface can read the config WITHOUT the throwing hook.
 *
 * `useConfigContext` throws when no provider is above it, which is right for a component that
 * cannot work without config. A route that merely degrades — the page composer loses its
 * widget-picker list and says so — must not take the whole page down instead, and must stay
 * mountable bare in tests, which is a property those tests deliberately assert.
 */
export const ConfigContext = createContext<ConfigContextType | null>(null)

async function fetchConfig(): Promise<Config> {
  let configPath = '/config/config.json'

  const configName = import.meta.env.VITE_CONFIG_NAME
  if (import.meta.env.DEV && configName) {
    configPath = `/config/config.${configName}.json`
  }

  const configFile = await fetch(configPath, { cache: 'no-store' })

  if (!configFile.ok) {
    throw new Error(`Failed to fetch config: ${configFile.statusText}`)
  }

  const configJson = (await configFile.json()) as Config

  return configJson
}

export const ConfigProvider = ({ children }: { children: React.ReactNode }) => {
  const { data: config, isLoading, refetch } = useQuery({
    queryFn: fetchConfig,
    queryKey: ['config', import.meta.env.VITE_CONFIG_NAME || 'default'] as const,
    refetchOnMount: true,
    refetchOnReconnect: true,
    staleTime: 0,
  })

  return (
    <ConfigContext.Provider value={{ config, isLoading, refetch }}>
      {children}
    </ConfigContext.Provider>
  )
}

export const useConfigContext = () => {
  const context = useContext(ConfigContext)

  if (!context) {
    throw new Error('useConfigContext must be used within ConfigProvider')
  }

  return context
}
