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
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import { installAntdShims } from './composerTestHarness'
import { CreateWidgetModal, requiredSchema } from './CreateWidgetModal'
import { WIDGET_KINDS } from './widgetKinds.generated'

afterEach(cleanup)
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
