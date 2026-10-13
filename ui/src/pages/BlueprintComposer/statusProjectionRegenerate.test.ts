/**
 * THE REGENERATOR CLI'S REFUSALS (#483, #485).
 *
 * `projectionCompile.test.ts` covers the recompile. This covers the wrapper around it —
 * `scripts/status-projection-regenerate.mts` — which until now had no test of any kind, because
 * nothing under `scripts/` did and the file exited the process on import.
 *
 * The branch that matters most is the one #485 exists for: the run has to know its own version
 * before it may stamp anything, and in a shallow or untagged checkout it does not. Writing
 * `frontend-unknown` would be worse than writing nothing, so it refuses instead — and that refusal
 * had never been executed. Everything here runs offline: `main` takes its argv, its tag lookup and
 * its kubectl as arguments.
 *
 * It lives under `ui/` because that is vitest's root; its subject is at the repo root.
 */
import { readFileSync } from 'node:fs'

import { describe, expect, it, vi } from 'vitest'

import { main } from '../../../../scripts/status-projection-regenerate.mts'

import stale from './__fixtures__/eventSiteStatusStale.json'
import { GENERATED_BY_ANNOTATION } from './projectionCompile'

/** The apiserver's own pre-#482 `event-site-status`, as a list — the real object, not a mock. */
const list = (...items: unknown[]): string => JSON.stringify({ items })

/** Records every kubectl invocation, answers the LIST, and lets the caller decide what patching does. */
const fakeKubectl = (answer: string, onPatch?: () => string) => {
  const calls: string[][] = []
  const kubectl = (args: string[]): string => {
    calls.push(args)
    if (args.includes('patch')) { return onPatch ? onPatch() : '' }
    return answer
  }
  return { calls, kubectl, patches: () => calls.filter((call) => call.includes('patch')) }
}

type MergePatch = { metadata: { annotations: Record<string, string> }; spec: unknown }

/** The merge patch the run wrote to disk for a given kubectl patch invocation. */
const patchBody = (args: string[]): MergePatch =>
  JSON.parse(readFileSync(args[args.indexOf('--patch-file') + 1], 'utf8')) as MergePatch

const quiet = () => {
  const log = vi.spyOn(console, 'log').mockImplementation(() => undefined)
  const err = vi.spyOn(console, 'error').mockImplementation(() => undefined)
  const restore = () => {
    log.mockRestore()
    err.mockRestore()
  }
  return { err, log, restore }
}

const noTag = () => null

describe('a patch may not land on an ambient cluster', () => {
  it('refuses --apply without an explicit --kubeconfig and --context, before looking at anything', () => {
    const kube = fakeKubectl(list(stale))
    const spy = quiet()
    const code = main(['node', 'script', '--apply'], { describeNearestTag: () => '1.8.2', kubectl: kube.kubectl })
    const said = spy.err.mock.calls.flat().join(' ')
    spy.restore()

    expect(code).toBe(2)
    expect(said).toContain('--apply requires an explicit --kubeconfig and --context')
    // It must not have read the cluster either: the point is that we do not know which cluster.
    expect(kube.calls).toEqual([])
  })

  it('refuses when only one of the two is given', () => {
    const withConfig = fakeKubectl(list(stale))
    const withContext = fakeKubectl(list(stale))
    const spy = quiet()
    const onlyConfig = main(['node', 'script', '--apply', '--kubeconfig', '/k'], { describeNearestTag: () => '1.8.2', kubectl: withConfig.kubectl })
    const onlyContext = main(['node', 'script', '--apply', '--context', 'c'], { describeNearestTag: () => '1.8.2', kubectl: withContext.kubectl })
    spy.restore()

    expect([onlyConfig, onlyContext]).toEqual([2, 2])
    // Both must refuse at the guard. Half a target is still an ambient target, and reaching the
    // apiserver at all would mean the refusal came from somewhere else by luck.
    expect([withConfig.calls, withContext.calls]).toEqual([[], []])
  })

  it('passes both flags to every kubectl it runs, ahead of the verb', () => {
    const kube = fakeKubectl(list(stale))
    const spy = quiet()
    main(['node', 'script', '--kubeconfig', '/k', '--context', 'ctx'], { describeNearestTag: noTag, kubectl: kube.kubectl })
    spy.restore()

    expect(kube.calls).toHaveLength(1)
    expect(kube.calls[0].slice(0, 5)).toEqual(['--kubeconfig', '/k', '--context', 'ctx', 'get'])
  })
})

