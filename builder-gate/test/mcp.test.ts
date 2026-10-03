/**
 * The MCP surface, end to end over Streamable HTTP: the bundled server (dist/server.cjs) lists
 * validate_draft, answers a call with the envelope, and sees the caller's Authorization header.
 */
import { type ChildProcess, spawn } from 'node:child_process'
import { join } from 'node:path'

import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { example, ROOT } from './helpers'

const PORT = 18000 + Math.floor(Math.random() * 1000)
let server: ChildProcess
let logs = ''

beforeAll(async () => {
  const env = { ...process.env, PORT: String(PORT), GATE_BUILDERS: 'portal-builder' }
  delete env.KUBERNETES_SERVICE_HOST
  delete env.GATE_KUBECONFIG
  server = spawn(process.execPath, [join(ROOT, 'dist', 'server.cjs')], { env })
  server.stdout?.on('data', (chunk: Buffer) => { logs += chunk.toString() })
  for (let i = 0; i < 50 && !logs.includes('listening'); i += 1) {
    // eslint-disable-next-line no-await-in-loop -- waiting for the server to listen
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
})

afterAll(() => { server.kill() })

const connect = async (token?: string): Promise<Client> => {
  const client = new Client({ name: 'test', version: '0' })
  await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${PORT}/mcp`), {
    requestInit: token ? { headers: { Authorization: `Bearer ${token}` } } : undefined,
  }))
  return client
}

describe('the MCP server', () => {
  it('lists validate_draft with builder and files', async () => {
    const client = await connect()
    const { tools } = await client.listTools()
    expect(tools.map((t) => t.name)).toEqual(['validate_draft'])
    expect(Object.keys(tools[0].inputSchema.properties ?? {})).toEqual(['builder', 'files'])
    await client.close()
  })

  it('answers with the envelope; with no API server identity the Builder cannot be read and that is red', async () => {
    const client = await connect('a-caller-jwt')
    const result = await client.callTool({ name: 'validate_draft', arguments: { builder: 'portal-builder', files: example() } })
    const envelope = JSON.parse((result.content as { text: string }[])[0].text)
    expect(envelope).toMatchObject({ ok: false, failedStep: 'builder', coverage: null })
    expect(envelope.steps[0].problems[0]).toMatch(/^notChecked: the gate has no API server identity/)
    expect(logs).toContain('"caller":"present"')
    expect(logs).not.toContain('a-caller-jwt')
    await client.close()
  })

  it('refuses a Builder this instance does not serve', async () => {
    const client = await connect()
    const result = await client.callTool({ name: 'validate_draft', arguments: { builder: 'blueprint-builder', files: [] } })
    const envelope = JSON.parse((result.content as { text: string }[])[0].text)
    expect(envelope.steps[0].problems[0]).toBe('this gate validates drafts for portal-builder, not "blueprint-builder"')
    await client.close()
  })
})
