import { describe, expect, it } from 'vitest'

import { tracesEndpointOf } from './endpoint'

describe('tracesEndpointOf', () => {
  it('is off when nothing is configured, including the empty strings the chart ships', () => {
    expect(tracesEndpointOf(undefined)).toBeUndefined()
    expect(tracesEndpointOf({})).toBeUndefined()
    expect(tracesEndpointOf({ OTEL_COLLECTOR_URL: '', OTEL_TRACES_ENDPOINT: '' })).toBeUndefined()
  })

  it('honours the current name alone, which index.tsx used to ignore', () => {
    expect(tracesEndpointOf({ OTEL_TRACES_ENDPOINT: 'https://a/t' })).toBe('https://a/t')
  })

  it('keeps the older name working', () => {
    expect(tracesEndpointOf({ OTEL_COLLECTOR_URL: 'https://b/t' })).toBe('https://b/t')
  })

  it('prefers the current name, and a blank one does not shadow the older', () => {
    expect(tracesEndpointOf({ OTEL_COLLECTOR_URL: 'https://b/t', OTEL_TRACES_ENDPOINT: 'https://a/t' })).toBe('https://a/t')
    expect(tracesEndpointOf({ OTEL_COLLECTOR_URL: 'https://b/t', OTEL_TRACES_ENDPOINT: '' })).toBe('https://b/t')
  })
})
