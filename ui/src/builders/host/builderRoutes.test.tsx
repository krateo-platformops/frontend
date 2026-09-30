/**
 * Which Builders get a route, and how the portal's navigation meets them (T4, frontend#410): one route
 * per Builder the registry can tell apart, never at a path the shell serves itself, and never over a
 * route the navigation registers.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import yaml from 'js-yaml'
import type { RouteObject } from 'react-router'
import { describe, expect, it } from 'vitest'

import { swapBuildersForTest } from '../builderRegistry'
import { parseBuilder, type Builder } from '../builderSpec'

import { BUILDER_ROUTE_ID, builderRoutes, mergeShellChildren } from './builderRoutes'

/** The Blueprint Builder's CR under another name, route and (optionally) draft kind. */
const builder = (name: string, route: string, draftKind = 'blueprint'): Builder => {
  const raw = yaml.load(readFileSync(join(__dirname, '..', 'fixtures', 'blueprint-builder.builder.yaml'), 'utf8')) as { spec: Record<string, unknown> }
  const parsed = parseBuilder({ ...raw, metadata: { name }, spec: { ...raw.spec, draftKind, route, verbs: { allowed: [`publish${name.replace(/-/g, '')}`] } } })
  if (!parsed.ok) { throw new Error(parsed.problems.join('; ')) }
  return parsed.builder
}

const paths = (routes: readonly RouteObject[]) => routes.map((route) => route.path)

describe('builderRoutes', () => {
  it('routes each Builder at its spec.route, with an id that marks it a builder route', () => {
    const back = swapBuildersForTest([builder('one-builder', '/one/compose'), builder('two-builder', '/two/compose', 'page')])
    try {
      expect(builderRoutes().map((route) => [route.path, route.id])).toEqual([
        ['/one/compose', `${BUILDER_ROUTE_ID}one-builder`],
        ['/two/compose', `${BUILDER_ROUTE_ID}two-builder`],
      ])
    } finally {
      back()
    }
  })

  it('routes neither of two Builders the registry flags as colliding — on a route, or on a draft kind', () => {
    const sameRoute = swapBuildersForTest([builder('one-builder', '/same/compose'), builder('two-builder', '/same/compose', 'page')])
    try {
      expect(paths(builderRoutes())).toEqual([])
    } finally {
      sameRoute()
    }
    const sameKind = swapBuildersForTest([builder('one-builder', '/one/compose'), builder('two-builder', '/two/compose')])
    try {
      expect(paths(builderRoutes())).toEqual([])
    } finally {
      sameKind()
    }
  })

  it('never takes a path the shell serves itself', () => {
    const back = swapBuildersForTest([builder('one-builder', '/profile'), builder('two-builder', '/two/compose', 'page')])
    try {
      expect(paths(builderRoutes(['/profile', '/login']))).toEqual(['/two/compose'])
    } finally {
      back()
    }
  })
})

describe('mergeShellChildren — the navigation meets the builder routes', () => {
  const children: RouteObject[] = [
    { path: '/profile' },
    { id: `${BUILDER_ROUTE_ID}portal-builder`, path: '/portal-builder/compose' },
    { path: '*' },
  ]

  it('a navigation route at a builder route\'s path REPLACES it — a Builder cannot shadow the portal\'s pages', () => {
    const merged = mergeShellChildren(children, [{ id: 'nav', path: '/portal-builder/compose' }])
    expect(merged.map((route) => route.id ?? route.path)).toEqual(['/profile', 'nav', '*'])
  })

  it('a navigation route at any other served path is dropped, as before; new ones go before the catch-all', () => {
    const merged = mergeShellChildren(children, [{ id: 'nav-profile', path: '/profile' }, { id: 'nav-fleet', path: '/fleet' }])
    expect(merged.map((route) => route.id ?? route.path)).toEqual(['/profile', `${BUILDER_ROUTE_ID}portal-builder`, 'nav-fleet', '*'])
  })

  it('nothing new: the same array, so the router is not rebuilt', () => {
    expect(mergeShellChildren(children, [{ path: '/profile' }])).toBe(children)
  })
})
