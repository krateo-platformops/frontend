// @vitest-environment jsdom
/**
 * CREATING a widget — the capability the builder did not have.
 *
 * `PalettePick` was `container | existing`: five layout kinds could be created and everything else
 * could only be REFERENCED, so a page could contain widgets somebody had already authored on the
 * cluster and nothing else. Nobody could make a new Statistic.
 *
 * The reason it is a form rather than a drop is arithmetic: 37 of the 44 kinds have required
 * widgetData fields, and a widget missing one is rejected by the apiserver at APPLY — which
 * surfaces at publish, long after the gesture, with nothing connecting the two.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { installAntdShims } from './composerTestHarness'
import { createSchema, CreateWidgetModal, PALETTE_NAMES, requiredSchema } from './CreateWidgetModal'
import { WIDGET_KINDS } from './widgetKinds.generated'

/*
 * FAKE TIMERS, because antd's Modal schedules one that outlives the test.
 *
 * rc-util's `useDelayState` drives the open/close transition with a setTimeout. Under real timers
 * that callback can fire AFTER vitest has torn the jsdom environment down, and it calls setState —
 * so React reaches for `window` and finds nothing. It surfaces as an uncaught
 * "ReferenceError: window is not defined" attributed to whichever file happened to be running,
 * which is why the report named an unrelated suite. Every test passed; the run still failed.
 *
 * Running the pending timers before handing the clock back drains the transition inside the test
 * that created it.
 */
beforeEach(() => vi.useFakeTimers())
afterEach(() => {
  cleanup()
  vi.runOnlyPendingTimers()
  vi.useRealTimers()
})
// antd needs matchMedia and ResizeObserver, which jsdom has neither of.
beforeAll(installAntdShims)

describe('requiredSchema', () => {
  it('asks only for what the CRD requires — the rest is editable in Files', () => {
    const schema = requiredSchema('BarChart')
    expect(Object.keys(schema?.properties ?? {}).sort()).toEqual(['data', 'xField', 'yField'])
  })

  it('asks nothing of a kind that requires nothing', () => {
    const undemanding = Object.keys(WIDGET_KINDS).find((kind) => WIDGET_KINDS[kind].required.length === 0)
    expect(undemanding).toBeTruthy()
    expect(requiredSchema(String(undemanding))).toBeNull()
  })

  it('returns nothing for a kind that does not exist, rather than an empty form', () => {
    expect(requiredSchema('NotAWidget')).toBeNull()
  })
})

describe('CreateWidgetModal', () => {
  const open = (widgetKind: string, onCreate = vi.fn()) => {
    render(<CreateWidgetModal onCancel={vi.fn()} onCreate={onCreate} open widgetKind={widgetKind} />)
    return onCreate
  }

  it('names the fields as the CRD names them', () => {
    // In CRD terms deliberately: `xField`, not "which column goes along the bottom". Colder, and it
    // is what makes this work on all 44 kinds instead of on a handful well.
    open('BarChart')
    expect(screen.getByText('Create a BarChart')).toBeTruthy()
    expect(document.body.textContent).toContain('xField')
  })

  it('REFUSES a name the apiserver would reject, before anything is authored', () => {
    const onCreate = open('Statistic')
    fireEvent.change(screen.getByPlaceholderText('fleet-throughput'), { target: { value: 'Not A DNS Name' } })
    fireEvent.click(screen.getByText('Create'))
    expect(onCreate).not.toHaveBeenCalled()
    expect(document.body.textContent).toMatch(/lower-case letters, digits and dashes/)
  })

  it('NAMES the missing fields rather than counting them', () => {
    // "3 fields are required" sends someone hunting for which three.
    const onCreate = open('BarChart')
    fireEvent.change(screen.getByPlaceholderText('fleet-throughput'), { target: { value: 'throughput' } })
    fireEvent.click(screen.getByText('Create'))
    expect(onCreate).not.toHaveBeenCalled()
    const shown = document.body.textContent ?? ''
    expect(shown).toContain('xField')
    expect(shown).toContain('the CRD rejects it without them')
  })

  it('hands back the name and the authored widgetData when it is satisfied', () => {
    const onCreate = open('Paragraph')
    fireEvent.change(screen.getByPlaceholderText('fleet-throughput'), { target: { value: 'intro-copy' } })
    // Paragraph's required set is small enough to satisfy through the rendered schema fields.
    for (const field of WIDGET_KINDS.Paragraph.required) {
      const input = document.querySelector(`#${field}`)
      if (input) { fireEvent.change(input, { target: { value: 'some text' } }) }
    }
    fireEvent.click(screen.getByText('Create'))
    if (WIDGET_KINDS.Paragraph.required.length === 0) {
      expect(onCreate).toHaveBeenCalledWith({ name: 'intro-copy', widgetData: {} })
    }
  })
})

