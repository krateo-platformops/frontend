/**
 * The Builders the composer engine runs — THE ONE SEAM where they are loaded (T2, frontend#408).
 *
 * WHERE THEY COME FROM TODAY. The in-repo fixtures, imported statically and parsed with the same
 * `parseBuilder` a cluster read will use. Reading Builder CRs over snowplow `/call` needs `get`/`list`
 * on builders.builders.templates.krateo.io for the portal's authenticated-user role (ADR 0001,
 * Consequences), which is a later task. When it lands, `loadBuilders` is the only function that
 * changes: every engine module asks `builderRegistry.get(...)`, never a fixture.
 *
 * WHAT THE ENGINE ASKS. A Builder by its draft kind (the held draft's `kind`), its route, its name, or
 * a verb it allows. Each answer is the parsed Builder or undefined — never a throw, because once the
 * source is the cluster an absent Builder is content ("no builder declares this"), not a crash.
 * `builderOf(kind)` is the one exception, for a draft kind this build's own DraftKind type names: the
 * fixtures test proves each has a Builder, so a miss there is a build defect, said loudly.
 */
import { load } from 'js-yaml'

import { parseBuilder, type Builder, type BuilderSpec } from './builderSpec'
import blueprintBuilderYaml from './fixtures/blueprint-builder.builder.yaml?raw'
import portalBuilderYaml from './fixtures/portal-builder.builder.yaml?raw'

/** Every Builder this frontend runs, and the problems of any that did not parse. */
interface Loaded {
  builders: readonly Builder[]
  problems: readonly string[]
}

/**
 * THE SWITCH POINT. Today: the fixtures shipped in this bundle. Later: the Builder CRs listed over
 * /call as the person, with a denial turned into a problem sentence rather than an empty registry.
 */
const loadBuilders = (): Loaded => {
  const builders: Builder[] = []
  const problems: string[] = []
  for (const [source, text] of [['portal-builder.builder.yaml', portalBuilderYaml], ['blueprint-builder.builder.yaml', blueprintBuilderYaml]] as const) {
    let raw: unknown
    try {
      raw = load(text)
    } catch (error) {
      problems.push(`${source} is not YAML: ${error instanceof Error ? error.message : String(error)}`)
      continue
    }
    const parsed = parseBuilder(raw)
    if (parsed.ok) {
      builders.push(parsed.builder)
    } else {
      problems.push(...parsed.problems.map((problem) => `${source}: ${problem}`))
    }
  }
  return { builders, problems }
}

/** How a Builder is asked for: exactly one key. */
export type BuilderQuery =
  | { draftKind: string }
  | { name: string }
  | { route: string }
  | { verb: string }

const matches = (builder: Builder, query: BuilderQuery): boolean => {
  if ('draftKind' in query) { return builder.spec.draftKind === query.draftKind }
  if ('name' in query) { return builder.metadata.name === query.name }
  if ('route' in query) { return builder.spec.route === query.route }
  return builder.spec.verbs.allowed.includes(query.verb)
}

export interface BuilderRegistry {
  /** The Builder answering the query, or undefined when none does. */
  get: (query: BuilderQuery) => Builder | undefined
  /** Every Builder, in load order. */
  all: () => readonly Builder[]
  /** Why a Builder that was offered could not be used — one sentence each. */
  problems: () => readonly string[]
}

/** A registry over a given set — the engine's own, or a test's stub Builders. */
export const createBuilderRegistry = (loaded: Loaded): BuilderRegistry => ({
  all: () => loaded.builders,
  get: (query) => loaded.builders.find((builder) => matches(builder, query)),
  problems: () => loaded.problems,
})

let active: BuilderRegistry = createBuilderRegistry(loadBuilders())

/** The registry every engine module reads. */
export const builderRegistry: BuilderRegistry = {
  all: () => active.all(),
  get: (query) => active.get(query),
  problems: () => active.problems(),
}

/**
 * Swap the Builders the engine runs — for a headless test driving a stub Builder through the engine.
 * Returns the restore. Not for product code: the product's one source is `loadBuilders`.
 */
export const swapBuildersForTest = (builders: readonly Builder[]): (() => void) => {
  const previous = active
  active = createBuilderRegistry({ builders, problems: [] })
  return () => { active = previous }
}

/**
 * The spec of the Builder a held draft's kind names. Throws only for a kind no Builder declares — a
 * kind this build's DraftKind type names but its fixtures do not, which builderFixtures.test.ts
 * refuses first.
 */
export const builderOf = (draftKind: string): BuilderSpec => {
  const builder = builderRegistry.get({ draftKind })
  if (!builder) {
    throw new Error(`No Builder declares the draft kind "${draftKind}" — every draft kind needs one (ui/src/builders/fixtures).`)
  }
  return builder.spec
}

/** The spec of the Builder a draft kind names, or undefined — for a kind that arrived as data. */
export const findBuilderOf = (draftKind: string | null | undefined): BuilderSpec | undefined =>
  (typeof draftKind === 'string' ? builderRegistry.get({ draftKind })?.spec : undefined)
