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
