/**
 * WHO CAN REACH THE TOKEN — a static check, because the property is structural.
 *
 * 1. The anonymous transport, and the context module whose DEFAULT it is, must have no runtime import
 *    path to anything that reads or uses the stored session: `utils/getAccessToken`, the session
 *    resume, the signed-in SSE client, the signed-in transport. This walks their import graphs (type-only
 *    imports are erased at build and skipped) and fails on the first such edge.
 *
 * 2. Nothing a PUBLIC PAGE can render may reach the token, except through the signed-in transport.
 *    The walk starts at what a public page mounts — PublicPage, WidgetRenderer and every widget module
 *    the registry loads (widgets/load.ts globs `widgets/<Kind>/index.ts`) — follows every runtime
 *    import, static or dynamic, and stops only at transport/signedInTransport.tsx, the one module
 *    allowed to bind the token getter (and which nothing on that graph imports). A hook that
 *    imports `utils/getAccessToken` itself, even one a public page never CALLS, fails here: the
 *    guarantee is that the getter is unreachable, not that a flag keeps it unused.
 *
 * 3. The widget tree must not read the token itself. Every widget-reachable call site gets its
 *    credential from the transport in context (transport/widgetTransport.ts); a direct
 *    `getAccessToken` import there would bypass the anonymous transport on a public page. The files
 *    that may import it are listed, each because it is mounted only inside the signed-in shell (or
 *    is the sign-in flow itself) — a new one has to be added here, deliberately.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** Runtime (non-type) relative imports of a source file, resolved to files. */
const runtimeImports = (file: string): string[] => {
  const text = readFileSync(file, 'utf8')
  const found: string[] = []
  const pattern = /^\s*(?:import|export)\s+(type\s+)?(?:[^'"]*?\sfrom\s+)?['"](\.[^'"]+)['"]/gm
  for (const match of text.matchAll(pattern)) {
    if (match[1]) { continue }
    // `import { type A, type B } from` is also type-only.
    const [clause] = match
    const braces = /\{([^}]*)\}/.exec(clause)
    if (braces && !/^\s*(?:import|export)\s+[A-Za-z_$*]/.test(clause.replace(/\{[^}]*\}/, '')) && braces[1].split(',').every((part) => part.trim() === '' || part.trim().startsWith('type '))) {
      continue
    }
    const base = resolve(dirname(file), match[2])
    const candidates = [base, `${base}.ts`, `${base}.tsx`, join(base, 'index.ts'), join(base, 'index.tsx')]
    const hit = candidates.find((candidate) => {
      try {
        return statSync(candidate).isFile()
      } catch {
        return false
      }
    })
    if (hit) { found.push(hit) }
  }
  // Dynamic `import('./x')`: a lazily loaded module is as reachable as a static one.
  for (const match of text.matchAll(/\bimport\(\s*['"](\.[^'"]+)['"]\s*\)/g)) {
    const base = resolve(dirname(file), match[1])
    const hit = [base, `${base}.ts`, `${base}.tsx`, join(base, 'index.ts'), join(base, 'index.tsx')].find((candidate) => {
      try {
        return statSync(candidate).isFile()
      } catch {
        return false
      }
    })
    if (hit) { found.push(hit) }
  }
  return found
}

/**
 * Every file reachable from `entries`, without walking INTO `boundary`, each mapped to the file
 * that first imported it — so a failure can print the whole import chain, not just the endpoint.
 */
const reachableFrom = (entries: readonly string[], boundary: ReadonlySet<string>): Map<string, string | null> => {
  const parent = new Map<string, string | null>(entries.map((entry) => [entry, null]))
  const queue = [...entries]
  while (queue.length) {
    const file = queue.shift()!
    if (boundary.has(file)) { continue }
    for (const next of runtimeImports(file)) {
      if (parent.has(next)) { continue }
      parent.set(next, file)
      queue.push(next)
    }
  }
  return parent
}

const chainTo = (parent: Map<string, string | null>, file: string): string => {
  const chain: string[] = []
  for (let at: string | null | undefined = file; at; at = parent.get(at)) { chain.unshift(relative(SRC, at)) }
  return chain.join(' -> ')
}

const reachable = (entry: string): Set<string> => {
  const seen = new Set<string>()
  const queue = [entry]
  while (queue.length) {
    const file = queue.pop()!
    if (seen.has(file)) { continue }
    seen.add(file)
    queue.push(...runtimeImports(file))
  }
  return seen
}

const FORBIDDEN = ['utils/getAccessToken.ts', 'utils/sessionResume.ts', 'hooks/signedInSseClient.ts', 'transport/signedInTransport.tsx']

describe('the anonymous transport cannot reach the stored token', () => {
  it.each(['public/anonymousTransport.ts', 'transport/widgetTransport.ts'])('%s has no runtime import path to a token reader', (entry) => {
    const graph = [...reachable(join(SRC, entry))].map((file) => relative(SRC, file))
    expect(graph).toContain(entry)
    expect(graph.filter((file) => FORBIDDEN.includes(file))).toEqual([])
  })

  it('the walker does see a real edge (control: the signed-in transport reaches getAccessToken)', () => {
    const graph = [...reachable(join(SRC, 'transport/signedInTransport.tsx'))].map((file) => relative(SRC, file))
    expect(graph).toContain('utils/getAccessToken.ts')
  })
})

