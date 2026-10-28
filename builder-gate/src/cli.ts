/**
 * The gate from a shell: `node dist/cli.cjs --builder portal-builder --draft draft.json [flags]`.
 * Prints the envelope; exits 0 when ok, 1 when not, 2 on a usage error.
 *
 *   --offline                 the ONLY way to turn the live steps off: references look only inside
 *                             the draft, live-dry-run and data report DISABLED. Used by CI's example
 *                             job; the MCP server has no such switch.
 *   --builders-dir <dir>      read the Builder from YAML files (offline); default: the cluster.
 *   --kubeconfig <path>       the identity to judge with (else the in-cluster ServiceAccount).
 *   --context <name>          the kubeconfig context.
 *   --sandbox <ns>            the dry-run namespace (default krateo-preview).
 *   --builders-namespace <ns> where Builder CRs live (default krateo-system).
 *   --caller-token-file <f>   a caller JWT: references, the dry-run and data go through snowplow
 *                             (SNOWPLOW_URL) as its owner. Without one those steps are red.
 */
import { readFileSync } from 'node:fs'

import { builderFromDirectory } from './builder'
import { configFromEnv, liveBuilderLookup, liveContext } from './config'
import { GATE_TIMEOUT_MS, runGate } from './gate'
import { jqcheckEngine } from './jq'

const args = process.argv.slice(2)
const flag = (name: string): string | undefined => {
  const at = args.indexOf(`--${name}`)
  return at >= 0 ? args[at + 1] : undefined
}
const has = (name: string): boolean => args.includes(`--${name}`)

const usage = (message: string): never => {
  process.stderr.write(`${message}\nusage: cli --builder <name> --draft <file.json> [--offline] [--builders-dir <dir>] [--kubeconfig <path> --context <ctx>] [--sandbox <ns>]\n`)
  process.exit(2)
}

const main = async (): Promise<void> => {
  const builder = flag('builder') ?? usage('--builder is required')
  const draftPath = flag('draft') ?? usage('--draft is required')
  const files = JSON.parse(readFileSync(draftPath, 'utf8')) as unknown
  if (!Array.isArray(files)) {
    usage(`${draftPath}: the draft must be a JSON array`)
  }
  const offline = has('offline')
  const buildersDir = flag('builders-dir')

  const env = { ...process.env }
  if (flag('kubeconfig')) {
    env.GATE_KUBECONFIG = flag('kubeconfig')
    env.GATE_KUBE_CONTEXT = flag('context') ?? ''
  }
  if (flag('sandbox')) {
    env.SANDBOX_NAMESPACE = flag('sandbox')
  }
  if (flag('builders-namespace')) {
    env.BUILDERS_NAMESPACE = flag('builders-namespace')
  }
  const lookup = buildersDir
    ? async (name: string) => builderFromDirectory(buildersDir, name)
    : undefined

  let envelope
  if (offline) {
    if (!lookup) {
      usage('--offline needs --builders-dir (an offline run cannot read the cluster)')
    }
    envelope = await runGate(builder, files as unknown[], {
      live: false,
      snowplow: null,
      snowplowMissing: 'offline run',
      jq: jqcheckEngine(),
      deadline: Date.now() + GATE_TIMEOUT_MS,
    }, lookup!)
  } else {
    const config = configFromEnv(env)
    const tokenFile = flag('caller-token-file')
    const token = tokenFile ? readFileSync(tokenFile, 'utf8').trim() : null
    envelope = await runGate(builder, files as unknown[], liveContext(config, token), lookup ?? liveBuilderLookup(config))
  }
  process.stdout.write(`${JSON.stringify(envelope, null, 2)}\n`)
  process.exit(envelope.ok ? 0 : 1)
}

main().catch((error: unknown) => {
  process.stderr.write(`${(error as Error).stack ?? String(error)}\n`)
  process.exit(2)
})
