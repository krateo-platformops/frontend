/**
 * THE ACCESSIBILITY GATE (design/02-components.md C8–C10): the jsx-a11y rules from eslint.config.js,
 * and nothing else, so CI can enforce them on their own.
 *
 * WHY A SEPARATE CONFIG. No CI job runs ESLint: `lint.yaml` is the chart repo's `helm lint`, and
 * `npx eslint src` reports ~60 pre-existing problems that nothing has ever gated on. Rules that only
 * an editor shows are the failure this design system documents — written down, not load-bearing.
 * Turning on the whole config in CI would fail on that unrelated debt; this gates the one family
 * that is clean today, and keeps it clean.
 *
 * NOT A COPY. It reads eslint.config.js and keeps every config object (plugins, parser, settings,
 * the per-file overrides) while dropping every rule that is not `jsx-a11y/*`. A rule added to, or
 * switched off in, the main config is added to or switched off here too, with no second list to
 * drift.
 *
 *   npx eslint -c eslint.a11y.config.js src
 */
import base from './eslint.config.js'

const onlyA11y = (rules) =>
  rules && Object.fromEntries(Object.entries(rules).filter(([name]) => name.startsWith('jsx-a11y/')))

export default [
  ...base.map((config) => (config.rules ? { ...config, rules: onlyA11y(config.rules) } : config)),
  // `eslint-disable` comments for the rules dropped above would otherwise read as unused.
  { linterOptions: { reportUnusedDisableDirectives: 'off' } },
]
