/**
 * The Builders the composer engine runs — THE ONE SEAM where they are held (T2, frontend#408).
 *
 * WHERE THEY COME FROM. The Builder CRs on the cluster, listed AS THE SIGNED-IN PERSON over snowplow
 * (clusterBuilders.ts, ADR 0001) and parsed here with `parseBuilder`. Nothing is bundled: the YAML
 * under ./fixtures is test data and the source the portal chart's CRs are copied from, never a
 * fallback. A failed read leaves the registry EMPTY and its status `failed`, with the sentence the
 * builder routes show — a bundled copy answering instead would hide a broken cluster source.
 *
 * ASYNC. Until the list resolves the status is `idle`/`loading` and the registry is empty; the shell
 * shows a loading state on any path it cannot route yet, then mounts one route per Builder
 * (RoutesContext). The list is cached for the session and read again when the person signs in.
 *
 * WHAT THE ENGINE ASKS. A Builder by its draft kind (the held draft's `kind`), its route, its name, or
 * a verb it allows. Each answer is the parsed Builder or undefined — never a throw, because an absent
 * Builder is content ("no builder declares this"), not a crash. `builderOf(kind)` is the one exception,
 * for a HELD draft's kind: a draft is only held inside a composer, which only mounts once its Builder
 * loaded, so a miss there is a defect, said loudly.
 */
import { parseBuilder, type Builder, type BuilderSpec } from './builderSpec'

/** Every Builder this frontend runs, and the problems of any that did not parse. */
export interface Loaded {
  builders: readonly Builder[]
  problems: readonly string[]
}

/**
 * Parse what the cluster listed: each item a Builder CR. One that does not parse is a problem sentence
 * naming it; the others still load.
 */
export const parseBuilderItems = (items: readonly unknown[]): Loaded => {
  const builders: Builder[] = []
  const problems: string[] = []
  items.forEach((item, index) => {
    const metadata = (typeof item === 'object' && item !== null ? (item as { metadata?: { name?: unknown } }).metadata : undefined)
    const source = typeof metadata?.name === 'string' && metadata.name ? `Builder ${metadata.name}` : `Builder #${index + 1}`
    const parsed = parseBuilder(item)
    if (parsed.ok) {
      builders.push(parsed.builder)
    } else {
      problems.push(...parsed.problems.map((problem) => `${source}: ${problem}`))
    }
  })
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
  /**
   * The ONE Builder answering the query, or undefined when none does — or when several do: which of
   * two Builders owns a verb (or a draft kind, a route, a name) is never decided by load order.
   */
  get: (query: BuilderQuery) => Builder | undefined
  /** Every Builder, in load order. */
  all: () => readonly Builder[]
  /** Why a Builder that was offered could not be used, or a key two Builders claim — one sentence each. */
  problems: () => readonly string[]
  /** Why a verb has no Builder: the sentence naming the Builders that BOTH allow it, or null. */
  verbProblem: (verb: string) => string | null
}

const describeQuery = (query: BuilderQuery): string => {
  if ('draftKind' in query) { return `the draft kind "${query.draftKind}"` }
  if ('name' in query) { return `the name "${query.name}"` }
  if ('route' in query) { return `the route ${query.route}` }
  return `the verb ${query.verb}`
}

/** The sentence for a key several Builders claim, or null when at most one does. */
const ambiguity = (builders: readonly Builder[], query: BuilderQuery): string | null => {
  const claimants = builders.filter((builder) => matches(builder, query))
  return claimants.length > 1
    ? `${claimants.map((builder) => builder.metadata.name).join(' and ')} ${claimants.length === 2 ? 'both' : 'all'} declare ${describeQuery(query)}, so no builder answers for it — one Builder must own it.`
    : null
}

/** Every key two or more Builders claim, as one sentence each. */
const collisions = (builders: readonly Builder[]): string[] => {
  const queries: BuilderQuery[] = builders.flatMap((builder) => [
    { draftKind: builder.spec.draftKind },
    { name: builder.metadata.name },
    { route: builder.spec.route },
    ...builder.spec.verbs.allowed.map((verb) => ({ verb })),
  ])
  return [...new Set(queries.map((query) => ambiguity(builders, query)).filter((problem): problem is string => problem !== null))]
}

