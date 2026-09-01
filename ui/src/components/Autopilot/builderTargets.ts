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
}

/** Resolve all three builders' publish destinations from install config, memoized on the slugs. */
export const useBuilderTargets = (config: Config | undefined): BuilderTargets => {
  const kogSlug = config?.api.AUTOPILOT_KOG_BUILDER_REPO
  const pageSlug = config?.api.AUTOPILOT_PAGE_BUILDER_REPO
  const blueprintSlug = config?.api.AUTOPILOT_BLUEPRINT_BUILDER_REPO
  return useMemo(() => ({
    blueprint: resolveBuilderTarget(blueprintSlug),
    kog: resolveBuilderTarget(kogSlug),
    page: resolveBuilderTarget(pageSlug),
  }), [blueprintSlug, kogSlug, pageSlug])
}
