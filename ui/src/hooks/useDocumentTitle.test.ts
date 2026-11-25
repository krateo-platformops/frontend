/**
 * The browser-tab title of an address (UX audit TTL-1, 2026-11-25): every detail, form and compose
 * page read "Krateo", because only an exact match with a labelled route was named.
 */
import { describe, expect, it } from 'vitest'

import type { AppRoute } from '../context/RoutesContext'

import { documentTitleOf } from './useDocumentTitle'

const routes: AppRoute[] = [
  { path: '/compositions', resourceRefId: '', title: 'Compositions' },
  { path: '/compositions/{namespace}/{name}', resourceRefId: '' },
  { path: '/portal-builder', resourceRefId: '', title: 'Portal Builder' },
  { path: '/search', resourceRefId: '' },
]

describe('documentTitleOf', () => {
  it('a labelled route is its label', () => {
    expect(documentTitleOf('/compositions', routes)).toBe('Compositions')
  })

  it('an address below a labelled section is "<object> · <page>"', () => {
    expect(documentTitleOf('/compositions/team-alpha/webapp-orders-2', routes)).toBe('webapp-orders-2 · Compositions')
    expect(documentTitleOf('/portal-builder/compose', routes)).toBe('compose · Portal Builder')
  })

  it('the object is shown decoded, as it is named', () => {
    expect(documentTitleOf('/compositions/team-alpha/a%20b', routes)).toBe('a b · Compositions')
    expect(documentTitleOf('/compositions/team-alpha/50%', routes)).toBe('50% · Compositions')
  })

  it('no label to name the page: the app default', () => {
    expect(documentTitleOf('/search', routes)).toBeUndefined()
    expect(documentTitleOf('/this-page-does-not-exist', routes)).toBeUndefined()
    expect(documentTitleOf('/unknown/thing', routes)).toBeUndefined()
    expect(documentTitleOf('/', routes)).toBeUndefined()
  })
})