/** A registry over a given set — the engine's own, or a test's stub Builders. */
export const createBuilderRegistry = (loaded: Loaded): BuilderRegistry => {
  const problems = [...loaded.problems, ...collisions(loaded.builders)]
  return {
    all: () => loaded.builders,
    get: (query) => {
      const found = loaded.builders.filter((builder) => matches(builder, query))
      return found.length === 1 ? found[0] : undefined
    },
    problems: () => problems,
    verbProblem: (verb) => ambiguity(loaded.builders, { verb }),
  }
}

let active: BuilderRegistry = createBuilderRegistry({ builders: [], problems: [] })

/**
 * Where the cluster read stands. `failed` carries the sentence the builder routes show; `loaded` may
 * still carry problems (a Builder that did not parse), which the registry's `problems()` lists.
 */
export type BuildersStatus =
  | { state: 'idle' }
  | { state: 'loading' }
  | { state: 'loaded' }
  | { state: 'failed'; reason: string }

let status: BuildersStatus = { state: 'idle' }
/** Bumped on every change, so a subscriber re-reads the routes even when the state name is the same. */
let version = 0
const listeners = new Set<() => void>()

const notify = () => {
  version += 1
  listeners.forEach((listener) => { listener() })
}

/** The current read status — `useSyncExternalStore`'s snapshot (a stable object until it changes). */
export const buildersStatus = (): BuildersStatus => status

/** A number that changes whenever the registry or its status does. */
export const buildersVersion = (): number => version

/** Hear every change of the Builders or their status. Returns the unsubscribe. */
export const subscribeBuilders = (listener: () => void): (() => void) => {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

/** The read started: the registry keeps what it holds until the answer arrives. */
export const markBuildersLoading = (): void => {
  status = { state: 'loading' }
  notify()
}

/** The read answered: these Builders (and these problems) are what the engine runs now. */
export const installBuilders = (loaded: Loaded): void => {
  active = createBuilderRegistry(loaded)
  status = { state: 'loaded' }
  notify()
}

/**
 * The read failed: NO Builder runs, and `reason` is said on the builder routes. Never a fallback to
 * bundled specs — that would mask the broken source.
 */
export const failBuilders = (reason: string): void => {
  active = createBuilderRegistry({ builders: [], problems: [] })
  status = { reason, state: 'failed' }
  notify()
}

/** The registry every engine module reads. */
export const builderRegistry: BuilderRegistry = {
  all: () => active.all(),
  get: (query) => active.get(query),
  problems: () => active.problems(),
  verbProblem: (verb) => active.verbProblem(verb),
}

/**
 * Swap the Builders the engine runs — for a headless test driving a stub Builder through the engine.
 * Returns the restore. Not for product code: the product's one source is the cluster read
 * (clusterBuilders.ts `loadClusterBuilders`).
 */
export const swapBuildersForTest = (builders: readonly Builder[]): (() => void) => {
  const previous = active
  const previousStatus = status
  active = createBuilderRegistry({ builders, problems: [] })
  status = { state: 'loaded' }
  notify()
  return () => {
    active = previous
    status = previousStatus
    notify()
  }
}

/**
 * The spec of the Builder a held draft's kind names. Throws only for a kind no loaded Builder
 * declares: a draft is held only inside the composer its Builder mounted, so a miss is a defect.
 */
export const builderOf = (draftKind: string): BuilderSpec => {
  const builder = builderRegistry.get({ draftKind })
  if (!builder) {
    throw new Error(`No Builder declares the draft kind "${draftKind}" — every draft kind needs one, and the Builders are read from the cluster.`)
  }
  return builder.spec
}

/** The spec of the Builder a draft kind names, or undefined — for a kind that arrived as data. */
export const findBuilderOf = (draftKind: string | null | undefined): BuilderSpec | undefined =>
  (typeof draftKind === 'string' ? builderRegistry.get({ draftKind })?.spec : undefined)
