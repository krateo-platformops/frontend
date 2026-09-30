/**
 * One route per Builder (T4, frontend#410): each Builder the registry loads is mounted by the composer
 * host at its own `spec.route`. The Portal and Blueprint Builders' routes are the URLs their static
 * entries used to be (/portal-builder/compose, /blueprint-builder/compose); a Builder added as YAML
 * gets its route with no frontend change (ADR 0001, promotion step 1).
 *
 * A COMPOSER NOT BUILT YET GETS NO ROUTE. A Builder whose palette, canvas and inspector are all
 * PENDING plugins (pluginRegistry: named, their code due in a later release — today the Controller
 * Builder's, T8) is loaded so the engine holds, saves and publishes its drafts, but it has no composer
 * to show: mounting it would be a page of "not shipped yet" sentences at a URL nothing links to. Its
 * route appears by itself once those plugins ship. A Builder naming a plugin that is UNKNOWN (not
 * pending) is still mounted, and the host says what is wrong with it — that one is a mistake to see.
 *
 * Read when the shell's routes are built: the registry is the bundle's fixtures until Builders are
 * listed from the cluster, and then this is where a refreshed list would be re-read.
 */
import type { RouteObject } from 'react-router'

import { builderRegistry } from '../builderRegistry'
import type { BuilderSpec } from '../builderSpec'
import { resolvePlugin } from '../pluginRegistry'

import ComposerHost from './ComposerHost'

/** Every slot the composer draws names a plugin whose code is not shipped yet. */
export const composerPending = (spec: BuilderSpec): boolean =>
  ([['palette', spec.palette.plugin], ['canvas', spec.canvas.plugin], ['inspector', spec.inspector.plugin]] as const)
    .every(([slot, name]) => {
      const resolved = resolvePlugin(slot, name)
      return !resolved.ok && resolved.pending === true
    })

export const builderRoutes = (): RouteObject[] => builderRegistry.all()
  .filter((builder) => !composerPending(builder.spec))
  .map((builder) => ({
    element: <ComposerHost builder={builder} key={builder.metadata.name} />,
    path: builder.spec.route,
  }))
