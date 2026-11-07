/**
 * Agentiko builder publish DESTINATIONS — resolved from install config, not hardcoded.
 *
 * WHY CONFIG-DRIVEN: each authoring builder (KOG/RestDef, portal page, blueprint) opens its PR
 * against a specific `owner/repo`. Those coordinates are an INSTALL concern, NEVER a code constant:
 * the krateo org migration (`braghettos` → `krateo-platformops`, and the `krateo-oas` → `oas`
 * rename) proved that baking an org name into the image turns a GitHub rename into a required
 * frontend rebuild — and a stale baked-in default silently points a publish at the wrong (or a
 * 404) repo. So the frontend has NO hardcoded fallback repos: the destination comes ONLY from
 * install config (`config.api.AUTOPILOT_*_BUILDER_REPO`, the chart's values.yaml) and the
 * human-confirmed publish form. A config-less install resolves to an EMPTY target — the form
 * prefills nothing and the human supplies the destination (or the publish is denied) — rather than
 * defaulting to a guessed repo.
 */
import { useMemo } from 'react'

import { agentikoConfig, agentikoKeyOf, type AgentikoKey } from '../../context/agentikoConfig'
import type { Config } from '../../context/ConfigContext'

export interface BuilderTarget {
  owner: string
  repo: string
}

/**
 * Parse an `owner/repo` slug (the config value) into a BuilderTarget. Anything malformed — not a
 * string, empty, no slash, an empty owner or repo segment, or extra path segments — resolves to an
 * EMPTY target `{owner:'', repo:''}` (no hardcoded fallback); the human then supplies the missing
 * coordinates at publish. Never throws (config is untrusted).
 */
export const resolveBuilderTarget = (slug: string | undefined): BuilderTarget => {
  const empty = { owner: '', repo: '' }
  if (typeof slug !== 'string') {
    return empty
  }
  const parts = slug.trim().split('/')
  if (parts.length !== 2) {
    return empty
  }
  const owner = parts[0].trim()
  const repo = parts[1].trim()
  return owner && repo ? { owner, repo } : empty
}

export interface BuilderTargets {
  blueprint: BuilderTarget
  /**
   * Template repo a NEW blueprint repository is SEEDED from — see pageTemplate. The same scaffold
   * serves both builders, because what a builder repo needs does not depend on what the chart holds:
   * a release workflow that packages the one chart at the root, a `.helmignore` so the package
   * carries the chart and not the repository, and nothing else.
   */
  blueprintTemplate: BuilderTarget
  kog: BuilderTarget
  /**
   * Template repo a NEW controller repository is SEEDED from (T8, frontend#412) — builder-scaffold, as
   * for the other two: a controller is a chart too, and needs the same release workflow.
   */
  kogTemplate: BuilderTarget
  page: BuilderTarget
  /**
   * Template repo a NEW page-set repository is SEEDED from — a destination's starting content, not
   * a destination. Empty means no seeding: a bare auto-init'd repo holding only the composed chart,
   * with no workflow to release it.
   */
  pageTemplate: BuilderTarget
}

/** The six Agentiko config keys the builder targets are resolved from, by the name after the prefix. */
export type BuilderTargetKey = Extract<AgentikoKey,
  | 'BLUEPRINT_BUILDER_REPO'
  | 'BLUEPRINT_BUILDER_TEMPLATE'
  | 'KOG_BUILDER_REPO'
  | 'KOG_BUILDER_TEMPLATE'
  | 'PAGE_BUILDER_REPO'
  | 'PAGE_BUILDER_TEMPLATE'>

/** The install-config slugs the builder targets are resolved from — `config.api`'s six keys, under either name. */
export type BuilderTargetSlugs = Pick<Config['api'], `AGENTIKO_${BuilderTargetKey}` | `AUTOPILOT_${BuilderTargetKey}`>

/** The six slugs, already resolved from whichever name each was set under. */
type ResolvedSlugs = Record<BuilderTargetKey, string | undefined>

const targetsOf = (slugs: ResolvedSlugs): BuilderTargets => ({
  blueprint: resolveBuilderTarget(slugs.BLUEPRINT_BUILDER_REPO),
  blueprintTemplate: resolveBuilderTarget(slugs.BLUEPRINT_BUILDER_TEMPLATE),
  kog: resolveBuilderTarget(slugs.KOG_BUILDER_REPO),
  kogTemplate: resolveBuilderTarget(slugs.KOG_BUILDER_TEMPLATE),
  page: resolveBuilderTarget(slugs.PAGE_BUILDER_REPO),
  pageTemplate: resolveBuilderTarget(slugs.PAGE_BUILDER_TEMPLATE),
})

