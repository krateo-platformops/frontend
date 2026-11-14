// @vitest-environment jsdom
/**
 * A Form inside a Card's `brand` frame is the sign-in card's form (mockup v3, pages/Login's
 * LoginForm): plain antd fields with no connector rail, antd's own label size and weight, the
 * action bar in the flow, the sign-in card's spacing under the heading and over the button. And a
 * `checkboxes` entry's `hideOptionalMark`. Outside a frame nothing changes
 * (Form.frameLookUnchanged, Form.checkboxMarks).
 *
 * jsdom applies no stylesheet, so the look is read from the modules' rules.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { cleanup, render } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import { BrandFrameContext } from '../../components/BrandFrame'

import Form, { type FormWidgetData } from './Form'

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

/* eslint-disable sort-keys/sort-keys-fix -- the property order is the field order */
const SCHEMA = {
  type: 'object',
  required: ['email', 'consent'],
  properties: {
    email: { type: 'string', title: 'Email' },
    phone: { type: 'string', title: 'Phone' },
    consent: { type: 'boolean', title: 'I agree.' },
    news: { type: 'boolean', title: 'Send me occasional news.' },
  },
}
/* eslint-enable sort-keys/sort-keys-fix */

const widgetData = (extra: Partial<FormWidgetData> = {}): FormWidgetData => ({
  actions: { rest: [{ headers: [], id: 'submit', resourceRefId: 'ref', type: 'rest' }] },
  checkboxes: [{ name: 'consent' }, { name: 'news' }],
  requiredMark: 'optional',
  schema: SCHEMA,
  submitActionId: 'submit',
  title: 'Request access',
  ...extra,
})

const renderForm = (data: FormWidgetData, brand = false) => render(
  <BrandFrameContext.Provider value={brand}>
    <Form resourcesRefs={{ items: [] }} uid='u' widgetData={data} />
  </BrandFrameContext.Provider>,
).container

const strip = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, '')
const formCss = strip(readFileSync(join(__dirname, 'Form.module.css'), 'utf8'))
const brandCss = strip(readFileSync(join(__dirname, '../../components/BrandFrame/BrandFrame.module.css'), 'utf8'))
const ruleOf = (css: string, selector: string) => [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
  .filter((match) => match[1].split(',').map((part) => part.trim()).includes(selector))
  .map((match) => match[2])
  .join('\n')

const itemOf = (container: HTMLElement, id: string) => container.querySelector(`#${id}`)?.closest('.ant-form-item') as HTMLElement

describe('a Form in a brand frame: the sign-in card\'s form', () => {
  it('the form root carries the sign-in look; outside a frame it does not', () => {
    const framed = renderForm(widgetData(), true).firstElementChild as HTMLElement
    expect([...framed.classList].some((name) => /^_signInForm_/.test(name))).toBe(true)
    cleanup()
    const plain = renderForm(widgetData()).firstElementChild as HTMLElement
    expect([...plain.classList].some((name) => /^_signInForm_/.test(name))).toBe(false)
  })

  it('no connector rail; antd\'s own label height, size and weight', () => {
    expect(ruleOf(formCss, '.signInForm .field')).toMatch(/border-left:\s*0;/)
    expect(ruleOf(formCss, '.signInForm .field')).toMatch(/padding-left:\s*0;/)
    expect(ruleOf(formCss, '.signInForm .field :global(.ant-form-item-label) > label')).toMatch(/height:\s*auto;/)
    for (const property of ['color', 'font-size', 'font-weight', 'line-height']) {
      expect(ruleOf(formCss, '.signInForm .fieldName')).toMatch(new RegExp(`${property}:\\s*inherit;`))
    }
  })

  it('the action bar is in the flow, with no hairline or bezel; the button sits one field step under the last field', () => {
    const bar = ruleOf(formCss, '.form.signInForm .extra')
    for (const declaration of [/position:\s*static;/, /border-top:\s*0;/, /padding:\s*0;/]) { expect(bar).toMatch(declaration) }
    expect(ruleOf(formCss, '.signInForm form > .field:last-child')).toMatch(/margin-bottom:\s*0 !important;/)
  })

  it('the installation line keeps the sign-in card\'s --spacing-lg to the fields, in the form\'s --spacing-md column', () => {
    expect(ruleOf(brandCss, '.heading > .to')).toMatch(/margin-bottom:\s*calc\(var\(--spacing-lg\) - var\(--spacing-md\)\);/)
  })

  it('a text notice is the sign-in card\'s pitch line: tucked under the installation line, --spacing-lg to the fields', () => {
    expect(ruleOf(formCss, '.form.signInForm .noticeText')).toMatch(/margin:\s*calc\(-1 \* var\(--spacing-sm\)\) 0 var\(--spacing-lg\);/)
  })
})

describe('checkboxes hideOptionalMark', () => {
  it('drops "(optional)" from that optional checkbox only', () => {
    const container = renderForm(widgetData({ checkboxes: [{ name: 'consent' }, { hideOptionalMark: true, name: 'news' }] }))
    expect(itemOf(container, 'news').textContent).toBe('Send me occasional news.')
    expect(itemOf(container, 'phone').textContent).toContain('(optional)')
  })

  it('a required checkbox is unaffected: still no mark under requiredMark optional, and its asterisk by default', () => {
    const optionalMarks = renderForm(widgetData({ checkboxes: [{ hideOptionalMark: true, name: 'consent' }, { hideOptionalMark: true, name: 'news' }] }))
    expect(itemOf(optionalMarks, 'consent').textContent).toBe('I agree.')
    expect(itemOf(optionalMarks, 'news').textContent).toBe('Send me occasional news.')
    cleanup()
    const defaults = renderForm(widgetData({ checkboxes: [{ hideOptionalMark: true, name: 'consent' }], requiredMark: undefined }))
    expect(itemOf(defaults, 'consent').textContent).toContain('*')
  })
})
