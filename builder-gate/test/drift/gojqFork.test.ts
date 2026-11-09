/**
 * jqcheck compiles with the gojq fork snowplow compiles with: jqcheck/go.mod's `replace` of
 * github.com/itchyny/gojq equals snowplow's go.mod `replace` of it, at the tag in SNOWPLOW_REF.
 * The tag is the one jqcheck's modules are vendored from (and the released installer pins,
 * snowplowRef.test.ts), so modules and engine are snowplow's at one version.
 *
 * Read from snowplow's source, never written down here: the version this used to hardcode
 * (v0.13.0) was right only until snowplow next moved the fork.
 *
 * NETWORK: run by `npm run test:drift`. A failed read FAILS.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { describeReplace, replaceOf } from '../goMod'
import { ROOT } from '../helpers'

const GOJQ = 'github.com/itchyny/gojq'

describe('jqcheck\'s gojq vs snowplow\'s', () => {
  it('jqcheck/go.mod replaces gojq exactly as snowplow\'s go.mod does at SNOWPLOW_REF', async () => {
    const ref = process.env.SNOWPLOW_GOMOD_REF?.trim() || readFileSync(join(ROOT, 'SNOWPLOW_REF'), 'utf8').trim()
    const url = `https://raw.githubusercontent.com/krateo-platformops/snowplow/${ref}/go/snowplow/go.mod`
    const reply = await fetch(url, { signal: AbortSignal.timeout(20_000) })
    if (!reply.ok) {
      throw new Error(`GET ${url} answered ${reply.status} ${reply.statusText}`)
    }
    const snowplow = describeReplace(replaceOf(await reply.text(), GOJQ, `snowplow ${ref} go/snowplow/go.mod`))
    const gate = describeReplace(replaceOf(readFileSync(join(ROOT, 'jqcheck', 'go.mod'), 'utf8'), GOJQ, 'jqcheck/go.mod'))
    // eslint-disable-next-line no-console -- the run log names what was compared
    console.log(`snowplow ${ref}: ${snowplow}; jqcheck: ${gate}`)
    expect(gate, `jqcheck/go.mod has \`${gate}\`, but snowplow ${ref}'s go.mod has \`${snowplow}\`: set jqcheck's replace to snowplow's, then \`go mod tidy\` in jqcheck/`).toBe(snowplow)
  })
})
