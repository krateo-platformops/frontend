// @vitest-environment jsdom
/**
 * The publish-destination form's RENDERED behaviour — the two things a tester's screenshot
 * caught that no headless test could: where the modal stacks, and what it prefills.
 *
 * 1. THE PUBLISH GATE MUST PAINT ABOVE THE PREVIEW DRAWER.
 *
 * Regression guard for the bug a tester photographed: the destination form opened BEHIND
 * the Autopilot preview drawer, clipped to a sliver with "Confirm destination" somewhere
 * unreachable, so a publish started from the preview could not be completed at all.
 *
 * Why it happened, and why an equality test is the right guard: in antd 6 both surfaces
 * default to `token.zIndexPopupBase` (1000). The drawer pins itself there EXPLICITLY, so a
 * modal left at the default merely TIES with it — and a tie is broken by DOM order, which
 * the always-mounted drawer wins. Nothing about that is visible in either file alone, so
 * this test asserts the RELATIONSHIP between the two constants rather than a magic number.
 *
 * 2. THE REMEMBERED DESTINATION IS PER KIND. The same screenshot showed a PAGE publish
 * prefilled with krateo-oas — the KOG registry — because one global memo carried the last
 * confirmed answer across kinds. The artifacts live in different repos by design, so that
 * prefill is a mis-publish that looks plausible. Repeating the OWNER and BASE within a kind
 * stays; the repository is never repeated, because every artifact has its own.
 *
 * 3. A SEEDED REPOSITORY IS NAMED FOR ITS CHART. With a builder template configured, the form
 * refuses any other repository, and says why, before the publish is built.
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'

import { PREVIEW_DRAWER_Z_INDEX } from './previewSurface'
import PublishTargetFormHost, { askPublishDestination, requestPublishTarget, resetPublishTargetForTests } from './publishTargetForm'

// antd's responsive observer needs matchMedia, and its Modal needs ResizeObserver; jsdom
// ships neither. Same stub the preview-drawer suite installs.
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
  globalThis.ResizeObserver = class {
    disconnect = noop
    observe = noop
    unobserve = noop
  }
})

afterEach(() => {
  cleanup()
  resetPublishTargetForTests()
})

describe('the publish-destination gate stacks above the preview drawer', () => {
  it('opens above the drawer instead of tying with it', async () => {
    render(<PublishTargetFormHost />)
    // The request is a promise the HOST resolves when the human answers, so it must not be
    // awaited here — awaiting it would hang until the modal that this test is checking for
    // is dismissed. Scheduling it inside act() flushes the state update that opens it.
    let settled = false
    await act(() => {
      void requestPublishTarget({ base: 'main', kind: 'page', owner: 'krateo-platformops', repo: 'krateo-oas' })
        .then(() => { settled = true })
      return Promise.resolve()
    })
    // Guard the guard: if no host had registered, the request would resolve its prefills
    // immediately and the assertions below would be vacuous.
    expect(settled).toBe(false)

    await waitFor(() => expect(screen.getByTestId('publish-target-form')).toBeTruthy())

    const wrap = document.querySelector<HTMLElement>('.ant-modal-wrap')
    expect(wrap).toBeTruthy()
    const declared = wrap?.style.zIndex ?? ''

    // An UNSET z-index is the bug itself, not a zero: antd then falls back to
    // `zIndexPopupBase`, which is the 1000 the drawer already occupies.
    expect(declared, 'the modal must declare a z-index; unset inherits 1000 and ties with the drawer').not.toBe('')
    // STRICTLY above, not merely equal — equal is what put the buttons out of reach.
    expect(Number(declared)).toBeGreaterThan(PREVIEW_DRAWER_Z_INDEX)
  })

  it('does NOT tell the user to go create the repository by hand', async () => {
    // This copy used to read "The repository below must already exist ... it does not create the
    // repository", which is false: builder-publish renders a github Repository with
    // `repository.create: true` / `autoInit: true` and creates it. Verified on krateo-057 — a publish
    // to krateo-blueprints/demo-destination rendered `publish-team-health-repo` with auto_init true.
    // It also contradicted the compose-page form's own field help one panel away ("Created
    // automatically if it does not exist yet"), so a user got opposite instructions for one action.
    render(<PublishTargetFormHost />)
    await act(() => {
      void requestPublishTarget({ base: 'main', kind: 'page', owner: 'krateo-blueprints', repo: 'demo-destination' })
      return Promise.resolve()
    })
    const note = await screen.findByTestId('publish-repo-precondition')
    expect(note.textContent).toMatch(/created if it doesn’t exist/i)
    expect(note.textContent, 'the old, false precondition must not come back').not.toMatch(/must already exist/i)
  })

  it('does NOT throw the publish away on Escape (frontend#279)', async () => {
    // onCancel resolves the awaited destination as null, which aborts the whole publish and sends
    // the user back to re-preview. antd fires onCancel for Escape and for the mask as well as for
    // the Cancel button — and this modal sits ABOVE the preview drawer, so its mask covers the
    // drawer: a click aimed at the drawer's own close button lands on the mask. Losing composed work
    // to a stray key or click is never what someone meant.
    render(<PublishTargetFormHost />)
    let settled: unknown = 'pending'
    await act(() => {
      void requestPublishTarget({ base: 'main', kind: 'blueprint', owner: 'krateo-blueprints', repo: 'demo' })
        .then((target) => { settled = target })
      return Promise.resolve()
    })
    await waitFor(() => expect(screen.getByTestId('publish-target-form')).toBeTruthy())

    await act(() => {
      fireEvent.keyDown(document, { code: 'Escape', key: 'Escape', keyCode: 27 })
      return Promise.resolve()
    })

    expect(settled, 'Escape must not resolve the destination — the publish stays in flight').toBe('pending')
    expect(screen.getByTestId('publish-target-form'), 'the form must still be open').toBeTruthy()
  })
})

describe('the remembered destination is per kind', () => {
  it('does not carry a KOG registry answer over to a page publish', async () => {
    render(<PublishTargetFormHost />)

    // 1. Confirm a KOG mapping into the registry repo — the answer worth remembering.
    let kog: Promise<unknown> = Promise.resolve()
    await act(async () => {
      kog = requestPublishTarget({ base: 'main', kind: 'restdef', owner: 'krateo-platformops', repo: 'krateo-oas' })
      await Promise.resolve()
    })
    await waitFor(() => expect(screen.getByTestId('publish-target-form')).toBeTruthy())
    expect(screen.getByLabelText<HTMLInputElement>('Repository').value).toBe('krateo-oas')

    await act(async () => {
      fireEvent.click(screen.getByText('Confirm destination'))
      await kog
    })

    // 2. A PAGE publish must arrive at its OWN default, not the registry just confirmed.
    await act(async () => {
      void requestPublishTarget({ base: 'main', kind: 'page', owner: 'krateo-platformops', repo: 'krateo-portal-chart' })
      await Promise.resolve()
    })
    await waitFor(() => expect(screen.getByTestId('publish-target-form')).toBeTruthy())
    expect(screen.getByLabelText<HTMLInputElement>('Repository').value).toBe('krateo-portal-chart')
  })

  it('repeats the last OWNER and BASE within the same kind — never the repository', async () => {
    // The repository used to be remembered with them, so a second publish defaulted to the FIRST
    // artifact's repository: fifteen page sets landed in one repo that way. Every artifact has its
    // own repository now, so the prefill is always the request's; owner and base are worth repeating.
    render(<PublishTargetFormHost />)

    let first: Promise<unknown> = Promise.resolve()
    await act(async () => {
      first = requestPublishTarget({ base: 'main', kind: 'blueprint', owner: 'krateo-blueprints', repo: 'orders-api' })
      await Promise.resolve()
    })
    await waitFor(() => expect(screen.getByTestId('publish-target-form')).toBeTruthy())

    // The human corrects the owner and base, then confirms.
    fireEvent.change(screen.getByLabelText('Repository owner'), { target: { value: 'acme' } })
    fireEvent.change(screen.getByLabelText('Base branch (the change-request target)'), { target: { value: 'develop' } })
    await act(async () => {
      fireEvent.click(screen.getByText('Confirm destination'))
      await first
    })

    // Another blueprint: the corrections carry over, the repository is the new chart's.
    await act(async () => {
      void requestPublishTarget({ base: 'main', kind: 'blueprint', owner: 'krateo-blueprints', repo: 'billing-api' })
      await Promise.resolve()
    })
    await waitFor(() => expect(screen.getByTestId('publish-target-form')).toBeTruthy())
    expect(screen.getByLabelText<HTMLInputElement>('Repository owner').value).toBe('acme')
    expect(screen.getByLabelText<HTMLInputElement>('Base branch (the change-request target)').value).toBe('develop')
    expect(screen.getByLabelText<HTMLInputElement>('Repository').value).toBe('billing-api')
  })
})

describe('a seeded destination is named for its chart', () => {
  it('refuses another repository, with the reason, and confirms the chart\'s own', async () => {
    render(<PublishTargetFormHost />)
    let settled: unknown = 'pending'
    await act(async () => {
      void requestPublishTarget({ base: 'main', kind: 'blueprint', owner: 'krateo-blueprints', repo: 'orders-api', requiredRepo: 'orders-api' })
        .then((target) => { settled = target })
      await Promise.resolve()
    })
    await waitFor(() => expect(screen.getByTestId('publish-target-form')).toBeTruthy())
    // Said before anyone edits anything: the field is not free text here, and the person should
    // not have to be refused to learn that.
    expect(screen.getByText(/Named for this blueprint/)).toBeTruthy()

    fireEvent.change(screen.getByLabelText('Repository'), { target: { value: 'blueprints' } })
    await act(async () => {
      fireEvent.click(screen.getByText('Confirm destination'))
      await Promise.resolve()
    })
    expect(await screen.findByText(/the repository must be "orders-api", not "blueprints"/)).toBeTruthy()
    expect(settled, 'a refused repository must not resolve the destination').toBe('pending')

    fireEvent.change(screen.getByLabelText('Repository'), { target: { value: 'orders-api' } })
    await act(async () => {
      fireEvent.click(screen.getByText('Confirm destination'))
      await Promise.resolve()
    })
    await waitFor(() => expect(settled).toEqual({ base: 'main', owner: 'krateo-blueprints', repo: 'orders-api' }))
  })

  it('a SEEDED publish asks with the slug as the one repository it takes; an unseeded one does not', async () => {
    // The path the composer and the agent take: publishDraft says whether the new repo is seeded,
    // and only then is the repository fixed. Driven through askPublishDestination, not a hand-built
    // request, because that translation is what decides whether the form refuses anything at all.
    render(<PublishTargetFormHost />)
    await act(async () => {
      void askPublishDestination({ repo: 'blueprints' }, 'blueprint', 'fallback', 'krateo-blueprints', { seeded: true, slug: 'orders-api' })
      await Promise.resolve()
    })
    await waitFor(() => expect(screen.getByTestId('publish-target-form')).toBeTruthy())
    expect(screen.getByLabelText<HTMLInputElement>('Repository').value).toBe('orders-api')
    expect(screen.getByText(/Named for this blueprint/)).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Repository'), { target: { value: 'blueprints' } })
    await act(async () => {
      fireEvent.click(screen.getByText('Confirm destination'))
      await Promise.resolve()
    })
    expect(await screen.findByText(/the repository must be "orders-api", not "blueprints"/)).toBeTruthy()
    await act(async () => {
      fireEvent.click(screen.getByText('Cancel publish'))
      await Promise.resolve()
    })

    await act(async () => {
      void askPublishDestination({}, 'blueprint', 'fallback', 'krateo-blueprints', { seeded: false, slug: 'orders-api' })
      await Promise.resolve()
    })
    await waitFor(() => expect(screen.getByLabelText<HTMLInputElement>('Repository').value).toBe('orders-api'))
    expect(screen.queryByText(/Named for this blueprint/)).toBeNull()
  })

  it('takes any repository when nothing is required — an unseeded publish', async () => {
    render(<PublishTargetFormHost />)
    let settled: unknown = 'pending'
    await act(async () => {
      void requestPublishTarget({ base: 'main', kind: 'page', owner: 'acme', repo: 'fleet-health' })
        .then((target) => { settled = target })
      await Promise.resolve()
    })
    await waitFor(() => expect(screen.getByTestId('publish-target-form')).toBeTruthy())
    expect(screen.queryByText(/Named for this page/)).toBeNull()
    fireEvent.change(screen.getByLabelText('Repository'), { target: { value: 'team-pages' } })
    await act(async () => {
      fireEvent.click(screen.getByText('Confirm destination'))
      await Promise.resolve()
    })
    await waitFor(() => expect(settled).toEqual({ base: 'main', owner: 'acme', repo: 'team-pages' }))
  })
})
