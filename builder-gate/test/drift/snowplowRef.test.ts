/**
 * SNOWPLOW_REF — the snowplow tag jqcheck's vendored modules and the kind job's RESTAction CRD come
 * from — equals the snowplow version the RELEASED installer chart pins.
 *
 * WHICH PIN. The released chart, the source crdgen's tightening baseline reads
 * (crdgen/tightening_baseline_test.go pinnedVersion), and deliberately NOT installer `main`, which
 * stageReasons.test.ts reads. The two checks fail in opposite directions:
 *   - a reason code the gate knows ahead of the cluster costs nothing, so reading ahead there is
 *     the early warning;
 *   - a jq module vendored ahead of the cluster is a FALSE GREEN: the gate would accept an
 *     `include` the deployed snowplow cannot resolve. So this follows what has been released.
 *
 * Needs the network and a helm binary (CI installs one). If the pull or the read fails, the test
 * FAILS: a check that could not read the pin has checked nothing.
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import yaml from 'js-yaml'
import { describe, expect, it } from 'vitest'

import { ROOT } from '../helpers'
import { snowplowPin } from '../snowplowSource'

const INSTALLER_CHART = 'oci://ghcr.io/krateo-platformops/charts/installer'

describe('SNOWPLOW_REF vs the released installer', () => {
  it('SNOWPLOW_REF equals the snowplow pin of the released installer chart', () => {
    const dir = mkdtempSync(join(tmpdir(), 'installer-'))
    try {
      execFileSync('helm', ['pull', INSTALLER_CHART, '--untar', '-d', dir], { stdio: ['ignore', 'pipe', 'pipe'] })
      const installer = (yaml.load(readFileSync(join(dir, 'installer', 'Chart.yaml'), 'utf8')) as { version?: unknown }).version
      const pinned = snowplowPin(readFileSync(join(dir, 'installer', 'files', 'component-pins.yaml'), 'utf8'))
      const ref = readFileSync(join(ROOT, 'SNOWPLOW_REF'), 'utf8').trim()
      // eslint-disable-next-line no-console -- the run log names what was compared, so a pass says against what
      console.log(`released installer ${String(installer)} pins snowplow ${pinned}; SNOWPLOW_REF is ${ref}`)
      expect(ref, `SNOWPLOW_REF is ${ref}, but the released installer ${String(installer)} (${INSTALLER_CHART}, files/component-pins.yaml, entry snowplow) pins snowplow ${pinned}. `
        + 'Move SNOWPLOW_REF to the pin and re-vendor jqcheck/modules/ from that tag (the CI module diff names every file that differs).').toBe(pinned)
    } finally {
      rmSync(dir, { force: true, recursive: true })
    }
  })
})
