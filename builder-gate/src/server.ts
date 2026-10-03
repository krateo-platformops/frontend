/**
 * The MCP server: one tool, validate_draft, over Streamable HTTP at /mcp (port 8080), the
 * transport core-provider-agent's gate serves and kagent's RemoteMCPServer speaks.
 *
 * STATELESS: a fresh server and transport per request, so no session lives in this process and a
 * restart or a second replica never strands a client mid-session (CPA pins replicaCount 1 because
 * its sessions are stateful).
 *
 * Always LIVE. There is no switch here that turns the API server or the caller reads off; the
 * offline mode exists only in cli.ts.
 */
import { createServer, type IncomingMessage } from 'node:http'

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { z } from 'zod'

import { bearerOf } from './caller'
import { configFromEnv, liveBuilderLookup, liveContext } from './config'
import { GATE_VERSION, runGate } from './gate'

const config = configFromEnv()
const log = (fields: Record<string, unknown>): void => {
  process.stdout.write(`${JSON.stringify({ time: new Date().toISOString(), ...fields })}\n`)
}

const DESCRIPTION = [
  'Validate a builder draft before you hand it back: the portal\'s own lint, references, jq compiled by snowplow\'s engine,',
  'a live API-server dry-run of every object (dryRun=All, fieldValidation=Strict), and the draft RESTActions run as the caller, as preview runs them (a non-GET stage is executed and named in the notes).',
  'Returns {ok, failedStep, steps:[{name, ok, problems[], notes[]}], coverage}. Steps stop at the first failure: a later step\'s silence means it has not run.',
  'notChecked is a failure. Fix exactly what failedStep names and call again with the whole draft; hand back exactly the draft that returned ok:true.',
  'For a page (portal-builder), files is the ordered array of CR objects previewPage receives.',
].join(' ')

const buildServer = (headers: IncomingMessage['headers']): McpServer => {
  const server = new McpServer({ name: 'builder-gate', version: GATE_VERSION })
  server.registerTool('validate_draft', {
    description: DESCRIPTION,
    inputSchema: {
      builder: z.string().describe(`The Builder the draft is for (${config.builders.join(', ') || 'a Builder name'}).`),
      files: z.array(z.record(z.string(), z.unknown())).describe('The whole draft. For a page: the CR objects, in order, as previewPage receives them.'),
    },
  }, async ({ builder, files }) => {
    const started = Date.now()
    const envelope = await runGate(builder, files, liveContext(config, bearerOf(headers)), liveBuilderLookup(config))
    log({ msg: 'validate_draft', builder, objects: files.length, ok: envelope.ok, failedStep: envelope.failedStep, ms: Date.now() - started, caller: bearerOf(headers) ? 'present' : 'absent' })
    return { content: [{ type: 'text', text: JSON.stringify(envelope, null, 2) }], isError: false }
  })
  return server
}

const readBody = (req: IncomingMessage): Promise<unknown> => new Promise((resolve, reject) => {
  const chunks: Buffer[] = []
  let size = 0
  req.on('data', (chunk: Buffer) => {
    size += chunk.length
    if (size > 4 * 1024 * 1024) {
      reject(new Error('request body over 4 MiB'))
      req.destroy()
      return
    }
    chunks.push(chunk)
  })
  req.on('end', () => {
    try {
      resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : undefined)
    } catch (error) {
      reject(error)
    }
  })
  req.on('error', reject)
})

const http = createServer(async (req, res) => {
  const path = (req.url ?? '').split('?')[0]
  if (path === '/healthz' || path === '/readyz') {
    res.writeHead(200, { 'Content-Type': 'text/plain' }).end('ok')
    return
  }
  if (path !== '/mcp') {
    res.writeHead(404).end()
    return
  }
  if (req.method !== 'POST') {
    // Stateless: no standalone SSE stream to open, no session to delete.
    res.writeHead(405, { Allow: 'POST' }).end()
    return
  }
  try {
    const body = await readBody(req)
    const server = buildServer(req.headers)
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true })
    res.on('close', () => {
      void transport.close()
      void server.close()
    })
    await server.connect(transport)
    await transport.handleRequest(req, res, body)
  } catch (error) {
    log({ msg: 'request failed', error: (error as Error).message })
    if (!res.headersSent) {
      res.writeHead(400, { 'Content-Type': 'application/json' })
        .end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32700, message: (error as Error).message }, id: null }))
    }
  }
})

const port = Number(process.env.PORT || 8080)
http.listen(port, () => {
  log({
    msg: 'builder-gate listening',
    port,
    version: GATE_VERSION,
    builders: config.builders,
    sandbox: config.sandboxNamespace,
    identity: config.kube?.identity.source ?? 'none',
    callerReads: config.callerConfig ? 'configured' : config.callerConfigMissing,
  })
})
