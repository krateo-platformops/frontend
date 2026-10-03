/**
 * How a Builder plugs into the gate. A plan is chosen by the Builder's `draftKind`; it declares
 * which of the Builder's named lints it covers, takes the draft in that builder's own shape, and
 * returns its steps. Pages are served today; a blueprint or controller plan registers here with
 * its own input shape (a chart tree of {path, content}) and its own steps, and the envelope, the
 * transport and the dry-run client stay as they are.
 */
import type { BuilderSpec } from './builder'
import type { Coverage, StepResult } from './envelope'
import type { JqEngine } from './jq'
import type { SnowplowClient } from './snowplow'

export interface GateContext {
  /**
   * False ONLY in the offline CLI (`--offline`, CI's example job): the steps that need a cluster
   * report themselves DISABLED and judge nothing. The MCP server always runs live.
   */
  live: boolean
  /**
   * snowplow as the caller. Null when no caller token reached the gate, or no snowplow is
   * configured — then every step that needs the cluster says so, and is red.
   */
  snowplow: SnowplowClient | null
  /** Why `snowplow` is null, in a sentence. */
  snowplowMissing: string | null
  jq: JqEngine
  /** Epoch ms by which the whole call must have answered. */
  deadline: number
}

export interface PlanResult {
  steps: StepResult[]
  coverage: Coverage | null
}

export interface BuilderPlan {
  draftKind: string
  /** What the draft looks like, for the refusal when it is something else. */
  input: string
  /**
   * Every Builder lint name this plan knows, with how the gate covers it. A Builder declaring a
   * name not listed here is refused by name, never skipped — the same rule the portal applies.
   */
  lints: Record<string, string>
  run(files: readonly unknown[], builder: BuilderSpec, ctx: GateContext): Promise<PlanResult>
}
