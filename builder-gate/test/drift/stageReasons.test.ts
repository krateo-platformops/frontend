/**
 * builder-gate's closed set of stage reason codes (STAGE_REASONS) equals snowplow's, at the
 * snowplow version the installer pins. A code snowplow adds and the gate does not know renders as
 * a red "unknown reason" on every draft that hits it; this fails CI first, naming the code.
 *
 * NETWORK. It reads installer's component-pins.yaml and snowplow's Go source from GitHub, so it is
 * not in the default `vitest run` (vitest.config.ts excludes test/drift/): run it with
 * `npm run test:drift`. CI runs it as its own step (builder-gate.yaml). If either read fails, the
 * test FAILS: a check that cannot read snowplow has checked nothing.
 *
 * WHICH PIN. installer `main`, deliberately — unlike crdgen's tightening baseline, which reads the
 * RELEASED installer because reading ahead there hides a finding. Here reading ahead is the safe
 * direction: a snowplow bump merged on installer main reds this before an installer release rolls
 * that snowplow onto a cluster, which is when the gate starts seeing its new codes.
 *
 * SNOWPLOW_STAGE_REASONS_REF names a snowplow ref to check against instead of the pin.
 */
import { describe, expect, it } from 'vitest'

import { STAGE_REASONS } from '../../src/snowplow'
import { driftMessage, githubTree, INSTALLER_PINS_URL, reasonDiff, snowplowPin, stageReasonsAt } from '../snowplowSource'

const pinnedRef = async (): Promise<{ ref: string; source: string }> => {
  const override = process.env.SNOWPLOW_STAGE_REASONS_REF?.trim()
  if (override) {
    return { ref: override, source: 'SNOWPLOW_STAGE_REASONS_REF' }
  }
  const reply = await fetch(INSTALLER_PINS_URL, { signal: AbortSignal.timeout(20_000) })
  if (!reply.ok) {
    throw new Error(`could not read installer's pins: GET ${INSTALLER_PINS_URL} answered ${reply.status}`)
  }
  return { ref: snowplowPin(await reply.text()), source: 'installer main chart/files/component-pins.yaml, entry snowplow' }
}

describe('stage reason codes vs snowplow', () => {
  it('STAGE_REASONS equals snowplow\'s StageReason* values at the pinned snowplow', async () => {
    const { ref, source } = await pinnedRef()
    const snowplow = await stageReasonsAt(githubTree(ref))
    // eslint-disable-next-line no-console -- the run log names what was compared, so a pass says against what
    console.log(`snowplow ${ref} (${source}): ${[...snowplow].map(([name, value]) => `${name}=${value}`).join(', ')}`)
    const diff = reasonDiff(snowplow.values(), STAGE_REASONS)
    expect(diff, driftMessage(diff, ref, source)).toEqual({ onlyInGate: [], onlyInSnowplow: [] })
  })
})
