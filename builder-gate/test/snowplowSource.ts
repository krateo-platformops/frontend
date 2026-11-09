/**
 * Reads snowplow's closed set of stage reason codes out of its Go source, for the drift check in
 * test/drift/. Split from the fetch so the parsing is tested offline (snowplowSource.test.ts).
 *
 * The set is every `StageReason*` constant in stage_outcomes.go. One of them is assigned from
 * another package (`StageReasonDestinationRefused = credhttp.DestinationRefusedReason`), so a
 * qualified identifier is RESOLVED through the file's imports, never skipped. Any declaration this
 * reader does not understand throws: a check that drops what it cannot parse would pass by reading
 * less.
 */
import yaml from 'js-yaml'

/** Snowplow's Go module, and where it sits in the snowplow repo. */
export const SNOWPLOW_MODULE = 'github.com/krateo-platformops/snowplow'
export const SNOWPLOW_MODULE_DIR = 'go/snowplow'
export const STAGE_OUTCOMES_GO = `${SNOWPLOW_MODULE_DIR}/internal/resolvers/restactions/api/stage_outcomes.go`

const STAGE_REASON = /^StageReason[A-Z]\w*$/

/** A snowplow tree at one ref: paths are repo-relative. */
export interface GoTree {
  read(path: string): Promise<string>
  /** The file names (not paths) directly in `dir`. */
  list(dir: string): Promise<string[]>
}

/**
 * The version of the `snowplow` entry in installer's component-pins.yaml. Exactly `snowplow`:
 * `snowplow-crd` and `snowplow-agent` are other entries.
 */
export const snowplowPin = (pinsYaml: string): string => {
  const pins = yaml.load(pinsYaml) as { components?: { name?: unknown; version?: unknown }[] } | null
  const components = Array.isArray(pins?.components) ? pins.components : []
  const entries = components.filter((entry) => entry.name === 'snowplow')
  if (entries.length !== 1) {
    throw new Error(`expected one .components[] entry named snowplow in installer's pins, found ${entries.length} (of ${components.length} entries)`)
  }
  const [{ version }] = entries
  if (typeof version !== 'string' || !/^\d+\.\d+\.\d+$/.test(version)) {
    throw new Error(`the snowplow pin carries no x.y.z version: ${JSON.stringify(version)}`)
  }
  return version
}

/** Go source with every comment removed; string, raw-string and rune literals kept intact. */
export const withoutComments = (src: string): string => {
  let out = ''
  let i = 0
  while (i < src.length) {
    const char = src[i]
    if (char === '/' && src[i + 1] === '/') {
      while (i < src.length && src[i] !== '\n') {
        i += 1
      }
    } else if (char === '/' && src[i + 1] === '*') {
      const end = src.indexOf('*/', i + 2)
      if (end < 0) {
        throw new Error('an unterminated /* comment')
      }
      // Keep the newlines, so a line count stays meaningful in an error.
      out += src.slice(i, end + 2).replace(/[^\n]/g, '')
      i = end + 2
    } else if (char === '"' || char === '\'' || char === '`') {
      let j = i + 1
      while (j < src.length && src[j] !== char) {
        j += char !== '`' && src[j] === '\\' ? 2 : 1
      }
      out += src.slice(i, j + 1)
      i = j + 1
    } else {
      out += char
      i += 1
    }
  }
  return out
}

type ConstRhs = { rhs: string } | { unsupported: string }

/** Every constant a Go file declares, by name: its right-hand side, or the line it could not read. */
export const constsOf = (src: string): Map<string, ConstRhs> => {
  const code = withoutComments(src)
  const out = new Map<string, ConstRhs>()
  const one = (line: string) => {
    const text = line.trim()
    if (!text) {
      return
    }
    // `Name = rhs` or `Name Type = rhs`. Anything else — `A, B = …`, an iota continuation, a bare
    // name — is recorded as unsupported under every name it starts with.
    const match = /^([A-Za-z_]\w*)(?:\s+[A-Za-z_][\w.]*)?\s*=\s*(.+)$/.exec(text)
    if (match && !match[1].includes(',') && !/^[A-Za-z_]\w*\s*,/.test(text)) {
      out.set(match[1], { rhs: match[2].trim() })
      return
    }
    for (const name of text.split(/[\s,=]+/).filter((word) => /^[A-Za-z_]\w*$/.test(word))) {
      out.set(name, { unsupported: text })
    }
  }
  for (const block of code.matchAll(/^const\s*\(([\s\S]*?)^\)/gm)) {
    block[1].split('\n').forEach(one)
  }
  for (const single of code.matchAll(/^const\s+([^(\s][^\n]*)$/gm)) {
    one(single[1])
  }
  return out
}

/** A Go file's imports: package name (the alias, or the path's last element) → import path. */
export const importsOf = (src: string): Map<string, string> => {
  const code = withoutComments(src)
  const specs: string[] = []
  for (const block of code.matchAll(/^import\s*\(([\s\S]*?)^\)/gm)) {
    specs.push(...block[1].split('\n'))
  }
  for (const single of code.matchAll(/^import\s+([^(\s][^\n]*)$/gm)) {
    specs.push(single[1])
  }
  const out = new Map<string, string>()
  for (const spec of specs.map((line) => line.trim()).filter(Boolean)) {
    const match = /^(?:([A-Za-z_]\w*|\.)\s+)?"([^"]+)"$/.exec(spec)
    if (!match) {
      throw new Error(`an import this reader does not understand: ${spec}`)
    }
    const [, alias, path] = match
    out.set(alias ?? path.slice(path.lastIndexOf('/') + 1), path)
  }
  return out
}

