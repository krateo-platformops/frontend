// @vitest-environment jsdom
/**
 * THE THREE CLASSES OUR CSS SELECTS THAT antd DOES NOT STYLE.
 *
 * `check-antd-selectors` files these as `?` — "cannot be called dead" — and it is right to stop
 * there. Its second oracle proves only that the component composes A name with that suffix; it
 * cannot prove that this exact prefix+suffix pair reaches the DOM. Nothing short of rendering can.
 *
 * So this is the other half of that guard, and the half it structurally cannot provide. All three
 * classes were WRONGLY declared dead during the frontend#590 audit, on the strength of grepping
 * `antd/dist/antd.css` — a file that lists what antd STYLES, not what it RENDERS. antd composes
 * class names from a prefix variable, so a composed name is absent from the stylesheet while being
 * emitted on every render, and the grep's false negative read as proof of absence. Three comments
 * were written asserting the opposite of the truth, one of them describing a user-visible bug that
 * was never happening.
 *
 * Each case below renders the real antd component in the state that should produce the class and
 * asserts it on the actual element. If antd ever does drop one, this goes red with the class named,
 * instead of a rule silently painting nothing.
 *
 * NOT COVERED, deliberately: `.ant-anchor-link-title-active`. The active state needs the scroll
 * position jsdom has not got, so rendering cannot reach it here. Its evidence is of a different
 * kind and worth recording where someone will find it: `AnchorLink.js:70` and `:74` compose
 * `-link-active` and `-link-title-active` in one function, and antd ITSELF queries
 * `.${prefixCls}-link-title-active` at `Anchor.js:106` to position its ink bar. A library does not
 * query a class it never sets. That is strong, but it is not a render, and claiming this file
 * verifies it would be the same overreach the audit already made once.
 *
 * Keep this in step with the guard's `?` output: a class that leaves that bucket no longer needs a
 * case here, and a new entry in it does.
 */
import { render } from '@testing-library/react'
import { Form, Input, Layout, Steps } from 'antd'
import { beforeAll, describe, expect, it } from 'vitest'

// `() => undefined`, not `() => {}` — an empty arrow trips no-empty-function. This is the exact
// shape SessionResumeModal.test.tsx already uses for the same stub.
const noop = () => undefined

beforeAll(() => {
  // antd's responsive observers need matchMedia, which jsdom does not provide. Without this the
  // components throw on mount and every assertion below fails for the wrong reason.
  Object.defineProperty(window, 'matchMedia', {
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

describe('classes antd emits but does not style', () => {
  it('Layout.Sider collapsed carries .ant-layout-sider-collapsed', () => {
    // Shell.module.css relies on this to hide the build line and footer name in the collapsed rail.
    // I claimed antd 6 emitted no collapsed class and that the chrome stayed visible. It does not.
    const { container } = render(
      <Layout>
        <Layout.Sider collapsed collapsible>nav</Layout.Sider>
      </Layout>,
    )
    expect(
      container.querySelector('.ant-layout-sider-collapsed'),
      'antd stopped emitting .ant-layout-sider-collapsed — the collapsed sider rule in ' +
        'Shell.module.css is now dead and the rail keeps its text chrome',
    ).not.toBeNull()
  })

  it('a finished Steps item carries .ant-steps-item-icon-finish', () => {
    // Steps.module.css leads its finished-icon selector with this, antd 6's purpose-built class.
    const { container } = render(
      <Steps current={1} items={[{ title: 'one' }, { title: 'two' }]} />,
    )
    expect(
      container.querySelector('.ant-steps-item-icon-finish'),
      'antd stopped emitting .ant-steps-item-icon-finish — the finished-step tick in ' +
        'Steps.module.css is now unstyled',
    ).not.toBeNull()
  })

  it('a validated Form.Item carries .ant-form-item-has-success', () => {
    // This pins the class whose deletion the frontend#590 audit got RIGHT, and it is the one worth
    // locking down precisely because the reason it was removed is easy to misremember:
    // .ant-form-item-has-success IS emitted by antd 6, and the rule selecting it was deleted
    // because painting a cyan border on a healthy field violates exception-only indicators — NOT
    // because the class was absent. A future reader who assumes "deleted rule, therefore dead
    // class" and re-adds it would be reintroducing the defect, so the comment explaining the
    // deletion has to stay true, and this is what keeps it true.
    const { container } = render(
      <Form>
        <Form.Item label='x' validateStatus='success'><Input /></Form.Item>
      </Form>,
    )
    expect(
      container.querySelector('.ant-form-item-has-success'),
      'antd stopped emitting .ant-form-item-has-success — the note in Form.module.css explaining ' +
        'why its rule was deleted is now describing a class that does not exist',
    ).not.toBeNull()
  })
})
