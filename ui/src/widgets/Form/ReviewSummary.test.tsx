// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'

import { ReviewSummary } from './Form'

/**
 * "The agent fills, the human submits" is only a safeguard if the human can tell WHICH values
 * came from the agent. Without the mark the review reads as the user's own form and an
 * agent-authored value is approved on the strength of a glance. These pin that the mark lands on
 * exactly the authored rows and nowhere else.
 */
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

// Explicit: without it renders accumulate across cases and the counts pass only by ordering.
afterEach(() => { cleanup() })

const values = { name: 'my-db', namespace: 'krateo-system', replicas: 3 }

describe('ReviewSummary — provenance of each value', () => {
  it('marks only the fields Autopilot authored', () => {
    render(<ReviewSummary agentKeys={['name', 'replicas']} values={values} />)
    const tags = screen.getAllByText('Autopilot')
    expect(tags).toHaveLength(2)
  })

  it('says how many of the values the agent drafted', () => {
    render(<ReviewSummary agentKeys={['name']} values={values} />)
    expect(screen.getByText(/Autopilot drafted 1 of 3/)).toBeTruthy()
  })

  it('marks nothing, and claims nothing, for a form the human filled alone', () => {
    const { container } = render(<ReviewSummary values={values} />)
    expect(container.textContent).not.toContain('Autopilot')
  })

  it('does not count a key the agent sent that is not on screen', () => {
    // narrowAgentDraft already drops hidden/invented keys, but the count must be of what the
    // human can SEE — otherwise the header promises a row that is not there.
    render(<ReviewSummary agentKeys={['name', 'ghost']} values={values} />)
    expect(screen.getByText(/Autopilot drafted 1 of 3/)).toBeTruthy()
  })
})
