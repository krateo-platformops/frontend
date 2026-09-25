/**
 * THE BUILDER DEFAULTS AN INSTALL ACTUALLY GETS — the chart's values.schema.json, not values.yaml.
 *
 * The installer builds a component's values from its schema's DEFAULTS, so a key that is only in
 * values.yaml never reaches the cluster, and a default fixed only there is silently overridden by
 * the schema's old one. That is the drift `values-schema-drift.yaml` gates in CI for the whole
 * `config` block; this pins the builder keys the frontend reads, from the same files, so a key added
 * to ConfigContext and builderTargets but never regenerated into the schema fails here, next to the
 * code that reads it, rather than as an install whose publishes are never seeded.
 *
 * On krateo-057 the installer overrides none of these but AUTOPILOT_PAGE_BUILDER_REPO, so these
 * defaults are what the next frontend pin bump deploys.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { load } from 'js-yaml'
import { describe, expect, it } from 'vitest'

import { resolveBuilderTarget, type BuilderTargetSlugs } from './builderTargets'

const CHART = join(__dirname, '..', '..', '..', '..', 'helm', 'frontend')

interface ConfigSchema { properties: { config: { default: Record<string, unknown>; properties: Record<string, { default?: unknown }> } } }

const schema = JSON.parse(readFileSync(join(CHART, 'values.schema.json'), 'utf8')) as ConfigSchema
const values = load(readFileSync(join(CHART, 'values.yaml'), 'utf8')) as { config: Record<string, unknown> }

/** Every key builderTargets reads. Typed against BuilderTargetSlugs, so a key added there and not here fails to compile. */
const BUILDER_KEYS: Record<keyof BuilderTargetSlugs, true> = {
  AUTOPILOT_BLUEPRINT_BUILDER_REPO: true,
  AUTOPILOT_BLUEPRINT_BUILDER_TEMPLATE: true,
  AUTOPILOT_KOG_BUILDER_REPO: true,
  AUTOPILOT_PAGE_BUILDER_REPO: true,
  AUTOPILOT_PAGE_BUILDER_TEMPLATE: true,
}

/** What the installer deploys for a key: the config block's default map, which the per-key default must agree with. */
const deployed = (key: string): unknown => schema.properties.config.default[key]

describe('the builder keys the frontend reads have schema defaults, in step with values.yaml', () => {
  it.each(Object.keys(BUILDER_KEYS))('%s is declared, defaulted and agrees with values.yaml', (key) => {
    const property = schema.properties.config.properties[key]
    expect(property, `${key} is not in values.schema.json — run python3 scripts/gen-config-schema.py`).toBeDefined()
    expect(property.default).toBe(values.config[key])
    expect(deployed(key)).toBe(values.config[key])
  })
})

describe('the defaults themselves (D1, D8)', () => {
  it('seeds BOTH builders from the one chart-free scaffold', () => {
    // The old page template carried an example chart and its own CompositionDefinition, and the
    // copy took both: git-provider's .krateoignore stops rendering, not copying.
    expect(deployed('AUTOPILOT_PAGE_BUILDER_TEMPLATE')).toBe('krateo-blueprints/builder-scaffold')
    expect(deployed('AUTOPILOT_BLUEPRINT_BUILDER_TEMPLATE')).toBe('krateo-blueprints/builder-scaffold')
  })

  it('gives the blueprint builder an OWNER, and a repo segment that names no repository', () => {
    // Empty, it left the composer's "Registered as" row blank and every publish asking for an org.
    // The repo segment is a fallback nothing publishes to — the chart's own name is always the
    // repository — so it must not be a name GitHub would accept: the publish CREATES a missing repo.
    const target = resolveBuilderTarget(deployed('AUTOPILOT_BLUEPRINT_BUILDER_REPO') as string)
    expect(target.owner).toBe('krateo-blueprints')
    expect(target.repo).not.toMatch(/^[A-Za-z0-9._-]+$/)
  })
})
