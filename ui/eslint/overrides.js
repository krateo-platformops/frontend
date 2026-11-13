// @ts-check

/**
 * Narrow, per-path exemptions and fences. Each one names the issue or spec clause it enforces;
 * they live together so a reader can see every carve-out in the project at once.
 */
export const overrides = [
  // Tests render fixtures, not product UI: a clickable <div> in a test exercises a handler, it is not
  // a control anyone has to reach. The C8/C9 rules stay on everything that ships.
  {
    files: ['**/*.test.tsx'],
    name: 'C8/C9 a11y rules do not apply to test fixtures',
    rules: {
      'jsx-a11y/click-events-have-key-events': 'off',
      'jsx-a11y/control-has-associated-label': 'off',
      'jsx-a11y/interactive-supports-focus': 'off',
      'jsx-a11y/no-noninteractive-element-interactions': 'off',
      'jsx-a11y/no-static-element-interactions': 'off',
    },
  },

  // Public routes: the widget tree and the public page take their credential from the widget
  // transport in context (src/transport/widgetTransport.ts) and never read the stored token
  // themselves. Outside the signed-in shell that transport is anonymous, so a direct import here
  // would put a stored token on a public page's requests — and snowplow answers a stale or invalid
  // token with 401, never falling back to the public identity. The SSE client and the signed-in
  // transport are fenced for the same reason: both carry the token. src/transport/tokenReach.test.ts
  // checks the same property across all of src/, including files this glob does not cover.
  // Placed BEFORE the drawer allow-list below, which switches the whole rule off for its files.
  {
    files: ['src/widgets/**/*.{ts,tsx}', 'src/public/**/*.{ts,tsx}'],
    ignores: ['**/*.test.{ts,tsx}'],
    name: 'Widgets and public pages read through the transport (public routes)',
    rules: {
      'no-restricted-imports': ['error', {
        paths: [{
          importNames: ['Drawer'],
          message: 'Use components/DrawerHeader + drawerCloseProps with an existing drawer surface; do not hand-roll a new antd Drawer (issue #86 §0.10).',
          name: 'antd',
        }],
        patterns: [{
          group: ['**/getAccessToken*', '**/sessionResume*', '**/hooks/sseClient*', '**/signedInTransport*'],
          message: 'Widgets and public pages never touch the stored session: read through useWidgetTransport() (src/transport/widgetTransport.ts), and reach a signed-in-only capability through its `session`, which the anonymous transport of a public page does not have.',
        }],
      }],
    },
  },

  // #86 §0.10: the shared drawer surfaces legitimately import antd `Drawer`; allow-list them so the
  // ban above applies everywhere else (a 5th hand-rolled drawer can't bypass components/DrawerHeader).
  //
  // widgets/Layout/Layout.tsx is the fourth surface: the app shell's navigation drawer on phones
  // (X4 audit item R1, WCAG 1.4.10 Reflow — below `md` the Sider opens over the page from a header
  // button). It is HEADERLESS on purpose, so it takes no DrawerHeader: the sidebar's own logo heads
  // it, as in the mockup Diego approved on 2026-11-10 (design/audits/x4-remediation-backlog-2026-11.md
  // item 1). Its accessible name is an aria-label.
  {
    files: ['src/widgets/Drawer/Drawer.tsx', 'src/components/Notifications/Notifications.tsx', 'src/components/Agentiko/previewSurface.tsx', 'src/widgets/Layout/Layout.tsx'],
    name: 'Allow raw antd Drawer in the shared drawer surfaces (#86 §0.10)',
    rules: { 'no-restricted-imports': 'off' },
  },

  // Voice spec FR 65/68 — the STRUCTURAL form of two invariants, so neither can be broken by
  // a later edit that merely looks reasonable:
  //   · voice code can never reach the transport ITSELF. Conversation mode does send a
  //     spoken turn, but the send lives outside this fence: the store reports a completed
  //     purely-dictated draft through the sink `voiceWiring` injects, and the RAIL submits.
  //     Voice states that a turn is finished; it never holds the means to send one, and
  //   · SPEAK-BACK can never make a model call — the spoken words are a pure local transform
  //     of the text already written in the chat, never a separately generated summary.
  // A user hearing one account of what the agent found while the transcript records another
  // has no way to know which one the agent will act on, and the transcript is what an incident
  // review reads afterwards. Making the import fail turns that from a promise into a fact.
  {
    files: ['src/components/Agentiko/voice/**/*.{ts,tsx}'],
    name: 'Voice cannot send a turn (voice spec FR 65)',
    rules: {
      'no-restricted-imports': ['error', {
        paths: [{
          importNames: ['Drawer'],
          message: 'Use components/DrawerHeader + drawerCloseProps with an existing drawer surface (issue #86 §0.10).',
          name: 'antd',
        }],
        patterns: [{
          group: ['**/transport*', '**/AgentikoProvider*'],
          message: 'Nothing under Agentiko/voice/ may import the A2A transport or the provider\'s send(): a spoken turn is submitted by the RAIL, outside this fence, via the sink injected through voiceStore.installConversationSink() — the voice modules report that a draft is complete and never hold the means to send one (voice spec FR 11/65). What the transcription call needs from outside this fence — the portal bearer, the rate-limit detector, the session resume — is INJECTED the same way, through voiceStore.installTranscribeDeps().',
        }],
      }],
    },
  },

  // The second half of FR 65, and it is STRICTLY NARROWER by one directory: speak-back may
  // not import the transcription client either. Its spoken words must be a pure local
  // transform of the text already written in the chat (FR 68) — never a separately
  // generated summary — so a model call on that path must not compile. The dictation half
  // one level up DOES import `transcribe.ts`; that is its whole job, and fencing it there
  // would ban the feature rather than the failure mode.
  //
  // Every pattern ends in `*` deliberately: tsconfig sets `allowImportingTsExtensions`, so
  // `'../speakTts.ts'` compiles and Vite resolves it, and an extensionless-only group would
  // let that spelling walk straight through the fence. A fence with one accepted spelling is
  // not a fence.
  //
  // `speakTts` — the Cloud TTS client — is banned here for the same reason and is WHY it
  // lives one level up, in `voice/speakTts.ts`, rather than beside the store it serves. It
  // is a network call, and this directory makes NO network calls of any kind: that is what
  // reduces FR 68 from a promise to a fact a reader can check by grep. The TTS speaker
  // reaches the store the only way anything crosses this fence — INJECTED, as a `Speaker`,
  // by voiceWiring.ts through speakBackStore.installSpeaker(). Moving the file in here to
  // save an import would quietly re-open the path this rule exists to close.
  {
    files: ['src/components/Agentiko/voice/speak/**/*.{ts,tsx}'],
    name: 'Speak-back cannot call a model (voice spec FR 68)',
    rules: {
      'no-restricted-imports': ['error', {
        paths: [{
          importNames: ['Drawer'],
          message: 'Use components/DrawerHeader + drawerCloseProps with an existing drawer surface (issue #86 §0.10).',
          name: 'antd',
        }],
        patterns: [{
          group: ['**/transport*', '**/AgentikoProvider*', '**/transcribe*', '**/speakTts*'],
          message: 'Nothing under Agentiko/voice/speak/ may import the A2A transport, the provider\'s send(), the transcription client, or the Cloud TTS client: the spoken answer is a pure local transform of the exact words already written in the chat, never a second model call, and this directory makes no network calls at all (voice spec FR 65/68). The TTS speaker is INJECTED from voiceWiring.ts via speakBackStore.installSpeaker().',
        }],
      }],
    },
  },
]
