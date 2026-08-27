/**
 * Autopilot builder publish DESTINATIONS — resolved from install config, not hardcoded.
 *
 * WHY CONFIG-DRIVEN: each authoring builder (KOG/RestDef, portal page, blueprint) opens its PR
 * against a specific `owner/repo`. Those coordinates are an INSTALL concern, not a code constant:
 * the krateo org migration (`braghettos` → `krateo-platformops`, and the `krateo-oas` → `oas`
 * rename) proved that baking an org name into the image turns a GitHub rename into a required
 * frontend rebuild. So the frontend chart passes each builder's destination as an `owner/repo`
 * slug env (`config.api.AUTOPILOT_*_BUILDER_REPO`); this module resolves that config — or the
 * built-in canonical fallback — into `{ owner, repo }` for the publish-destination form prefill.
 *
 * The FALLBACKS are derived from the per-builder `*_REPO_DEFAULTS` consts (single source of truth,
 * no duplicated literals) and exist only so a config-less install still works; the chart's
 * values.yaml ships the same coordinates as its shipped default.
 */
import { useMemo } from 'react'

import type { Config } from '../../context/ConfigContext'

import { BLUEPRINTS_REPO_DEFAULTS } from './blueprintPublish'
import { KOG_REPO_DEFAULTS } from './kogPublish'
import { PORTAL_CHART_REPO_DEFAULTS } from './pagePublish'

export interface BuilderTarget {
  owner: string
  repo: string
}

/** The built-in per-builder fallback coordinates (used when the install ships no config value). */
export const BUILDER_TARGET_FALLBACKS = {
  blueprint: { owner: BLUEPRINTS_REPO_DEFAULTS.owner, repo: BLUEPRINTS_REPO_DEFAULTS.repo },
  kog: { owner: KOG_REPO_DEFAULTS.owner, repo: KOG_REPO_DEFAULTS.repo },
  page: { owner: PORTAL_CHART_REPO_DEFAULTS.owner, repo: PORTAL_CHART_REPO_DEFAULTS.repo },
} as const satisfies Record<'blueprint' | 'kog' | 'page', BuilderTarget>

/**
 * Parse an `owner/repo` slug (the config value) into a BuilderTarget. Anything malformed — not a
 * string, empty, no slash, an empty owner or repo segment, or extra path segments — falls back to
 * the built-in target rather than shipping half a destination. Never throws (config is untrusted).
 */
export const resolveBuilderTarget = (slug: string | undefined, fallback: BuilderTarget): BuilderTarget => {
  if (typeof slug !== 'string') {
    return fallback
  }
  const parts = slug.trim().split('/')
  if (parts.length !== 2) {
    return fallback
  }
  const owner = parts[0].trim()
  const repo = parts[1].trim()
  return owner && repo ? { owner, repo } : fallback
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
    blueprint: resolveBuilderTarget(blueprintSlug, BUILDER_TARGET_FALLBACKS.blueprint),
    kog: resolveBuilderTarget(kogSlug, BUILDER_TARGET_FALLBACKS.kog),
    page: resolveBuilderTarget(pageSlug, BUILDER_TARGET_FALLBACKS.page),
  }), [blueprintSlug, kogSlug, pageSlug])
}
