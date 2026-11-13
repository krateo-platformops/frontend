// @vitest-environment jsdom
/**
 * `role` and `ariaLabel` on a Flex: a page's filter bar is a named `search` landmark, and the
 * line holding its result count is a `status` region, which assistive technology announces
 * politely when the count changes (decision Q7, root-pages UX). Flex.unchanged.test.tsx pins that a
 * Flex setting neither renders as before.
 */
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../components/RefChild', () => ({ default: ({ resourceRefId }: { resourceRefId: string }) => <span>{resourceRefId}</span> }))

import Flex, { type FlexWidgetData } from './Flex'

afterEach(cleanup)

const base: FlexWidgetData = { allowedResources: ['selects'], items: [{ resourceRefId: 'kind' }], wrap: true }

describe('Flex role / ariaLabel', () => {
  it('a filter bar is a search landmark named by ariaLabel', () => {
    render(<Flex resourcesRefs={{ items: [] }} uid='bar' widgetData={{ ...base, ariaLabel: 'Filter incidents', role: 'search' }} />)
    const bar = screen.getByRole('search', { name: 'Filter incidents' })
    expect(bar.textContent).toBe('kind')
  })

  it('a result count line is a status region, so its changes are announced', () => {
    render(<Flex resourcesRefs={{ items: [] }} uid='count' widgetData={{ ...base, ariaLabel: 'Result count', role: 'status' }} />)
    expect(screen.getByRole('status', { name: 'Result count' })).toBeTruthy()
  })
})