describe('it will not stamp a version it cannot name (#485)', () => {
  it('refuses to apply from a checkout with no tag, rather than write frontend-unknown', () => {
    const kube = fakeKubectl(list(stale))
    const spy = quiet()
    const code = main(['node', 'script', '--apply', '--kubeconfig', '/k', '--context', 'ctx'], { describeNearestTag: noTag, kubectl: kube.kubectl })
    const said = spy.err.mock.calls.flat().join(' ')
    spy.restore()

    expect(code).toBe(2)
    expect(said).toContain('cannot tell which generator version this is')
    expect(said).toContain('--as-version')
    expect(kube.calls).toEqual([])
  })

  it('refuses a --server-dry-run the same way, because that run decides a stamp too', () => {
    const kube = fakeKubectl(list(stale))
    const spy = quiet()
    const code = main(['node', 'script', '--server-dry-run', '--kubeconfig', '/k', '--context', 'ctx'], { describeNearestTag: noTag, kubectl: kube.kubectl })
    spy.restore()

    expect(code).toBe(2)
    expect(kube.calls).toEqual([])
  })

  it('accepts --as-version instead of a tag', () => {
    const kube = fakeKubectl(list(stale))
    const spy = quiet()
    const code = main(['node', 'script', '--apply', '--kubeconfig', '/k', '--context', 'ctx', '--as-version', '1.8.2'], { describeNearestTag: noTag, kubectl: kube.kubectl })
    spy.restore()

    expect(code).toBe(0)
    expect(kube.patches()).toHaveLength(1)
    expect(patchBody(kube.patches()[0]).metadata.annotations[GENERATED_BY_ANNOTATION]).toBe('frontend-1.8.2')
  })

  it('prefers --as-version over the checkout tag — the flag names the generator being written', () => {
    const kube = fakeKubectl(list(stale))
    const spy = quiet()
    main(['node', 'script', '--apply', '--kubeconfig', '/k', '--context', 'ctx', '--as-version', '1.8.2'], { describeNearestTag: () => '1.6.0', kubectl: kube.kubectl })
    spy.restore()

    expect(patchBody(kube.patches()[0]).metadata.annotations[GENERATED_BY_ANNOTATION]).toBe('frontend-1.8.2')
  })

  it('never writes an unknown, undefined or null version into the stamp', () => {
    const kube = fakeKubectl(list(stale))
    const spy = quiet()
    main(['node', 'script', '--apply', '--kubeconfig', '/k', '--context', 'ctx', '--as-version', '1.8.2'], { describeNearestTag: noTag, kubectl: kube.kubectl })
    spy.restore()

    const written = JSON.stringify(patchBody(kube.patches()[0]))
    expect(written).not.toMatch(/frontend-(unknown|undefined|null)/)
  })

  it('still reports drift from an untagged checkout, because a dry run writes nothing', () => {
    const kube = fakeKubectl(list(stale))
    const spy = quiet()
    const code = main(['node', 'script', '--kubeconfig', '/k', '--context', 'ctx'], { describeNearestTag: noTag, kubectl: kube.kubectl })
    const said = spy.log.mock.calls.flat().join('\n')
    spy.restore()

    // 1 = stale and not applied. The version guard must not block the read-only half.
    expect(code).toBe(1)
    expect(said).toContain('STALE')
    expect(said).toContain('event-site-status')
    expect(kube.patches()).toEqual([])
  })
})

