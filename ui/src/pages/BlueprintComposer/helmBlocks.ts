/**
 * Reading a Helm template's block structure without rendering it — shared by the extractor (the
 * migration direction, gateExtract) and the gate generator (the authoring direction, gateGen). Pure.
 *
 * SCANNING, NOT PARSING. A Helm template is not YAML until it is rendered, so this walks lines and
 * tracks `if`/`range`/`with` … `end` nesting. Comments go first: a Helm block comment may span lines
 * and talk about ifs and ends in prose.
 *
 * WHERE THE MANIFEST IS (`manifestSpan`). A gate has to wrap the part of a template that renders the
 * object, and nothing else: the head before it (comments, `$vars`, the `range` a forEach template
 * opens) stays outside, so the gate sits INSIDE an enclosing `range` — each item is gated on its own
 * pass, with the item's `$i` and `$f` in scope — and the `{{- end }}` that closes that range stays
 * after the gate. A span whose head leaves blocks open ends at the `end` that closes them.
 */

export interface Block {
  keyword: 'if' | 'range' | 'with'
  cond: string
  line: number
}

/**
 * Helm block comments (double-brace slash-star … star-slash double-brace) removed, each replaced by
 * the newlines it spanned, so every line keeps its number.
 */
export const stripComments = (text: string): string =>
  text.replace(/\{\{-?\s*\/\*[\s\S]*?\*\/\s*-?\}\}/g, (comment) => '\n'.repeat((comment.match(/\n/g) ?? []).length))

/** One Helm action, its body in group 1. */
export const ACTION = /\{\{-?\s*([\s\S]*?)\s*-?\}\}/g

/** Walk the file once, keeping the stack of open blocks at every line (the stack BEFORE that line). */
export const scanBlocks = (lines: string[]): Block[][] => {
  const stack: Block[] = []
  const open: Block[][] = []
  lines.forEach((line, idx) => {
    open.push([...stack])
    for (const action of line.matchAll(ACTION)) {
      const body = action[1].trim()
      const opener = /^(if|range|with)\b\s*([\s\S]*)$/.exec(body)
      if (opener) {
        stack.push({ cond: opener[2].trim(), keyword: opener[1] as Block['keyword'], line: idx + 1 })
      } else if (/^end\b/.test(body)) {
        stack.pop()
      }
    }
  })
  return open
}

/** How many blocks one line opens (+) or closes (−), in order — for finding the `end` that closes a head. */
const depthSteps = (line: string): number[] => {
  const steps: number[] = []
  for (const action of line.matchAll(ACTION)) {
    const body = action[1].trim()
    if (/^(if|range|with)\b/.test(body)) {
      steps.push(1)
    } else if (/^end\b/.test(body)) {
      steps.push(-1)
    }
  }
  return steps
}

export type ManifestSpan = { ok: true; head: string; body: string; tail: string } | { ok: false; reason: string }

/**
 * The template split into the head before its first document (`---` or `apiVersion:` at the start
 * of a line), the body that renders the object, and the tail after it. `head + body + tail` is the
 * template, byte for byte. When the head leaves blocks open, the body ends at the line whose `end`
 * closes the innermost of them, and that line starts the tail; otherwise the body runs to the end.
 * The body always ends with a newline when the template does.
 */
export const manifestSpan = (template: string): ManifestSpan => {
  const raw = template.split('\n')
  const lines = stripComments(template).split('\n')
  const first = lines.findIndex((line) => /^(---|apiVersion:)/.test(line))
  if (first < 0) {
    return { ok: false, reason: 'no manifest found in the template' }
  }
  const openAtBody = scanBlocks(lines)[first].length
  const join = (from: number, to: number): string => raw.slice(from, to).map((line) => `${line}\n`).join('')
  const head = join(0, first)
  if (!openAtBody) {
    return { body: template.slice(head.length), head, ok: true, tail: '' }
  }
  let depth = 0
  for (let idx = first; idx < lines.length; idx += 1) {
    for (const step of depthSteps(lines[idx])) {
      depth += step
      if (depth < 0) {
        return { body: join(first, idx), head, ok: true, tail: template.slice(head.length + join(first, idx).length) }
      }
    }
  }
  return { ok: false, reason: 'the blocks the template opens before its manifest never close' }
}
