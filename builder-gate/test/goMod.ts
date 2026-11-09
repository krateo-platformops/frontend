/**
 * The `replace` directives of a go.mod, for the drift check that holds jqcheck's gojq fork equal to
 * snowplow's (test/drift/gojqFork.test.ts). Split from the fetch so it is tested offline
 * (goMod.test.ts). Both forms are read — `replace a => b v` and a `replace ( … )` block — and a
 * directive this reader does not understand throws rather than being dropped.
 */

export interface Replace {
  /** The module replaced, and the version it is limited to ('' = every version). */
  from: string
  fromVersion: string
  /** The replacement: a module path and version, or a local directory (version ''). */
  to: string
  toVersion: string
}

const withoutComment = (line: string): string => {
  const at = line.indexOf('//')
  return (at < 0 ? line : line.slice(0, at)).trim()
}

const parseReplace = (spec: string): Replace => {
  const match = /^(\S+)(?:\s+(\S+))?\s+=>\s+(\S+)(?:\s+(\S+))?$/.exec(spec)
  if (!match) {
    throw new Error(`a replace directive this reader does not understand: ${spec}`)
  }
  return { from: match[1], fromVersion: match[2] ?? '', to: match[3], toVersion: match[4] ?? '' }
}

export const replacesOf = (goMod: string): Replace[] => {
  const out: Replace[] = []
  let inBlock = false
  for (const raw of goMod.split('\n')) {
    const line = withoutComment(raw)
    if (inBlock) {
      if (line === ')') {
        inBlock = false
      } else if (line) {
        out.push(parseReplace(line))
      }
      continue
    }
    if (/^replace\s*\($/.test(line)) {
      inBlock = true
    } else if (/^replace\s/.test(line)) {
      out.push(parseReplace(line.replace(/^replace\s+/, '')))
    }
  }
  if (inBlock) {
    throw new Error('an unterminated replace ( block')
  }
  return out
}

/** The one replace of `module`; throws when there is none or more than one. */
export const replaceOf = (goMod: string, module: string, where: string): Replace => {
  const found = replacesOf(goMod).filter((replace) => replace.from === module)
  if (found.length !== 1) {
    throw new Error(`${where}: expected one replace of ${module}, found ${found.length}`)
  }
  return found[0]
}

export const describeReplace = (replace: Replace): string =>
  `${replace.from}${replace.fromVersion ? ` ${replace.fromVersion}` : ''} => ${replace.to}${replace.toVersion ? ` ${replace.toVersion}` : ''}`