/**
 * THE FOURTEEN KINDS THE FORM COULD NOT CREATE.
 *
 * A required field whose schema type is `array` counted as MISSING while it was untouched, so the
 * drop was refused with a message no amount of typing could clear. It trapped fourteen of the
 * forty-four kinds — Table and all four chart kinds among them — and the only way through was to
 * add a tag and then delete it, which produces exactly the `[]` this now writes.
 *
 * Asserted against the GENERATED table rather than a list written here: a CRD that gains a
 * required array next quarter joins the sweep instead of quietly rejoining the trapped set.
 */
describe('a required LIST left untouched', () => {
  const requiredArrays = (kind: string): string[] => {
    const properties = (WIDGET_KINDS[kind].schema as { properties?: Record<string, { type?: string }> }).properties ?? {}
    return WIDGET_KINDS[kind].required.filter((field) => properties[field]?.type === 'array')
  }
  const trapped = Object.keys(WIDGET_KINDS).filter((kind) => requiredArrays(kind).length > 0)

  // Named `mount`, not `open`: an `open` here resolves to `window.open` rather than the helper in
  // the describe above, so the render never happens and the failure reads as a missing element.
  const mount = (kind: string) => {
    const onCreate = vi.fn()
    render(<CreateWidgetModal onCancel={vi.fn()} onCreate={onCreate} open widgetKind={kind} />)
    return onCreate
  }

  it('covers the kinds this regression was about, so the sweep below is not vacuous', () => {
    expect(trapped).toContain('Table')
    expect(trapped).toContain('BarChart')
    expect(trapped.length).toBeGreaterThan(10)
  })

  it('creates EVERY such kind, writing [] for each untouched list', () => {
    for (const kind of trapped) {
      const onCreate = vi.fn()
      const { unmount } = render(<CreateWidgetModal onCancel={vi.fn()} onCreate={onCreate} open widgetKind={kind} />)
      fireEvent.change(screen.getByPlaceholderText('fleet-throughput'), { target: { value: 'a-widget' } })
      // Every required SCALAR still has to be answered — only the lists default.
      const properties = (WIDGET_KINDS[kind].schema as { properties?: Record<string, { type?: string }> }).properties ?? {}
      for (const field of WIDGET_KINDS[kind].required) {
        if (properties[field]?.type === 'array') { continue }
        const input = document.querySelector(`#${field}`)
        if (input) { fireEvent.change(input, { target: { value: 'x' } }) }
      }
      fireEvent.click(screen.getByText('Create'))

      expect(onCreate, `${kind} was refused`).toHaveBeenCalled()
      const [[{ widgetData }]] = onCreate.mock.calls as [[{ widgetData: Record<string, unknown> }]]
      for (const field of requiredArrays(kind)) {
        expect(widgetData[field], `${kind}.${field}`).toEqual([])
      }
      unmount()
    }
  })

  it('a Table created this way carries the two fields its CRD demands', () => {
    // The kind the pod-sizing page is built on, and the one the refusal was found through.
    const onCreate = mount('Table')
    fireEvent.change(screen.getByPlaceholderText('fleet-throughput'), { target: { value: 'pod-sizing-table' } })
    fireEvent.click(screen.getByText('Create'))
    expect(onCreate).toHaveBeenCalledWith({
      name: 'pod-sizing-table',
      widgetData: { allowedResources: [], columns: [] },
    })
  })

  it('still refuses a blank required SCALAR — an unanswered string is not an empty list', () => {
    const onCreate = mount('BarChart')
    fireEvent.change(screen.getByPlaceholderText('fleet-throughput'), { target: { value: 'throughput' } })
    fireEvent.click(screen.getByText('Create'))
    expect(onCreate).not.toHaveBeenCalled()
    const shown = document.body.textContent ?? ''
    expect(shown).toContain('xField')
    // …and `data`, the required LIST, is no longer named among what is missing.
    expect(shown).not.toContain('data, xField')
  })
})

/**
 * AN ARRAY OF OBJECTS GETS ROWS — a Table's `columns` rendered as an empty box.
 *
 * `controlFor` sent every array whose items were not strings to the JSON textarea, so the create
 * form showed `columns` with no inputs at all: nothing said a column is a `title` and a
 * `valueKey`. The fix is in the schema renderer, not here, so it holds for every kind whose field
 * is an array of declared objects — pinned on two of them.
 */
