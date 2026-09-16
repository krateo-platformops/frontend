// @vitest-environment jsdom
/**
 * The point of these tests is the UN-COUPLING, not the markup.
 *
 * Before this change the preview surface — live render, per-file editor, RestDefinition editor —
 * was the body of `AutopilotPreviewDrawer`, which `AutopilotProvider` renders. It was therefore
 * reachable ONLY through the Autopilot rail, as something the agent opens. What is asserted here is
 * that the same surface now renders outside the provider, from the same bus, with no rail present.
 */
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'

import { AUTOPILOT_PREVIEW_EVENT } from '../../components/Autopilot/previewBus'
import type { AutopilotPreviewPayload } from '../../components/Autopilot/previewBus'
import { ThemeModeProvider } from '../../context/ThemeModeContext'

import PageComposer from './PageComposer'

afterEach(cleanup)

// jsdom has no ResizeObserver and antd's Tabs/TextArea construct one on mount. Same shim the
// CommandPalette and WidgetRenderer suites install; without it the whole subtree fails to render
// and every assertion below reads an empty container instead of a missing element.
beforeAll(() => {
  globalThis.ResizeObserver = class {
    disconnect() { /* nothing to disconnect in jsdom */ }
    observe() { /* jsdom never resizes */ }
    unobserve() { /* nothing to stop observing */ }
  }
})

/**
 * ThemeModeProvider, and ONLY ThemeModeProvider.
 *
 * The surface reads the theme to pick a syntax-highlighter palette, and that provider is mounted
 * app-wide at index.tsx above the router — so every route already has it. Nothing here supplies an
 * AutopilotProvider, which is the whole point: that is the coupling this change removes, and its
 * absence is what these tests assert.
 */
const mount = () => render(<ThemeModeProvider><PageComposer /></ThemeModeProvider>)

// act(): the component updates state from a DOM event listener, so without it React has not
// flushed the re-render by the time the assertion runs and every check reads the empty state.
const emit = (payload: Partial<AutopilotPreviewPayload>) => {
  act(() => {
    window.dispatchEvent(new CustomEvent(AUTOPILOT_PREVIEW_EVENT, {
      detail: { title: 'Draft', ...payload },
    }))
  })
}

describe('PageComposer — the preview surface, outside the rail', () => {
  it('renders with NO AutopilotProvider around it', () => {
    // The whole un-coupling in one assertion: this component is mounted bare. Before the split it
    // could not be — the surface lived inside the provider's subtree.
    expect(() => mount()).not.toThrow()
  })

  it('says nothing is open rather than rendering an empty canvas', () => {
    mount()

    // An empty page that looks like a failed load is the failure mode being avoided here.
    expect(screen.getByText(/No draft open/i)).toBeTruthy()
  })

  it('picks up a draft from the SAME bus Autopilot proposes on', () => {
    mount()
    emit({ summary: ['flex.page-fleet-health', 'table.fleet-failing'], title: 'Fleet health' })

    // One draft, two doors: a preview the agent proposes while this page is open lands here too.
    // A second bus would be a second source of truth about what is being authored.
    expect(screen.queryByText(/No draft open/i)).toBeNull()
    expect(screen.getByText('flex.page-fleet-health')).toBeTruthy()
  })

  it('shows the files a publish would commit, each under its repo path', () => {
    mount()
    emit({
      files: [{ content: 'kind: Flex\n', path: 'helm/portal/templates/flex.page-x.yaml' }],
      title: 'x',
    })

    expect(screen.getByText('helm/portal/templates/flex.page-x.yaml')).toBeTruthy()
  })

  it('surfaces validation problems rather than letting a bad draft look publishable', () => {
    mount()
    emit({ problems: ['spec.widgetData.actions: unknown field'], title: 'x' })

    expect(screen.getByText(/publishing this draft would be rejected/i)).toBeTruthy()
  })

  it('replaces the draft when a new preview arrives, and drops the previous verdicts', () => {
    mount()
    emit({ problems: ['first draft was broken'], title: 'first' })
    expect(screen.getByText('first draft was broken')).toBeTruthy()

    emit({ summary: ['second draft'], title: 'second' })
    // Carrying the old verdicts forward would report the PREVIOUS draft's errors against the
    // current one — the under-reporting shape that made the Autopilot review mark wrong.
    expect(screen.queryByText('first draft was broken')).toBeNull()
    expect(screen.getByText('second draft')).toBeTruthy()
  })
})