/** The value of a Go string literal: interpreted ("…") or raw (`…`). */
const stringLiteral = (rhs: string): string | null => {
  if (/^"(?:[^"\\]|\\.)*"$/.test(rhs)) {
    return JSON.parse(rhs) as string
  }
  const raw = /^`([^`]*)`$/.exec(rhs)
  return raw ? raw[1] : null
}

const dirOf = (path: string): string => path.slice(0, path.lastIndexOf('/'))

/**
 * Resolves Go string constants across snowplow's packages. A package's constants are loaded from
 * every non-test .go file in its directory, the first time one of them is needed.
 */
class Resolver {
  private readonly packages = new Map<string, Promise<{ consts: Map<string, ConstRhs>; imports: Map<string, Map<string, string>>; fileOf: Map<string, string> }>>()

  constructor(private readonly tree: GoTree) {}

  private loadPackage(dir: string) {
    let loaded = this.packages.get(dir)
    if (!loaded) {
      loaded = (async () => {
        const files = (await this.tree.list(dir)).filter((name) => name.endsWith('.go') && !name.endsWith('_test.go'))
        if (files.length === 0) {
          throw new Error(`${dir} holds no Go source`)
        }
        const consts = new Map<string, ConstRhs>()
        const imports = new Map<string, Map<string, string>>()
        const fileOf = new Map<string, string>()
        for (const name of files) {
          const path = `${dir}/${name}`
          // eslint-disable-next-line no-await-in-loop -- a handful of files, read once
          const src = await this.tree.read(path)
          imports.set(path, importsOf(src))
          for (const [constName, rhs] of constsOf(src)) {
            consts.set(constName, rhs)
            fileOf.set(constName, path)
          }
        }
        return { consts, fileOf, imports }
      })()
      this.packages.set(dir, loaded)
    }
    return loaded
  }

  /** The string value of `rhs`, written in `file` (whose imports and package it is read against). */
  async value(rhs: string, file: string, fileImports: Map<string, string>, seen: string[] = []): Promise<string> {
    const literal = stringLiteral(rhs)
    if (literal !== null) {
      return literal
    }
    if (seen.length > 8) {
      throw new Error(`a constant chain too deep to resolve: ${seen.join(' → ')}`)
    }
    const qualified = /^([A-Za-z_]\w*)\.([A-Za-z_]\w*)$/.exec(rhs)
    if (qualified) {
      const [, pkg, name] = qualified
      const path = fileImports.get(pkg)
      if (!path) {
        throw new Error(`${file}: ${rhs} names package ${pkg}, which the file does not import`)
      }
      if (path !== SNOWPLOW_MODULE && !path.startsWith(`${SNOWPLOW_MODULE}/`)) {
        throw new Error(`${file}: ${rhs} comes from ${path}, outside snowplow's module — this reader resolves only snowplow's own packages`)
      }
      return this.inPackage(`${SNOWPLOW_MODULE_DIR}${path.slice(SNOWPLOW_MODULE.length)}`, name, [...seen, rhs])
    }
    if (/^[A-Za-z_]\w*$/.test(rhs)) {
      return this.inPackage(dirOf(file), rhs, [...seen, rhs])
    }
    throw new Error(`${file}: a constant value this reader does not understand: ${rhs}`)
  }

  private async inPackage(dir: string, name: string, seen: string[]): Promise<string> {
    const pkg = await this.loadPackage(dir)
    const decl = pkg.consts.get(name)
    if (!decl) {
      throw new Error(`no constant ${name} in ${dir}`)
    }
    if ('unsupported' in decl) {
      throw new Error(`${pkg.fileOf.get(name)}: the declaration of ${name} is not \`Name = value\`: ${decl.unsupported}`)
    }
    const file = pkg.fileOf.get(name)!
    return this.value(decl.rhs, file, pkg.imports.get(file)!, seen)
  }
}