describe('a list of declared objects', () => {
  const mount = (kind: string) => {
    const onCreate = vi.fn()
    render(<CreateWidgetModal onCancel={vi.fn()} onCreate={onCreate} open widgetKind={kind} />)
    fireEvent.change(screen.getByPlaceholderText('fleet-throughput'), { target: { value: 'a-widget' } })
    return onCreate
  }
  const type = (id: string, value: string) => {
    const input = document.querySelector(`#${id}`)
    expect(input, `#${id} is rendered`).toBeTruthy()
    fireEvent.change(input as Element, { target: { value } })
  }

  it('Table columns: add rows, fill each column\'s own fields, remove one', () => {
    const onCreate = mount('Table')
    fireEvent.click(screen.getByText('Add columns'))
    fireEvent.click(screen.getByText('Add columns'))
    fireEvent.click(screen.getByText('Add columns'))
    type('columns_0_title', 'Pod')
    type('columns_0_valueKey', 'pod')
    type('columns_1_title', 'Scratch')
    type('columns_1_valueKey', 'scratch')
    type('columns_2_title', 'Verdict')
    type('columns_2_valueKey', 'verdict')
    fireEvent.click(screen.getByLabelText('Remove columns 2'))
    fireEvent.click(screen.getByText('Create'))

    expect(onCreate).toHaveBeenCalledWith({
      name: 'a-widget',
      widgetData: {
        allowedResources: [],
        columns: [{ title: 'Pod', valueKey: 'pod' }, { title: 'Verdict', valueKey: 'verdict' }],
      },
    })
  })

  it('names a row missing a field its item schema requires', () => {
    const onCreate = mount('Table')
    fireEvent.click(screen.getByText('Add columns'))
    type('columns_0_title', 'Pod')
    fireEvent.click(screen.getByText('Create'))
    expect(onCreate).not.toHaveBeenCalled()
    expect(document.body.textContent).toContain('columns 1 needs valueKey')
  })

  it('Breadcrumb items get the same rows — the fix is the renderer\'s, not the Table\'s', () => {
    const onCreate = mount('Breadcrumb')
    fireEvent.click(screen.getByText('Add items'))
    type('items_0_title', 'Home')
    type('items_0_href', '/')
    fireEvent.click(screen.getByText('Create'))

    expect(onCreate).toHaveBeenCalledWith({ name: 'a-widget', widgetData: { items: [{ href: '/', title: 'Home' }] } })
  })

  it('an item with NO declared fields stays JSON — a chart\'s `data` records', () => {
    mount('PieChart')
    expect(screen.queryByText('Add data')).toBeNull()
  })
})

describe('PieChart colorMap', () => {
  it('is offered as key → palette-name rows, the names read from the theme tokens', () => {
    const schema = createSchema('PieChart')
    const values = (schema?.properties?.colorMap?.additionalProperties ?? {}) as { enum?: string[] }
    expect(values.enum).toEqual([...PALETTE_NAMES])
    for (const name of ['red', 'orange', 'green', 'gray']) {
      expect(PALETTE_NAMES).toContain(name)
    }
    // Only the pie gets it; the required-only form is unchanged for everything else.
    expect(createSchema('BarChart')).toEqual(requiredSchema('BarChart'))
  })

  it('writes the map the rows describe', async () => {
    const onCreate = vi.fn()
    render(<CreateWidgetModal onCancel={vi.fn()} onCreate={onCreate} open widgetKind='PieChart' />)
    fireEvent.change(screen.getByPlaceholderText('fleet-throughput'), { target: { value: 'sizing-pie' } })
    fireEvent.change(document.querySelector('#angleField') as Element, { target: { value: 'count' } })
    fireEvent.change(document.querySelector('#colorField') as Element, { target: { value: 'verdict' } })

    fireEvent.click(screen.getByText('Add entry'))
    fireEvent.change(screen.getByLabelText('key 1'), { target: { value: 'Oversized' } })
    const select = screen.getByLabelText('value 1').closest('.ant-select')
    fireEvent.mouseDown(select?.querySelector('.ant-select-content') as Element)
    // Searched rather than scrolled to: the list is every token name, and antd virtualises it.
    fireEvent.change(select?.querySelector('input') as Element, { target: { value: 'orange' } })
    await vi.runOnlyPendingTimersAsync()
    fireEvent.click(document.querySelector('.ant-select-item-option[title="orange"]') as Element)
    fireEvent.click(screen.getByText('Create'))

    expect(onCreate).toHaveBeenCalledWith({
      name: 'sizing-pie',
      widgetData: { angleField: 'count', colorField: 'verdict', colorMap: { Oversized: 'orange' }, data: [] },
    })
  })
})
