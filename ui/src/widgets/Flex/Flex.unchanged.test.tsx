// @vitest-environment jsdom
/**
 * The Flex DOM an existing CR gets, pinned. RECORDED ON `main` before `role` and `ariaLabel`
 * existed, so adding them is proven to change nothing for a Flex that sets neither.
 */
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../components/RefChild', () => ({ default: ({ resourceRefId }: { resourceRefId: string }) => <span data-ref={resourceRefId} /> }))

import Flex, { type FlexWidgetData } from './Flex'

afterEach(cleanup)

const widgetData: FlexWidgetData = {
  allowedResources: ['paragraphs'],
  gap: 'small',
  items: [{ resourceRefId: 'a' }, { resourceRefId: 'b' }],
  wrap: true,
}

describe('Flex renders as it did before role / ariaLabel', () => {
  it('a wrapping row of two children', () => {
    const { container } = render(<Flex resourcesRefs={{ items: [] }} uid='pin' widgetData={widgetData} />)
    expect(container.innerHTML).toMatchSnapshot()
  })

  it('a vertical column', () => {
    const { container } = render(<Flex resourcesRefs={{ items: [] }} uid='pin' widgetData={{ ...widgetData, align: 'stretch', gap: 'middle', vertical: true, wrap: undefined }} />)
    expect(container.innerHTML).toMatchSnapshot()
  })
})
