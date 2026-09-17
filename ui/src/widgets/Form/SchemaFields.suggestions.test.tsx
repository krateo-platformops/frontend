// @vitest-environment jsdom
/**
 * `x-krateo-suggestions` — an OPEN catalogue on a schema property.
 *
 * The motivating case is the Alert create form: the platform knows which telemetry it actually
 * collects, so the alert's free-text Lucene `where` should OFFER those signals instead of
 * asking the author to recall a field name. The offer must not become a restriction — an alert
 * on something the catalogue does not list has to stay typeable — so this cannot be an `enum`,
 * and the test that matters most here is the one asserting an off-catalogue value still submits.
 */
import { cleanup, fireEvent, render } from '@testing-library/react'
import { Form as AntdForm } from 'antd'
import type { JSONSchema4 } from 'json-schema'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import { SchemaFields } from './SchemaFields'
import { getSuggestionGroups, suggestionSearchText } from './utils'

afterEach(() => { cleanup() })

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
  } as unknown as typeof ResizeObserver
})

/** A property shaped like the one the Alert formdef would decorate server-side. */
const withSuggestions = (suggestions: unknown, extra: JSONSchema4 = {}): JSONSchema4 => ({
  properties: {
    where: { title: 'Where', type: 'string', 'x-krateo-suggestions': suggestions, ...extra } as JSONSchema4,
  },
  required: ['where'],
  type: 'object',
})

const METRIC_SUGGESTIONS = [
  { description: 'bytes · working set', group: 'kubeletstats', label: 'Pod memory working set', value: 'k8s.pod.memory.working_set' },
  { description: '{cpu}', group: 'kubeletstats', value: 'k8s.pod.cpu.usage' },
  { description: '{pod}', group: 'k8sclusterreceiver', value: 'k8s.deployment.available' },
]

describe('getSuggestionGroups — reading the vendor extension', () => {
  it('returns undefined when the property carries no suggestions', () => {
    expect(getSuggestionGroups({ type: 'string' })).toBeUndefined()
  })

  it('returns undefined for a non-array or empty extension rather than an empty dropdown', () => {
    expect(getSuggestionGroups({ type: 'string', 'x-krateo-suggestions': [] } as JSONSchema4)).toBeUndefined()
    expect(getSuggestionGroups({ type: 'string', 'x-krateo-suggestions': 'nope' } as JSONSchema4)).toBeUndefined()
  })

  it('accepts bare strings as shorthand for { value }, in one ungrouped bucket', () => {
    const groups = getSuggestionGroups({ type: 'string', 'x-krateo-suggestions': ['a', 'b'] } as JSONSchema4)
    expect(groups).toEqual([{ entries: [{ value: 'a' }, { value: 'b' }], group: undefined }])
  })

  it('buckets by `group`, keeping BOTH the group order and the entry order as authored', () => {
    const groups = getSuggestionGroups(withSuggestions(METRIC_SUGGESTIONS).properties!.where)
    expect(groups?.map((bucket) => bucket.group)).toEqual(['kubeletstats', 'k8sclusterreceiver'])
    expect(groups?.[0].entries.map((entry) => entry.value)).toEqual(['k8s.pod.memory.working_set', 'k8s.pod.cpu.usage'])
    expect(groups?.[1].entries.map((entry) => entry.value)).toEqual(['k8s.deployment.available'])
  })

  it('DROPS malformed entries and keeps the rest — bad catalogue data is not a broken form', () => {
    const groups = getSuggestionGroups({
      type: 'string',
      'x-krateo-suggestions': [null, { label: 'no value' }, { value: '   ' }, '', 42, { value: 'ok' }],
    } as JSONSchema4)
    expect(groups).toEqual([{ entries: [{ description: undefined, group: undefined, label: undefined, value: 'ok' }], group: undefined }])
  })

  it('treats a blank group as ungrouped so it cannot collide with a real group name', () => {
    const groups = getSuggestionGroups({
      type: 'string',
      'x-krateo-suggestions': [{ group: '   ', value: 'a' }, { value: 'b' }],
    } as JSONSchema4)
    expect(groups).toHaveLength(1)
    expect(groups?.[0].group).toBeUndefined()
    expect(groups?.[0].entries.map((entry) => entry.value)).toEqual(['a', 'b'])
  })
})

