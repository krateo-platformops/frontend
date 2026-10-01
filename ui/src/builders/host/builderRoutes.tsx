/**
 * One route per Builder (T4, frontend#410): each Builder the registry loads is mounted by the composer
 * host at its own `spec.route`. The Portal and Blueprint Builders' routes are the URLs their static
 * entries used to be (/portal-builder/compose, /blueprint-builder/compose); a Builder added as YAML
 * gets its route with no frontend change (ADR 0001, promotion step 1).
 *
 * WHICH BUILDERS GET NO ROUTE:
 *
 * - A COMPOSER NOT BUILT YET. A Builder whose palette, canvas and inspector are all PENDING plugins
 *   (pluginRegistry: named, their code due in a later release — none today) is
 *   loaded so the engine holds, saves and publishes its drafts, but has no composer to show. Its route
 *   appears by itself once those plugins ship. A Builder naming an UNKNOWN plugin is still mounted, and
 *   the host says what is wrong with it — that one is a mistake to see.
 * - A BUILDER THE REGISTRY CANNOT TELL APART. Two Builders claiming one route, name or draft kind are a
 *   registry problem (builderRegistry.problems()), and neither answers for the key; neither is routed.
 * - A PATH THE SHELL ALREADY SERVES. A Builder never takes a static route's path (`reserved`), and a
 *   route the portal's navigation registers later REPLACES a builder route at the same path
 *   (mergeShellChildren): a Builder CR cannot shadow the portal's own pages.
 *
 * Read whenever the registry changes: the Builders are listed from the cluster after sign-in
 * (clusterBuilders.ts), and RoutesContext re-mounts the builder routes with `replaceBuilderRoutes`.
 */
import { Alert } from 'antd'
import { useSyncExternalStore } from 'react'
import type { RouteObject } from 'react-router'

import { builderRegistry, buildersStatus, subscribeBuilders } from '../builderRegistry'
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

const lastErrorOf = (): string | undefined => {
  const status = buildersStatus()
  return status.state === 'loaded' ? status.lastError : undefined
}

/**
 * A builder route's element: the composer for the Builder of that NAME, looked up live. The route is
 * mounted once per (name, route) and never rebuilt for a re-read (RoutesContext), so a re-read that
 * changes the Builder's spec reaches the composer here, as a prop, without remounting the router. It
 * re-renders only when that Builder object or a re-read error changes — never on `loading`.
 */
export const BuilderRouteHost = ({ name }: { name: string }) => {
  const builder = useSyncExternalStore(subscribeBuilders, () => builderRegistry.get({ name }))
  const lastError = useSyncExternalStore(subscribeBuilders, lastErrorOf)
  return (
    <>
      {lastError
        ? <Alert banner showIcon title={`The Builders could not be read again from the cluster: ${lastError} The ones read earlier are still in use.`} type='warning' />
        : null}
      <ComposerHost builder={builder} name={name} />
    </>
  )
}

/** What the mounted builder routes are: each route's id and path. Equal signatures, equal routes. */
export const builderRoutesSignature = (routes: readonly RouteObject[]): string =>
  routes.map((route) => `${route.id ?? ''}@${route.path ?? ''}`).sort().join('|')

export const builderRoutes = (reserved: readonly string[] = []): RouteObject[] => builderRegistry.all()
  .filter((builder) => !composerPending(builder.spec) && unambiguous(builder) && !reserved.includes(builder.spec.route))
  .map((builder) => ({
    element: <BuilderRouteHost key={builder.metadata.name} name={builder.metadata.name} />,
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

/**
 * The shell's children with the builder routes REPLACED by `fresh`: every route a previous Builder
 * list mounted is dropped, then `fresh` is merged in like any incoming route — so a navigation route
 * already at a Builder's path still wins (mergeShellChildren). Returns `children` itself when there
 * were no builder routes and none arrive.
 */
export const replaceBuilderRoutes = (children: readonly RouteObject[], fresh: readonly RouteObject[]): RouteObject[] => {
  const stripped = children.filter((route) => !route.id?.startsWith(BUILDER_ROUTE_ID))
  if (stripped.length === children.length && !fresh.length) {
    return children as RouteObject[]
  }
  return mergeShellChildren(stripped, fresh)
}
