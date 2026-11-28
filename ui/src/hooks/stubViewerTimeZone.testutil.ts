import { afterEach, beforeEach, vi } from 'vitest'

/**
 * Pins the browser time zone `buildExtrasParam` reads (Intl.DateTimeFormat().resolvedOptions()
 * .timeZone) for the tests of the enclosing describe. `undefined` is a runtime that reports none.
 * Call it inside a describe: it registers its own beforeEach/afterEach.
 */
export const stubViewerTimeZone = (zone: string | undefined): void => {
  beforeEach(() => {
    vi.spyOn(Intl, 'DateTimeFormat').mockImplementation(
      () => ({ resolvedOptions: () => (zone === undefined ? {} : { timeZone: zone }) }) as unknown as Intl.DateTimeFormat,
    )
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })
}
