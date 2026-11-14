// @vitest-environment jsdom
/**
 * The schema form's own look. RECORDED ON MAIN, before a Form inside a Card's `brand` frame took the
 * sign-in card's look: outside a frame, the form root carries only its own class, every field has
 * its connector rail (a left border and its padding), and the action bar is the sticky bezel with a
 * top hairline. The commit that restyles a framed form must keep all of this.
 *
 * jsdom applies no stylesheet, so the rail and the bar are read from the module's rules.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { cleanup, render } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import Form from './Form'

vi.mock('../../hooks/useHandleActions', () => ({ useHandleAction: () => ({ handleAction: () => Promise.resolve(), isActionLoading: false }) }))
vi.mock('antd/es/app/useApp', () => ({ default: () => ({ message: {}, modal: {}, notification: { error: () => undefined, success: () => undefined } }) }))
vi.mock('../../components/Agentiko/agentDraft', () => ({ useAgentDraft: () => ({ draft: null, nonce: 1 }) }))
vi.mock('../Drawer/DrawerContext', () => ({ useDrawerContext: () => ({ insideDrawer: false, setDrawerData: () => undefined }) }))
vi.mock('react-router', () => ({ useNavigate: () => () => undefined }))

beforeAll(() => {
  const noop = () => undefined
  Object.defineProperty(window, 'matchMedia', {
    value: (query: string) => ({ addEventListener: noop, addListener: noop, dispatchEvent: () => false, matches: false, media: query, onchange: null, removeEventListener: noop, removeListener: noop }),
    writable: true,
  })
  globalThis.ResizeObserver = class {
    disconnect = noop
    observe = noop
    unobserve = noop
  }
})
afterEach(() => { cleanup() })

const css = readFileSync(join(__dirname, 'Form.module.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
const ruleOf = (selector: string) => [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
  .filter((match) => match[1].split(',').map((part) => part.trim()).includes(selector))
  .map((match) => match[2])
  .join('\n')

describe('the schema form\'s own look, as today', () => {
  it('the form root carries only its own class', () => {
    const { container } = render(
      <Form
        resourcesRefs={{ items: [] }}
        uid='u'
        widgetData={{ actions: { rest: [{ headers: [], id: 'submit', resourceRefId: 'ref', type: 'rest' }] }, schema: { properties: { name: { title: 'Name', type: 'string' } }, type: 'object' }, submitActionId: 'submit', title: 'Request access' }}
      />,
    )
    const root = container.firstElementChild as HTMLElement
    expect([...root.classList].filter((name) => name.startsWith('_'))).toHaveLength(1)
    expect([...root.classList][0]).toMatch(/^_form_/)
  })

  it('every field has its connector rail', () => {
    expect(ruleOf('.field')).toMatch(/border-left:\s*2px solid/)
    expect(ruleOf('.field')).toMatch(/padding-left:\s*var\(--spacing-smd\);/)
  })

  it('the action bar is the sticky bezel with a top hairline', () => {
    const extra = css.match(/\.form\s*\{[\s\S]*?\.extra\s*\{([^{}]*)\}/)?.[1] ?? ''
    expect(extra).toMatch(/position:\s*sticky;/)
    expect(extra).toMatch(/border-top:\s*1px solid var\(--border-color\);/)
  })
})
