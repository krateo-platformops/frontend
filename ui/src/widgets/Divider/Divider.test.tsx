// @vitest-environment jsdom
import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import Divider from './Divider'
import type { DividerWidgetData } from './Divider'

describe('Divider', () => {
  it('renders the plain divider its own example documents, with widgetData left empty', () => {
    // `widgetData:` with nothing under it is YAML null, which the apiserver drops: the widget gets
    // undefined. Destructuring that threw, so the documented example was a render error.
    const { container } = render(<Divider resourcesRefs={{ items: [] }} uid='d' widgetData={undefined as unknown as DividerWidgetData} />)
    expect(container.querySelector('.ant-divider')).not.toBeNull()
  })
})