describe('suggestionSearchText', () => {
  it('flattens label, value and description so the description is searchable too', () => {
    expect(suggestionSearchText(METRIC_SUGGESTIONS[0]))
      .toBe('pod memory working set k8s.pod.memory.working_set bytes · working set')
  })

  it('omits the members that are absent', () => {
    expect(suggestionSearchText({ value: 'Only.Value' })).toBe('only.value')
  })
})

describe('SchemaFields — a suggested field stays FREE TEXT', () => {
  const renderField = (schema: JSONSchema4, onFinish?: (values: Record<string, unknown>) => void) => {
    const Harness = () => (
      <AntdForm onFinish={(values) => onFinish?.(values as Record<string, unknown>)}>
        <SchemaFields schema={schema} />
        <button type='submit'>submit</button>
      </AntdForm>
    )
    return render(<Harness />)
  }

  it('renders an AutoComplete (not a closed Select) for a suggested string property', () => {
    const { container } = renderField(withSuggestions(METRIC_SUGGESTIONS))
    expect(container.querySelector('.ant-select-auto-complete')).toBeTruthy()
  })

  it('SUBMITS a value that is not in the catalogue', async () => {
    const onFinish = vi.fn()
    const { getByText } = renderField(withSuggestions(METRIC_SUGGESTIONS), onFinish)

    const input = document.getElementById('where') as HTMLInputElement
    expect(input).toBeTruthy()
    fireEvent.change(input, { target: { value: 'Body:"something nobody catalogued"' } })
    fireEvent.click(getByText('submit'))

    await vi.waitFor(() => { expect(onFinish).toHaveBeenCalledTimes(1) })
    expect(onFinish).toHaveBeenCalledWith({ where: 'Body:"something nobody catalogued"' })
  })

  it('shows the catalogue — grouped by what collects it — when the field is opened', async () => {
    const { container } = renderField(withSuggestions(METRIC_SUGGESTIONS))
    const input = document.getElementById('where') as HTMLInputElement
    fireEvent.mouseDown(input)
    fireEvent.focus(input)

    await vi.waitFor(() => { expect(document.querySelector('.ant-select-item-option')).toBeTruthy() })
    const dropdown = container.ownerDocument.body
    expect(dropdown.textContent).toContain('kubeletstats')
    expect(dropdown.textContent).toContain('k8sclusterreceiver')
    // The label shows the human name where one was given, the raw value otherwise.
    expect(dropdown.textContent).toContain('Pod memory working set')
    expect(dropdown.textContent).toContain('k8s.deployment.available')
    // …and the unit rides along as the muted second line.
    expect(dropdown.textContent).toContain('bytes · working set')
  })

  it('keeps an open string ARRAY multi-valued (tags), seeded with the catalogue', () => {
    const schema: JSONSchema4 = {
      properties: {
        fields: {
          items: { type: 'string' },
          title: 'Fields',
          type: 'array',
          'x-krateo-suggestions': ['ServiceName', 'SeverityText'],
        } as JSONSchema4,
      },
      required: ['fields'],
      type: 'object',
    }
    const { container } = renderField(schema)
    expect(container.querySelector('.ant-select-multiple')).toBeTruthy()
    expect(container.querySelector('.ant-select-auto-complete')).toBeNull()
  })

  it('WINS over a co-authored `enum`, which would otherwise reject every typed value', () => {
    const schema = withSuggestions(METRIC_SUGGESTIONS, { enum: ['a', 'b'] })
    const { container } = renderField(schema)
    expect(container.querySelector('.ant-select-auto-complete')).toBeTruthy()
  })
})

describe('SchemaFields — a plain enum stays closed, but searchable', () => {
  it('enables search on the enum Select so a long list is usable', () => {
    const schema: JSONSchema4 = {
      properties: { interval: { enum: ['1m', '5m', '15m'], title: 'Interval', type: 'string' } },
      required: ['interval'],
      type: 'object',
    }
    const { container } = render(<AntdForm><SchemaFields schema={schema} /></AntdForm>)
    const select = container.querySelector('.ant-select')
    expect(select).toBeTruthy()
    expect(container.querySelector('.ant-select-auto-complete')).toBeNull()
    // antd marks a searchable Select's inner input as a combobox with search enabled.
    expect(select?.classList.contains('ant-select-show-search')).toBe(true)
  })
})
