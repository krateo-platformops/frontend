// @vitest-environment jsdom
import { library } from '@fortawesome/fontawesome-svg-core'
import { fas } from '@fortawesome/free-solid-svg-icons'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { getColorCode } from '../../theme/palette'

import Tree from './Tree'
import type { TreeWidgetData } from './Tree'

afterEach(cleanup)

// antd's Tree measures itself (virtual list); jsdom has no ResizeObserver.
vi.stubGlobal('ResizeObserver', class {
  disconnect = vi.fn()
  observe = vi.fn()
  unobserve = vi.fn()
})

// The app registers the icon packs at bootstrap (App.tsx); a unit render has to do it itself.
library.add(fas)

let location = ''
const Where = () => {
  const { pathname, search } = useLocation()
  location = `${pathname}${search}`
  return null
}

const renderTree = (widgetData: TreeWidgetData) => render(
  <MemoryRouter initialEntries={['/start']}>
    <Tree resourcesRefs={{ items: [] }} uid='t' widget={{} as never} widgetData={widgetData} />
    <Where />
  </MemoryRouter>,
).container

const node = (title: string) => screen.getByText(title).closest('.ant-tree-treenode') as HTMLElement

describe('Tree widget', () => {
  it('nests the flat list: a child is drawn once its parent is open', () => {
    renderTree({ defaultExpandAll: true, items: [{ key: 'p', title: 'parent' }, { key: 'c', parentKey: 'p', title: 'child' }] })
    expect(screen.getByText('parent')).toBeTruthy()
    expect(screen.getByText('child')).toBeTruthy()
  })

  it('keeps children folded unless asked to open them', () => {
    renderTree({ items: [{ key: 'p', title: 'parent' }, { key: 'c', parentKey: 'p', title: 'child' }] })
    expect(screen.queryByText('child')).toBeNull()
  })

  it('opens the selected node\'s ancestors and marks it selected', () => {
    renderTree({
      items: [{ key: 'a', title: 'root' }, { key: 'b', parentKey: 'a', title: 'mid' }, { key: 'c', navigateTo: '/c', parentKey: 'b', title: 'leaf' }],
      selectedKey: 'c',
    })
    expect(node('leaf').className).toContain('ant-tree-treenode-selected')
  })

  it('opens a node\'s navigateTo when it is selected', () => {
    renderTree({ items: [{ key: 'a', navigateTo: '/compositions/demo/app', title: 'app' }] })
    fireEvent.click(screen.getByText('app'))
    expect(location).toBe('/compositions/demo/app')
  })

  it('opens an absolute URL in a new tab', () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null)
    renderTree({ items: [{ key: 'a', navigateTo: 'https://example.com/x', title: 'ext' }] })
    fireEvent.click(screen.getByText('ext'))
    expect(open).toHaveBeenCalledWith('https://example.com/x', '_blank', 'noopener,noreferrer')
    expect(location).toBe('/start')
    open.mockRestore()
  })

  it('leaves a node without navigateTo inert: clicking it goes nowhere and selects nothing', () => {
    renderTree({ items: [{ key: 'a', title: 'plain' }] })
    fireEvent.click(screen.getByText('plain'))
    expect(location).toBe('/start')
    expect(node('plain').className).not.toContain('ant-tree-treenode-selected')
  })

  it('colours an icon with the palette name, resolved for the mode', () => {
    const container = renderTree({ items: [{ color: 'red', icon: 'fa-circle-xmark', key: 'a', title: 'bad' }] })
    expect(container.querySelector('svg[data-icon="circle-xmark"]')?.getAttribute('color')).toBe(getColorCode('red'))
  })

  it('sets the description in the data face beside the title', () => {
    renderTree({ items: [{ description: 'Deployment', key: 'a', title: 'web' }] })
    expect(screen.getByText('Deployment').className).toMatch(/description/)
  })
})
