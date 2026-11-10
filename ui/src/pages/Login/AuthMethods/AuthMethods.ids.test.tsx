// @vitest-environment jsdom
/**
 * Stacked credential forms give each input its own id, so every label points at its own form's input.
 *
 * Every credential form used the antd form name 'basic', and antd builds each field id from it
 * (`basic_username`). With basic and an LDAPConfig, or two LDAPConfigs, the ids repeated, and the
 * second form's labels pointed at the FIRST form's inputs — `getElementById` returns the first match.
 */
import { cleanup, render } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'

import type { AuthModeType } from '../Login.types'

import AuthMethods from './AuthMethods'

const graphics = (displayName: string) => ({ backgroundColor: '#fff', displayName, icon: 'fa-user', textColor: '#000' })

// authn's /strategies shapes: basic has no name; each LDAPConfig is its own entry, named.
const METHODS: AuthModeType[] = [
  { kind: 'basic', name: '', path: '/basic/login' },
  { graphics: graphics('Corp directory'), kind: 'ldap', name: 'corp', path: '/ldap/login' },
  { graphics: graphics('Partner directory'), kind: 'ldap', name: 'partners', path: '/ldap/login' },
]

const renderForms = () => render(<AuthMethods isLoading={false} methods={METHODS} onCredentialSubmit={() => undefined} />)

/** Each form's label `for` values, in order. */
const labelTargets = (container: HTMLElement) => [...container.querySelectorAll('form')]
  .map((form) => [...form.querySelectorAll('label[for]')].map((label) => label.getAttribute('for')!))

beforeAll(() => {
  const noop = () => undefined
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

afterEach(() => {
  cleanup()
})

describe('stacked credential forms', () => {
  it('every input id is unique, and every label points at an input in its own form', () => {
    const { container } = renderForms()
    const forms = [...container.querySelectorAll('form')]
    expect(forms).toHaveLength(3)

    const ids = [...container.querySelectorAll('input')].map((input) => input.id)
    expect(ids).toHaveLength(6)
    expect(new Set(ids).size).toBe(ids.length)

    forms.forEach((form) => {
      const labels = [...form.querySelectorAll('label[for]')]
      expect(labels).toHaveLength(2)
      labels.forEach((label) => {
        const target = document.getElementById(label.getAttribute('for')!)
        expect(target).not.toBeNull()
        expect(form.contains(target)).toBe(true)
      })
    })
  })

  it('the ids come from each /strategies entry, so they are the same on every render', () => {
    const first = labelTargets(renderForms().container)
    cleanup()
    const second = labelTargets(renderForms().container)

    expect(second).toEqual(first)
    expect(first).toEqual([
      ['login_basic_username', 'login_basic_password'],
      ['login_ldap_corp_username', 'login_ldap_corp_password'],
      ['login_ldap_partners_username', 'login_ldap_partners_password'],
    ])
  })
})
