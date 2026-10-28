/**
 * S4a's fixtures, in one place: CRDs sliced from krateo-057 (spec and status property names and
 * types only; descriptions dropped), the blueprint-palette RESTAction's status as its filter shapes
 * it over the same dump (four groups, three installed blueprints), the placed-template goldens, and
 * the values.schema.json of mockup screen 10.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import builderpublishes from './crds/builderpublishes.composition.krateo.io.json'
import localresources from './crds/localresources.git.krateo.io.json'
import repositories from './crds/repositories.github.krateo.io.json'
import paletteStatus from './palette.status.json'

export const CRDS: Record<string, Record<string, unknown>> = {
  'builderpublishes.composition.krateo.io': builderpublishes,
  'localresources.git.krateo.io': localresources,
  'repositories.github.krateo.io': repositories,
}

/** The resolved `.status` of `blueprint-palette`, as an admin on krateo-057 would get it (sliced). */
export const PALETTE_STATUS = paletteStatus as unknown as Record<string, unknown>

/** A placed template, exactly as placing writes it. */
export const golden = (name: string): string => readFileSync(join(__dirname, 'placed', `${name}.yaml`), 'utf8')

/** Mockup screen 10's schema (10:47-72) — one populated object default, on `credentials`. */
export const MOCKUP_10_SCHEMA = `{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "required": ["name", "target", "files"],
  "properties": {
    "name":  { "type": "string", "description": "Slug; names the branch and the repo" },
    "builder": { "type": "string", "enum": ["page", "blueprint", "controller"], "default": "blueprint" },
    "target": {
      "type": "object",
      "properties": { "url": { "type": "string", "format": "uri" } }
    },
    "repository": {
      "type": "object",
      "properties": { "create": { "type": "boolean", "default": true } }
    },
    "source": {
      "type": "object",
      "properties": { "url": { "type": "string", "description": "Seed from this repo (optional)" } }
    },
    "files": { "type": "array", "default": [], "items": { "type": "object" } },
    "credentials": {
      "type": "object",
      "default": { "authMethod": "basic" },
      "properties": { "authMethod": { "type": "string", "default": "basic" } }
    }
  }
}
`

/** …and after "Fix it for me": the object default emptied, "basic" already on the scalar. */
export const MOCKUP_10_FIXED = MOCKUP_10_SCHEMA.replace('"default": { "authMethod": "basic" },', '"default": {},')
