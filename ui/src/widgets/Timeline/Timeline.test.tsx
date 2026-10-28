// @vitest-environment jsdom
import { library } from '@fortawesome/fontawesome-svg-core'
import { fas } from '@fortawesome/free-solid-svg-icons'
import { cleanup, render } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'

import Timeline from './Timeline'
import type { TimelineWidgetData } from './Timeline'

afterEach(cleanup)

// The app registers the icon packs at bootstrap (App.tsx); a unit render has to do it itself.
library.add(fas)

// antd's responsive observer reads matchMedia, which jsdom does not implement.
beforeAll(() => {
  const noop = () => undefined
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: (query: string) => ({
      addEventListener: noop,
      addListener: noop,
      dispatchEvent: () => false,
      matches: false,
      media: query,
      onchange: null,
      removeEventListener: noop,
      removeListener: noop,
    }),
    writable: true,
  })
})

function renderTimeline(widgetData: TimelineWidgetData) {
  const { container } = render(
    <Timeline
      resourcesRefs={{ items: [] }}
      uid='t'
      widget={{} as never}
      widgetData={widgetData}
    />,
  )
  return container
}

describe('Timeline widget', () => {
  it('renders one node per item with its content and title', () => {
    const container = renderTimeline({
      items: [
        { content: 'Created', title: '13:57' },
        { content: 'Ready', title: '14:02' },
      ],
    })
    const nodes = container.querySelectorAll('.ant-timeline-item')
    expect(nodes).toHaveLength(2)
    expect(nodes[0].textContent).toContain('Created')
    expect(nodes[0].textContent).toContain('13:57')
    expect(nodes[1].textContent).toContain('Ready')
  })

  it('reverses the order when `reverse` is set', () => {
    const container = renderTimeline({
      items: [{ content: 'first' }, { content: 'last' }],
      reverse: true,
    })
    const nodes = container.querySelectorAll('.ant-timeline-item')
    expect(nodes[0].textContent).toContain('last')
  })

  it('renders a font awesome icon in place of the dot', () => {
    const container = renderTimeline({ items: [{ content: 'Ready', icon: 'fa-check' }] })
    expect(container.querySelector('.ant-timeline-item svg[data-icon="check"]')).not.toBeNull()
  })

  it('keeps the node text when its resourceRefId cannot be resolved', () => {
    const container = renderTimeline({ items: [{ content: 'Release notes', resourceRefId: 'missing-ref' }] })
    expect(container.querySelector('.ant-timeline-item')?.textContent).toContain('Release notes')
  })
})
