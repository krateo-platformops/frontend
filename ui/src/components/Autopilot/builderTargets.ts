/**
 * Autopilot builder publish DESTINATIONS — resolved from install config, not hardcoded.
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
  kog: BuilderTarget
  page: BuilderTarget
  /**
   * Template repo a NEW page-set repository is SEEDED from — a destination's starting content, not
   * a destination. Empty (the default) means no seeding: the previous behaviour, a bare auto-init'd
   * repo holding only the composed chart.
   */
  pageTemplate: BuilderTarget
}

/** Resolve the builders' publish destinations from install config, memoized on the slugs. */
export const useBuilderTargets = (config: Config | undefined): BuilderTargets => {
  const kogSlug = config?.api.AUTOPILOT_KOG_BUILDER_REPO
  const pageSlug = config?.api.AUTOPILOT_PAGE_BUILDER_REPO
  const blueprintSlug = config?.api.AUTOPILOT_BLUEPRINT_BUILDER_REPO
  const pageTemplateSlug = config?.api.AUTOPILOT_PAGE_BUILDER_TEMPLATE
  return useMemo(() => ({
    blueprint: resolveBuilderTarget(blueprintSlug),
    kog: resolveBuilderTarget(kogSlug),
    page: resolveBuilderTarget(pageSlug),
    pageTemplate: resolveBuilderTarget(pageTemplateSlug),
  }), [blueprintSlug, kogSlug, pageSlug, pageTemplateSlug])
}

/**
 * The clone URL a `Repo.spec.fromRepo` seeds from, or `null` when no template is configured.
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