/** Snowplow's stage reason codes at one tree: `StageReason*` constant name → string value. */
export const stageReasonsAt = async (tree: GoTree): Promise<Map<string, string>> => {
  const src = await tree.read(STAGE_OUTCOMES_GO)
  const consts = constsOf(src)
  const imports = importsOf(src)
  const resolver = new Resolver(tree)
  const out = new Map<string, string>()
  for (const [name, decl] of consts) {
    if (!STAGE_REASON.test(name)) {
      continue
    }
    if ('unsupported' in decl) {
      throw new Error(`${STAGE_OUTCOMES_GO}: the declaration of ${name} is not \`Name = value\`: ${decl.unsupported}`)
    }
    // eslint-disable-next-line no-await-in-loop -- a dozen constants, resolved in order
    out.set(name, await resolver.value(decl.rhs, STAGE_OUTCOMES_GO, imports))
  }
  if (out.size === 0) {
    throw new Error(`${STAGE_OUTCOMES_GO} declares no StageReason* constant — the file moved or changed shape`)
  }
  // Every StageReason* the file USES must be one it declares. One defined in another file of the
  // package would be part of the closed set and missed here, so it fails instead of passing short.
  const used = new Set([...withoutComments(src).matchAll(/\bStageReason[A-Z]\w*\b/g)].map((match) => match[0]))
  const undeclared = [...used].filter((name) => !out.has(name))
  if (undeclared.length > 0) {
    throw new Error(`${STAGE_OUTCOMES_GO} uses ${undeclared.join(', ')} but does not declare it — the closed set is no longer one file`)
  }
  return out
}

export interface ReasonDiff {
  /** In snowplow's set, missing from builder-gate's. */
  onlyInSnowplow: string[]
  /** In builder-gate's set, not a code snowplow emits. */
  onlyInGate: string[]
}

export const reasonDiff = (snowplow: Iterable<string>, gate: Iterable<string>): ReasonDiff => {
  const sp = new Set(snowplow)
  const gt = new Set(gate)
  return {
    onlyInGate: [...gt].filter((code) => !sp.has(code)).sort(),
    onlyInSnowplow: [...sp].filter((code) => !gt.has(code)).sort(),
  }
}

export const driftMessage = (diff: ReasonDiff, ref: string, source: string): string => [
  `builder-gate's STAGE_REASONS (src/snowplow.ts) differs from snowplow ${ref}'s StageReason* constants (${STAGE_OUTCOMES_GO}; ${source}).`,
  `  in snowplow ${ref}, missing from builder-gate: ${diff.onlyInSnowplow.join(', ') || '(none)'}`,
  `  in builder-gate, not in snowplow ${ref}: ${diff.onlyInGate.join(', ') || '(none)'}`,
  'Add each missing code to STAGE_REASONS and decide in src/pages/data.ts what it means (a note, a draft defect, or not judged); drop a code snowplow no longer has.',
].join('\n')

/** snowplow's tree at `ref` on GitHub. Listing uses the contents API, with a token when one is set. */
export const githubTree = (ref: string, timeoutMs = 20_000): GoTree => {
  const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN
  const get = async (url: string, headers: Record<string, string> = {}): Promise<string> => {
    const reply = await fetch(url, { headers, signal: AbortSignal.timeout(timeoutMs) })
    if (!reply.ok) {
      throw new Error(`GET ${url} answered ${reply.status} ${reply.statusText}`)
    }
    return reply.text()
  }
  return {
    async list(dir) {
      const body = await get(`https://api.github.com/repos/krateo-platformops/snowplow/contents/${dir}?ref=${encodeURIComponent(ref)}`, {
        Accept: 'application/vnd.github+json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      })
      const entries = JSON.parse(body) as { name: string; type: string }[]
      return entries.filter((entry) => entry.type === 'file').map((entry) => entry.name)
    },
    read: (path) => get(`https://raw.githubusercontent.com/krateo-platformops/snowplow/${ref}/${path}`),
  }
}

export const INSTALLER_PINS_URL = 'https://raw.githubusercontent.com/krateo-platformops/installer/main/chart/files/component-pins.yaml'