const slugsOf = (api: BuilderTargetSlugs | undefined): ResolvedSlugs => ({
  BLUEPRINT_BUILDER_REPO: agentikoConfig(api, 'BLUEPRINT_BUILDER_REPO'),
  BLUEPRINT_BUILDER_TEMPLATE: agentikoConfig(api, 'BLUEPRINT_BUILDER_TEMPLATE'),
  KOG_BUILDER_REPO: agentikoConfig(api, 'KOG_BUILDER_REPO'),
  KOG_BUILDER_TEMPLATE: agentikoConfig(api, 'KOG_BUILDER_TEMPLATE'),
  PAGE_BUILDER_REPO: agentikoConfig(api, 'PAGE_BUILDER_REPO'),
  PAGE_BUILDER_TEMPLATE: agentikoConfig(api, 'PAGE_BUILDER_TEMPLATE'),
})

/**
 * Resolve every builder target from install config. Pure — the hook below only memoizes it — so
 * which key feeds which target is testable without rendering anything, and a key wired to the wrong
 * target is a failed assertion rather than a publish seeded from the other builder's template.
 */
export const resolveBuilderTargets = (api: BuilderTargetSlugs | undefined): BuilderTargets => targetsOf(slugsOf(api))

/**
 * Which resolved target each install-config key fills. A Builder names its destination by config key
 * (`spec.publish.targetKey` / `templateKey`, never an owner/repo — ADR 0001), and this is how the engine
 * reads the target that key resolved to. Keyed by the name after the prefix, so a Builder may spell the
 * key either way: the deployed Builders say `AUTOPILOT_…`.
 */
const TARGET_OF_KEY: Record<BuilderTargetKey, keyof BuilderTargets> = {
  BLUEPRINT_BUILDER_REPO: 'blueprint',
  BLUEPRINT_BUILDER_TEMPLATE: 'blueprintTemplate',
  KOG_BUILDER_REPO: 'kog',
  KOG_BUILDER_TEMPLATE: 'kogTemplate',
  PAGE_BUILDER_REPO: 'page',
  PAGE_BUILDER_TEMPLATE: 'pageTemplate',
}

/** The target a Builder's config key resolved to — empty for a key this frontend does not resolve. */
export const builderTargetFor = (targets: BuilderTargets, key: string): BuilderTarget => {
  const suffix = agentikoKeyOf(key)
  return suffix !== null && Object.prototype.hasOwnProperty.call(TARGET_OF_KEY, suffix)
    ? targets[TARGET_OF_KEY[suffix as BuilderTargetKey]]
    : { owner: '', repo: '' }
}

/** Resolve the builders' publish destinations from install config, memoized on the slugs. */
export const useBuilderTargets = (config: Config | undefined): BuilderTargets => {
  const slugs = slugsOf(config?.api)
  const { BLUEPRINT_BUILDER_REPO, BLUEPRINT_BUILDER_TEMPLATE, KOG_BUILDER_REPO, KOG_BUILDER_TEMPLATE, PAGE_BUILDER_REPO, PAGE_BUILDER_TEMPLATE } = slugs
  return useMemo(() => targetsOf({
    BLUEPRINT_BUILDER_REPO,
    BLUEPRINT_BUILDER_TEMPLATE,
    KOG_BUILDER_REPO,
    KOG_BUILDER_TEMPLATE,
    PAGE_BUILDER_REPO,
    PAGE_BUILDER_TEMPLATE,
  }), [BLUEPRINT_BUILDER_REPO, BLUEPRINT_BUILDER_TEMPLATE, KOG_BUILDER_REPO, KOG_BUILDER_TEMPLATE, PAGE_BUILDER_REPO, PAGE_BUILDER_TEMPLATE])
}

/**
 * The clone URL a `Repo.spec.fromRepo` seeds from, or `null` when no template is configured —
 * for either builder's template.
 *
 * Built from the same `AUTOPILOT_GIT_HOST` the publish deep links use, so a self-hosted SCM seeds
 * from its own server rather than github.com. `null` — not an empty string — because the claim must
 * OMIT `source` entirely when unset: an empty url renders a `Repo` that clones nothing and fails
 * the publish, where omitting it simply skips the seeding step.
 */
export const builderTemplateUrl = (template: BuilderTarget, host: string | undefined): string | null => {
  if (!template.owner || !template.repo) {
    return null
  }
  const gitHost = (typeof host === 'string' && host.trim()) || 'github.com'
  return `https://${gitHost}/${template.owner}/${template.repo}.git`
}
