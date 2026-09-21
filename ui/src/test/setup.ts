import { configure } from '@testing-library/react'

/**
 * Testing Library's async budget, set explicitly because its default is not survivable here.
 *
 * `waitFor`/`findBy*` default to 1000ms, and that budget is SEPARATE from vitest's `testTimeout` —
 * raising one does nothing for the other. In a measured full run of this suite, one test failed at
 * 1256ms with "Unable to find a label…" while the vitest budget still had 3.7s left: the assertion
 * had given up, not the test.
 *
 * 1000ms is generous for a DOM query and tight for this one, because a jsdom + antd component
 * render is dominated by style resolution — antd v6 injects its CSS at runtime, and every
 * `getComputedStyle` (which `getByRole(…, {name})` triggers per candidate, and which
 * `Input.TextArea autoSize` triggers on every value change) re-matches the whole rule set.
 *
 * 5000ms is ~4x the observed overrun and still well under `testTimeout`, so a genuine hang is
 * still caught by the test budget rather than sitting here.
 */
configure({ asyncUtilTimeout: 5000 })

/**
 * A TIMER THAT OUTLIVED ITS DOCUMENT DOES NOTHING, instead of reddening the run.
 *
 * `@rc-component/util`'s `useDelayState` — which drives antd's Modal, Popconfirm and Collapse
 * transitions — schedules a `setTimeout` that calls `setState` when it fires, and cancels it ONLY
 * when a new value is set. There is no unmount cleanup: read the hook, `cancelPending` is called
 * from `setDelayValue` and nowhere else. So a pending transition survives its component, and since
 * vitest tears jsdom down PER FILE, it can fire while a different file is running. React then
 * reaches for `window` and finds nothing:
 *
 *   ReferenceError: window is not defined
 *     ❯ dispatchSetState   react-dom-client.development.js
 *     ❯ Timeout._onTimeout @rc-component/util/lib/hooks/useDelayState.js
 *
 * Two properties make it worth neutralising centrally. It is attributed to whichever file was
 * running when the timer fired, so the report names an innocent test and never the guilty one. And
 * it fails the RUN without failing a TEST — "1916 passed" beside a red tick — which is precisely
 * the shape a suite cannot tell you about, and this one went ungated for a long time.
 *
 * GUARDED ON HAVING HAD A WINDOW, which is the part I got wrong first. Suites that run in the NODE
 * environment have no `window` at any point, and an unconditional check suppressed every timer in
 * them — breaking a test that legitimately waits on one. Capturing the environment at setup means
 * this only ever applies where a document existed and then went away.
 *
 * Nothing legitimate is lost: every callback this can swallow is a React state update against a
 * document that no longer exists.
 */
if (typeof globalThis.window !== 'undefined') {
  const realSetTimeout = globalThis.setTimeout
  globalThis.setTimeout = ((handler: TimerHandler, timeout?: number, ...args: unknown[]) => realSetTimeout(() => {
    if (typeof globalThis.window === 'undefined') {
      return
    }
    if (typeof handler === 'function') {
      (handler as (...rest: unknown[]) => void)(...args)
    }
  }, timeout)) as unknown as typeof globalThis.setTimeout
}
