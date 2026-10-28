import { describe, expect, it } from 'vitest'

import { formatISODate } from '../../utils/utils'

import { interpolate, resolveColor, resolvePath, resolveRow, resolveStatus, type ItemTemplate } from './itemTemplate'

describe('itemTemplate — resolvePath', () => {
  it('resolves nested dot-paths', () => {
    const item = { involvedObject: { name: 'pod-1', namespace: 'default' } }
    expect(resolvePath(item, 'involvedObject.name')).toBe('pod-1')
    expect(resolvePath(item, 'involvedObject.missing')).toBeUndefined()
    expect(resolvePath(item, 'nope.deep')).toBeUndefined()
  })
})

describe('itemTemplate — interpolate', () => {
  const item = { a: 'x', b: '', nested: { c: 'y' } }

  it('substitutes a single placeholder', () => {
    expect(interpolate('val: {a}', item)).toBe('val: x')
    expect(interpolate('{nested.c}', item)).toBe('y')
  })

  it('keeps literal text with no placeholders', () => {
    expect(interpolate('fa-ellipsis-h', item)).toBe('fa-ellipsis-h')
  })

  it('picks the first non-empty path in a {a|b|c} fallback', () => {
    // b is empty → falls back to a
    expect(interpolate('{b|a}', item)).toBe('x')
    expect(interpolate('{missing|nested.c}', item)).toBe('y')
  })

  it('renders empty string for missing/empty resolutions', () => {
    expect(interpolate('{missing}', item)).toBe('')
    expect(interpolate(undefined, item)).toBe('')
  })

  it('interpolates composite templates', () => {
    expect(interpolate('name: {a} | deep: {nested.c}', item)).toBe('name: x | deep: y')
  })

  it('renders non-string values without ever falling back to [object Object]', () => {
    const values = { arr: [1, 'two'], count: 3, obj: { k: 'v' }, off: false, on: true, zero: 0 }
    expect(interpolate('{count}', values)).toBe('3')
    expect(interpolate('{on}', values)).toBe('true')
    // false and 0 are non-empty values, not misses, so they render rather than falling through
    expect(interpolate('{off|count}', values)).toBe('false')
    expect(interpolate('{zero|count}', values)).toBe('0')
    expect(interpolate('{obj}', values)).toBe('{"k":"v"}')
    expect(interpolate('{arr}', values)).toBe('[1,"two"]')
  })
})

describe('itemTemplate — resolveColor', () => {
  it('maps a resolved value through the color map', () => {
    const spec = { default: 'gray', map: { Normal: 'blue', Warning: 'orange' }, value: '{type}' }
    expect(resolveColor(spec, { type: 'Normal' })).toBe('blue')
    expect(resolveColor(spec, { type: 'Warning' })).toBe('orange')
    // unmapped → default
    expect(resolveColor(spec, { type: 'Other' })).toBe('gray')
  })

  it('uses a literal color when no map is given', () => {
    expect(resolveColor({ value: 'green' }, {})).toBe('green')
  })

  it('falls back to gray with no spec', () => {
    expect(resolveColor(undefined, {})).toBe('gray')
  })
})

describe('itemTemplate — resolveStatus', () => {
  // The blueprint-card binding: the RESTAction computes the icon/colour server-side (jq), so the
  // strongly-typed widget just resolves the {path}s — a CompositionDefinition's Ready condition
  // becomes a green check / red x / amber clock glyph with the condition reason as the tooltip.
  const spec = { color: '{readyColor}', icon: '{readyIcon}', tooltip: '{readyReason}' }

  it('resolves the server-computed icon/colour/tooltip paths', () => {
    expect(resolveStatus(spec, { readyColor: 'green', readyIcon: 'fa-circle-check', readyReason: 'Available' }))
      .toEqual({ color: 'green', icon: 'fa-circle-check', tooltip: 'Available' })
    expect(resolveStatus(spec, { readyColor: 'red', readyIcon: 'fa-circle-xmark', readyReason: 'ReconcileError' }))
      .toEqual({ color: 'red', icon: 'fa-circle-xmark', tooltip: 'ReconcileError' })
  })

  it('falls back to gray + empty icon (no glyph rendered) when paths resolve empty', () => {
    expect(resolveStatus({ icon: '{missing}' }, {})).toEqual({ color: 'gray', icon: '', tooltip: '' })
  })

  it('is wired through resolveRow only when the template defines status', () => {
    expect(resolveRow({ primaryText: '{x}' }, { x: 'a' }).status).toBeUndefined()
    const row = resolveRow({ primaryText: '{name}', status: spec }, { name: 'aws-vpc-stack', readyColor: 'green', readyIcon: 'fa-circle-check', readyReason: 'Available' })
    expect(row.status).toEqual({ color: 'green', icon: 'fa-circle-check', tooltip: 'Available' })
  })
})

describe('itemTemplate — resolveRow', () => {
  const eventTemplate: ItemTemplate = {
    color: { default: 'gray', map: { Normal: 'blue', Warning: 'orange' }, value: '{type}' },
    formats: { secondaryText: 'datetime' },
    icon: 'fa-ellipsis-h',
    primaryText: 'name: {involvedObject.name}',
    secondaryText: '{lastTimestamp|firstTimestamp|eventTime}',
    subPrimaryText: '{message}',
    subSecondaryText: '{reason}',
  }

  it('maps an event-shaped item to row slots (an event-shaped itemTemplate binding)', () => {
    const event = {
      firstTimestamp: '2026-06-13T09:30:00Z',
      involvedObject: { name: 'pod-1' },
      message: 'Started container',
      reason: 'Started',
      type: 'Normal',
    }
    const row = resolveRow(eventTemplate, event)
    expect(row.primaryText).toBe('name: pod-1')
    expect(row.subPrimaryText).toBe('Started container')
    expect(row.subSecondaryText).toBe('Started')
    expect(row.icon).toBe('fa-ellipsis-h')
    expect(row.color).toBe('blue')
    // secondaryText falls back to firstTimestamp and is datetime-formatted
    expect(row.secondaryText).toBe(formatISODate('2026-06-13T09:30:00Z', true))
  })

  it('resolves navigateTo per-item (clickable-row / catalog binding)', () => {
    const tpl: ItemTemplate = { navigateTo: '/marketplace/{namespace}/{name}/new', primaryText: '{title}' }
    const row = resolveRow(tpl, { name: 'rancher', namespace: 'cattle-system', title: 'Rancher' })
    expect(row.navigateTo).toBe('/marketplace/cattle-system/rancher/new')
  })

  it('leaves navigateTo empty when the template is absent (non-clickable row)', () => {
    expect(resolveRow({ primaryText: '{x}' }, { x: 'a' }).navigateTo).toBe('')
  })
})