describe('what it decides to touch', () => {
  it('ignores RESTActions the composer did not emit', () => {
    const foreign = { ...stale, metadata: { ...stale.metadata, annotations: {}, name: 'settings-krateo-status' } }
    const kube = fakeKubectl(list(foreign))
    const spy = quiet()
    const code = main(['node', 'script', '--kubeconfig', '/k', '--context', 'ctx'], { describeNearestTag: noTag, kubectl: kube.kubectl })
    const said = spy.log.mock.calls.flat().join('\n')
    spy.restore()

    expect(code).toBe(0)
    expect(said).toContain('nothing to regenerate')
    expect(kube.patches()).toEqual([])
  })

  it('reads the namespace it was given', () => {
    const kube = fakeKubectl(list())
    const spy = quiet()
    main(['node', 'script', '--kubeconfig', '/k', '--context', 'ctx', '--namespace', 'demo-system'], { describeNearestTag: noTag, kubectl: kube.kubectl })
    spy.restore()

    expect(kube.calls[0]).toContain('demo-system')
  })

  it('defaults to krateo-system', () => {
    const kube = fakeKubectl(list())
    const spy = quiet()
    main(['node', 'script', '--kubeconfig', '/k', '--context', 'ctx'], { describeNearestTag: noTag, kubectl: kube.kubectl })
    spy.restore()

    expect(kube.calls[0]).toContain('krateo-system')
  })
})

describe('the exit codes the docstring promises', () => {
  it('2 when it could not look', () => {
    const spy = quiet()
    const code = main(['node', 'script', '--kubeconfig', '/k', '--context', 'ctx'], {
      describeNearestTag: noTag,
      kubectl: () => { throw new Error('Unable to connect to the server: dial tcp: i/o timeout\nmore noise') },
    })
    const said = spy.err.mock.calls.flat().join(' ')
    spy.restore()

    expect(code).toBe(2)
    expect(said).toContain('cannot list RESTActions in krateo-system')
    expect(said).not.toContain('more noise')
  })

  it('3 when an apply failed', () => {
    const kube = fakeKubectl(list(stale), () => { throw new Error('admission webhook denied the request') })
    const spy = quiet()
    const code = main(['node', 'script', '--apply', '--kubeconfig', '/k', '--context', 'ctx', '--as-version', '1.8.2'], { describeNearestTag: noTag, kubectl: kube.kubectl })
    spy.restore()

    expect(code).toBe(3)
  })

  it('0 when there is nothing to regenerate', () => {
    const kube = fakeKubectl(list())
    const spy = quiet()
    const code = main(['node', 'script', '--kubeconfig', '/k', '--context', 'ctx'], { describeNearestTag: noTag, kubectl: kube.kubectl })
    spy.restore()

    expect(code).toBe(0)
  })
})

describe('--server-dry-run', () => {
  it('sends the real patch with --dry-run=server and reports 0', () => {
    const kube = fakeKubectl(list(stale))
    const spy = quiet()
    const code = main(['node', 'script', '--server-dry-run', '--kubeconfig', '/k', '--context', 'ctx', '--as-version', '1.8.2'], { describeNearestTag: noTag, kubectl: kube.kubectl })
    spy.restore()

    expect(code).toBe(0)
    expect(kube.patches()).toHaveLength(1)
    expect(kube.patches()[0]).toContain('--dry-run=server')
  })

  it('patches the namespace the object reports, not the one that was listed', () => {
    const elsewhere = { ...stale, metadata: { ...stale.metadata, namespace: 'demo-system' } }
    const kube = fakeKubectl(list(elsewhere))
    const spy = quiet()
    main(['node', 'script', '--server-dry-run', '--kubeconfig', '/k', '--context', 'ctx', '--as-version', '1.8.2'], { describeNearestTag: noTag, kubectl: kube.kubectl })
    spy.restore()

    const [args] = kube.patches()
    expect(args[args.indexOf('-n') + 1]).toBe('demo-system')
  })

  it('writes the filter to a file, never through an argument', () => {
    const kube = fakeKubectl(list(stale))
    const spy = quiet()
    main(['node', 'script', '--server-dry-run', '--kubeconfig', '/k', '--context', 'ctx', '--as-version', '1.8.2'], { describeNearestTag: noTag, kubectl: kube.kubectl })
    spy.restore()

    const [args] = kube.patches()
    expect(args).toContain('--patch-file')
    expect(args.some((token) => token.includes('reduce') || token.includes('$steps'))).toBe(false)
    // and the file it wrote really is the merge patch, spec and all
    const body = patchBody(args)
    expect(body.spec).toBeTruthy()
    expect(Object.keys(body)).toEqual(['metadata', 'spec'])
  })
})
