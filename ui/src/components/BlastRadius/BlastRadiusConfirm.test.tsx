// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { ThemeModeProvider } from '../../context/ThemeModeContext'
import type { BlastRadiusSet, BlastRadiusSetOp } from '../../hooks/blastRadius.types'

import BlastRadiusConfirm from './BlastRadiusConfirm'

const op = (resource: string): BlastRadiusSetOp => ({
  gvr: { group: 'example.krateo.io', resource, version: 'v1' },
  irreversible: false,
  namespace: 'demo',
  verb: 'POST',
})

const set = (ops: BlastRadiusSetOp[]): BlastRadiusSet => ({ count: ops.length, kind: 'set', ops })

const renderConfirm = (radius: BlastRadiusSet) => render(
  <ThemeModeProvider>
    <BlastRadiusConfirm radius={radius} />
  </ThemeModeProvider>
)

/** Counts in the set confirm agree with their noun — "1 object", never "1 objects". */
describe('BlastRadiusConfirm count copy', () => {
  afterEach(cleanup)

  it('says "apply 1 object" for a single-op set', () => {
    renderConfirm(set([op('widgets')]))
    expect(screen.getByText('apply 1 object, in order')).toBeTruthy()
  })

  it('says "apply 2 objects" for a two-op set', () => {
    renderConfirm(set([op('widgets'), op('widgets')]))
    expect(screen.getByText('apply 2 objects, in order')).toBeTruthy()
  })

  it('agrees branch / file / change request counts on a git publish set', () => {
    renderConfirm(set([op('gitrefs'), op('repocontents'), op('pullrequests')]))
    expect(screen.getByText(/^1 branch · 1 file · 1 change request · /)).toBeTruthy()
  })

  it('pluralises every git publish count above one', () => {
    renderConfirm(set([op('gitrefs'), op('gitrefs'), op('repocontents'), op('repocontents'), op('pullrequests'), op('pullrequests')]))
    expect(screen.getByText(/^2 branches · 2 files · 2 change requests · /)).toBeTruthy()
  })
})
