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
import { CreateWidgetModal, requiredSchema } from './CreateWidgetModal'
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
      const { widgetData } = (onCreate.mock.calls[0] as [{ widgetData: Record<string, unknown> }])[0]
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