/** What a public page mounts: the page, the renderer, and every widget module the registry loads. */
const publicPageEntries = (): string[] => [
  join(SRC, 'public/PublicPage.tsx'),
  join(SRC, 'components/WidgetRenderer/WidgetRenderer.tsx'),
  ...readdirSync(join(SRC, 'widgets'))
    .map((name) => join(SRC, 'widgets', name, 'index.ts'))
    .filter((file) => {
      try {
        return statSync(file).isFile()
      } catch {
        return false
      }
    }),
]

const SIGNED_IN_TRANSPORT = join(SRC, 'transport/signedInTransport.tsx')
const TOKEN_GETTER = join(SRC, 'utils/getAccessToken.ts')

describe('nothing a public page renders can reach the token, except through the signed-in transport', () => {
  it('walks a real graph: every widget module, the Table, Form, Button and Upload among them', () => {
    const entries = publicPageEntries()
    const graph = reachableFrom(entries, new Set([SIGNED_IN_TRANSPORT]))
    for (const kind of ['Table', 'Form', 'Button', 'Upload', 'List', 'Flex']) {
      expect(entries).toContain(join(SRC, 'widgets', kind, 'index.ts'))
    }
    // The hooks the widgets read and act through are on it.
    for (const hook of ['hooks/useWidgetQuery.ts', 'hooks/useHandleActions.ts', 'hooks/useSseStream.ts', 'utils/jq-expression.ts']) {
      expect([...graph.keys()].map((file) => relative(SRC, file))).toContain(hook)
    }
  })

  it('utils/getAccessToken is unreachable from it', () => {
    const graph = reachableFrom(publicPageEntries(), new Set([SIGNED_IN_TRANSPORT]))
    const leaks = [...graph.keys()]
      .filter((file) => file !== SIGNED_IN_TRANSPORT && runtimeImports(file).includes(TOKEN_GETTER))
      .map((file) => chainTo(graph, file))
    expect(leaks, 'each line is a chain from a public-page entry to a module that imports utils/getAccessToken').toEqual([])
    expect(graph.has(TOKEN_GETTER)).toBe(false)
  })

  it('control: the same walk, NOT stopped at the signed-in transport, does reach the getter through it', () => {
    const graph = reachableFrom([SIGNED_IN_TRANSPORT], new Set())
    expect(graph.has(TOKEN_GETTER)).toBe(true)
  })
})

/** Every non-test source file under src/. */
const sources = (dir: string): string[] => readdirSync(dir).flatMap((name) => {
  const path = join(dir, name)
  if (statSync(path).isDirectory()) { return sources(path) }
  return /\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name) && !name.endsWith('.d.ts') ? [path] : []
})

/**
 * The files that may import the token getter, and why. Everything here is mounted only inside the
 * signed-in shell, is the sign-in flow itself, or runs only on a session it was handed.
 */
const MAY_READ_TOKEN: Record<string, string> = {
  'builders/clusterBuilders.ts': 'reads the Builders once the shell mounts after sign-in',
  'components/Agentiko/adoptLegacyPage.ts': 'Agentiko is mounted only inside the shell',
  'components/Agentiko/builderPublishGvr.ts': 'Agentiko is mounted only inside the shell',
  'components/Agentiko/builderPublishStatus.ts': 'Agentiko is mounted only inside the shell',
  'components/Agentiko/draftResume.ts': 'Agentiko is mounted only inside the shell',
  'components/Agentiko/kindResolver.ts': 'Agentiko is mounted only inside the shell',
  'components/Agentiko/previewBridge.ts': 'Agentiko is mounted only inside the shell',
  'components/Agentiko/previewPageV2.ts': 'Agentiko is mounted only inside the shell',
  'components/Agentiko/transport.ts': 'Agentiko is mounted only inside the shell',
  'components/CommandPalette/useSearchTypeahead.ts': 'the command palette is shell header chrome',
  'components/Notifications/Notifications.tsx': 'the notifications bell is shell header chrome',
  'components/SessionResume/SessionResumeModal.tsx': 'the session resume is mounted by the shell',
  'hooks/signedInSseClient.ts': 'THE signed-in SSE client, reached only through the signed-in transport\'s session',
  'pages/Auth/Auth.tsx': 'the sign-in flow',
  'pages/BlueprintBuilder/blueprintPalette.ts': 'a Builder, a shell route',
  'pages/BlueprintBuilder/useCrdSchema.ts': 'a Builder, a shell route',
  'pages/Login/Login.tsx': 'the sign-in flow',
  'pages/PageBuilder/placeableWidgets.ts': 'a Builder, a shell route',
  'transport/signedInTransport.tsx': 'THE signed-in transport, provided only by the shell',
  'utils/getAccessToken.ts': 'the getter itself',
}

describe('the widget tree takes its credential from the transport', () => {
  it('only the listed files import the token getter', () => {
    const readers = sources(SRC)
      .filter((file) => /from\s+['"][./]*(?:\.\.\/)*(?:utils\/)?getAccessToken['"]/.test(readFileSync(file, 'utf8')) || file.endsWith('utils/getAccessToken.ts'))
      .map((file) => relative(SRC, file))
      .sort()
    expect(readers.filter((file) => !(file in MAY_READ_TOKEN))).toEqual([])
  })

  it('nothing under widgets/ or public/ reads it', () => {
    expect(Object.keys(MAY_READ_TOKEN).filter((file) => file.startsWith('widgets/') || file.startsWith('public/'))).toEqual([])
  })
})
