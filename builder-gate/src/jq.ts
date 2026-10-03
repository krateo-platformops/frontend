/**
 * snowplow's jq engine, out of process: the `jqcheck` binary (jqcheck/main.go) is built against
 * the same gojq fork snowplow's go.mod replaces gojq with, and embeds snowplow's built-in modules
 * at the tag in SNOWPLOW_REF. Node never parses jq itself — a second parser would be a second
 * opinion on what compiles.
 */
import { spawn } from 'node:child_process'

export interface JqExpr {
  id: string
  query: string
}

export interface JqCompileResult {
  id: string
  ok: boolean
  error?: string
}

export type JqEvalResult = { ok: true; value: unknown } | { ok: false; error: string }

export interface JqEngine {
  compile(exprs: JqExpr[]): Promise<JqCompileResult[]>
  eval(query: string, data: unknown): Promise<JqEvalResult>
}

const run = (bin: string, input: string, timeoutMs: number): Promise<string> => new Promise((resolve, reject) => {
  const child = spawn(bin, [], { stdio: ['pipe', 'pipe', 'pipe'] })
  const out: Buffer[] = []
  const err: Buffer[] = []
  const timer = setTimeout(() => {
    child.kill('SIGKILL')
    reject(new Error(`jqcheck did not answer within ${timeoutMs} ms`))
  }, timeoutMs)
  child.stdout.on('data', (chunk: Buffer) => out.push(chunk))
  child.stderr.on('data', (chunk: Buffer) => err.push(chunk))
  child.on('error', (error) => {
    clearTimeout(timer)
    reject(new Error(`jqcheck could not start (${bin}): ${error.message}`))
  })
  child.on('close', (code) => {
    clearTimeout(timer)
    if (code !== 0) {
      reject(new Error(`jqcheck exited ${code}: ${Buffer.concat(err).toString('utf8').slice(0, 300)}`))
      return
    }
    resolve(Buffer.concat(out).toString('utf8'))
  })
  child.stdin.end(input)
})

export const jqcheckEngine = (bin: string = process.env.JQCHECK_BIN || 'jqcheck', timeoutMs = 30_000): JqEngine => ({
  async compile(exprs) {
    if (exprs.length === 0) {
      return []
    }
    const out = JSON.parse(await run(bin, JSON.stringify({ mode: 'compile', exprs }), timeoutMs)) as { results: JqCompileResult[] }
    return out.results
  },
  async eval(query, data) {
    return JSON.parse(await run(bin, JSON.stringify({ mode: 'eval', query, data }), timeoutMs)) as JqEvalResult
  },
})
