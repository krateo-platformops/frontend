// @vitest-environment jsdom
/**
 * An empty Flex renders nothing: a parent's `gap` falls between children, so an empty box still
 * opened blank space. A Flex with a `role` stays, empty or not: a `status` live region must exist
 * before its content arrives to be announced, and a landmark is navigable even when empty.
 */
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import Flex, { type FlexWidgetData } from './Flex'

const empty: FlexWidgetData = { allowedResources: ['cards'], items: [] }

describe('an empty Flex', () => {
  afterEach(() => { cleanup() })

  it('renders nothing, so a parent gap does not open around it', () => {
    const { container } = render(<Flex resourcesRefs={{ items: [] }} uid='slot' widgetData={{ ...empty, gap: 'middle', vertical: true }} />)
    expect(container.innerHTML).toBe('')
  })

  it.each(['status', 'search'] as const)('with role %s, still renders: a live region or landmark exists before its content', (role) => {
    const { container } = render(<Flex resourcesRefs={{ items: [] }} uid='region' widgetData={{ ...empty, ariaLabel: 'Result count', role }} />)
    expect(container.querySelector(`[role="${role}"]`)).not.toBeNull()
  })
})
