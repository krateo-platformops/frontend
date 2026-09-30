/**
 * One route per Builder (T4, frontend#410): each Builder the registry loads is mounted by the composer
 * host at its own `spec.route`. The Portal and Blueprint Builders' routes are the URLs their static
 * entries used to be (/portal-builder/compose, /blueprint-builder/compose); a Builder added as YAML
 * gets its route with no frontend change (ADR 0001, promotion step 1).
 *
 * WHICH BUILDERS GET NO ROUTE:
 *
 * - A COMPOSER NOT BUILT YET. A Builder whose palette, canvas and inspector are all PENDING plugins
 *   (pluginRegistry: named, their code due in a later release — today the Controller Builder's, T8) is
 *   loaded so the engine holds, saves and publishes its drafts, but has no composer to show. Its route
 *   appears by itself once those plugins ship. A Builder naming an UNKNOWN plugin is still mounted, and
 *   the host says what is wrong with it — that one is a mistake to see.
 * - A BUILDER THE REGISTRY CANNOT TELL APART. Two Builders claiming one route, name or draft kind are a
 *   registry problem (builderRegistry.problems()), and neither answers for the key; neither is routed.
 * - A PATH THE SHELL ALREADY SERVES. A Builder never takes a static route's path (`reserved`), and a
 *   route the portal's navigation registers later REPLACES a builder route at the same path
 *   (mergeShellChildren): a Builder CR cannot shadow the portal's own pages.
 *
 * Read when the shell's routes are built: the registry is the bundle's fixtures until Builders are
 * listed from the cluster, and then this is where a refreshed list would be re-read.
 */
import type { RouteObject } from 'react-router'

import { builderRegistry } from '../builderRegistry'
import type { Builder, BuilderSpec } from '../builderSpec'
import { resolvePlugin } from '../pluginRegistry'

import ComposerHost from './ComposerHost'

/** The id prefix of a builder route — how the shell tells one from the portal's own. */
export const BUILDER_ROUTE_ID = 'builder:'

/** Every slot the composer draws names a plugin whose code is not shipped yet. */
export const composerPending = (spec: BuilderSpec): boolean =>
  ([['palette', spec.palette.plugin], ['canvas', spec.canvas.plugin], ['inspector', spec.inspector.plugin]] as const)
    .every(([slot, name]) => {
      const resolved = resolvePlugin(slot, name)
      return !resolved.ok && resolved.pending === true
    })

/** The registry answers for this Builder by each key it routes on — none is claimed twice. */
const unambiguous = (builder: Builder): boolean =>
  builderRegistry.get({ name: builder.metadata.name }) === builder
  && builderRegistry.get({ route: builder.spec.route }) === builder
  && builderRegistry.get({ draftKind: builder.spec.draftKind }) === builder

export const builderRoutes = (reserved: readonly string[] = []): RouteObject[] => builderRegistry.all()
  .filter((builder) => !composerPending(builder.spec) && unambiguous(builder) && !reserved.includes(builder.spec.route))
  .map((builder) => ({
    element: <ComposerHost builder={builder} key={builder.metadata.name} />,
    id: `${BUILDER_ROUTE_ID}${builder.metadata.name}`,
    path: builder.spec.route,
  }))

/**
 * The shell's children with the navigation's routes merged in: a route whose path is already served
 * is dropped — unless what serves it is a builder route, which the portal's own route replaces. The
 * `*` catch-all stays last. Returns `children` itself when nothing changes.
 */
export const mergeShellChildren = (children: readonly RouteObject[], incoming: readonly RouteObject[]): RouteObject[] => {
  const incomingPaths = new Set(incoming.map((route) => route.path))
  const shadowed = (route: RouteObject) => !!route.id?.startsWith(BUILDER_ROUTE_ID) && incomingPaths.has(route.path)
  const kept = children.filter((route) => !shadowed(route))
  const existing = new Set(kept.map((route) => route.path))
  const fresh = incoming.filter((route) => !existing.has(route.path))
  if (!fresh.length && kept.length === children.length) {
    return children as RouteObject[]
  }
  const splat = kept.findIndex((route) => route.path === '*')
  return splat === -1 ? [...kept, ...fresh] : [...kept.slice(0, splat), ...fresh, ...kept.slice(splat)]
}
