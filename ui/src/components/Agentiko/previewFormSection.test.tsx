// @vitest-environment jsdom
/**
 * FE-B1 — the "Create form preview" drawer section rendered through the PRODUCTION
 * schema renderer (widgets/Form SchemaForm, pure antd): field labels come from the
 * draft schema's titles (name/namespace spliced first), "(should be hidden)" fields
 * are absent, every control is disabled (read-only mount), and an unparseable schema
 * renders nothing — never a crash.
 */
import { render } from '@testing-library/react'
import { beforeAll, describe, expect, it } from 'vitest'

import { FORM_PREVIEW_TITLE, PreviewFormSection } from './previewFormSection'

beforeAll(() => {
  // antd needs these browser APIs; jsdom has neither.
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
  globalThis.ResizeObserver = class {
    disconnect = noop
    observe = noop
    unobserve = noop
  }
})

const SCHEMA_TEXT = JSON.stringify({
  properties: {
    debug: { title: 'Debug flag (should be hidden)', type: 'boolean' },
    replicas: { title: 'Replica count', type: 'integer' },
    size: { title: 'Instance size', type: 'string' },
  },
  required: ['size'],
  type: 'object',
})

describe('PreviewFormSection', () => {
  it('renders the titled section with the spliced name/namespace + draft fields, hiding the hidden ones', () => {
    const { getByText, queryByText } = render(<PreviewFormSection formSchema={SCHEMA_TEXT} />)
    expect(getByText(FORM_PREVIEW_TITLE)).toBeTruthy()
    // The splice: synthetic name + namespace, first-class form fields.
    expect(getByText('Name')).toBeTruthy()
    expect(getByText('Namespace')).toBeTruthy()
    // Draft fields render by their schema TITLES (the production SchemaFields behavior).
    expect(getByText('Instance size')).toBeTruthy()
    expect(getByText('Replica count')).toBeTruthy()
    // The formdef hide convention: "(should be hidden)" titles never reach the form.
    expect(queryByText(/Debug flag/)).toBeNull()
  })

  it('mounts read-only: every rendered input is disabled', () => {
    const { container } = render(<PreviewFormSection formSchema={SCHEMA_TEXT} />)
    const inputs = [...container.querySelectorAll('input')]
    expect(inputs.length).toBeGreaterThan(0)
    expect(inputs.every((input) => input.disabled)).toBe(true)
  })

  it('renders NOTHING for an unparseable or property-less schema — never a crash', () => {
    expect(render(<PreviewFormSection formSchema='{ not json' />).container.innerHTML).toBe('')
    expect(render(<PreviewFormSection formSchema='{"type":"object"}' />).container.innerHTML).toBe('')
  })
})
