/**
 * BlastRadiusConfirm — the structured decision surface rendered INSIDE the HITL confirm
 * modal (as modal.confirm's `content`) for every mutating write (W0-2). It replaces the
 * bare "Are you sure?" prompt with: the VERB, the target GVR, the target CLUSTER + NAMESPACE,
 * the object COUNT (1 scalar / N for a W0-4 write-set), and the DIFF (create body / before↔after
 * update / delete identity). The BlastRadius is built upstream by buildBlastRadius (pure), so
 * this component is presentation-only — it takes the already-computed radius and shows it.
 *
 * The modal's Confirm/Cancel buttons are owned by modal.confirm (in useHandleActions); this is
 * only the body. It is deliberately plain markup so it can be rendered in a jsdom RTL test
 * without the antd App context the confirm modal itself needs.
 *
 * NOTE (antd Typography className collapse, see MEMORY): Typography keeps only the FIRST
 * className token, so every styled line here is a plain element with a single class — never a
 * multi-class Typography.
 */

import { dump } from 'js-yaml'
import SyntaxHighlighter from 'react-syntax-highlighter'
import atomOneDark from 'react-syntax-highlighter/dist/esm/styles/hljs/atom-one-dark.js'
import lightfair from 'react-syntax-highlighter/dist/esm/styles/hljs/lightfair.js'

import { useThemeMode } from '../../context/ThemeModeContext'
import type { BlastRadius, BlastRadiusDiff, BlastRadiusSet, BlastRadiusSetOp, Gvr } from '../../hooks/blastRadius.types'

import styles from './BlastRadiusConfirm.module.css'

/** Human phrasing per verb — the plain-language intent shown next to the raw verb tag. */
const VERB_INTENT: Record<BlastRadius['verb'], string> = {
  DELETE: 'delete',
  PATCH: 'update',
  POST: 'create',
  PUT: 'replace',
}

/** Render a GVR as the familiar `resource.group/version` (core group → `resource/version`). */
const formatGvr = (gvr: Gvr): string => {
  const head = gvr.group ? `${gvr.resource}.${gvr.group}` : gvr.resource || '—'
  return gvr.version ? `${head}/${gvr.version}` : head
}

/** Stable YAML for the confirm bodies — the human confirms Kubernetes OBJECTS, so render
 * them the way Kubernetes writes them. Non-throwing on cyclic/odd values. */
const toYaml = (value: unknown): string => {
  if (value === undefined) {
    return ''
  }
  try {
    return dump(value, { lineWidth: 120, noRefs: true })
  } catch {
    // A value the dumper can't serialise (cyclic ref, BigInt, …) has no meaningful text form.
    return '[unserialisable value]'
  }
}

/** Syntax-highlighted, scroll-bounded YAML of ONE full body (same highlighter family as the
 * preview drawer — one look for "here is the object" everywhere). */
const YamlBlock = ({ value }: { value: unknown }) => {
  const { mode } = useThemeMode()
  const style = (mode === 'dark' ? atomOneDark : lightfair) as { [key: string]: React.CSSProperties }
  return (
    <div className={styles.yamlBlock}>
      <SyntaxHighlighter language='yaml' style={style} wrapLines wrapLongLines>{toYaml(value)}</SyntaxHighlighter>
    </div>
  )
}

/** One labelled mono code block (a diff side); omitted by the caller when its value is absent. */
const DiffBlock = ({ label, tone, value }: { label: string; tone: 'before' | 'after'; value: unknown }) => (
  <div className={styles.diffSide}>
    <div className={tone === 'before' ? styles.diffLabelBefore : styles.diffLabelAfter}>{label}</div>
    <YamlBlock value={value} />
  </div>
)

/** The verb-specific diff surface: create body, before↔after update, or delete identity. */
const DiffView = ({ diff }: { diff: BlastRadiusDiff }) => {
  if (diff.kind === 'create') {
    return <DiffBlock label='Will create' tone='after' value={diff.after} />
  }
  if (diff.kind === 'delete') {
    return <DiffBlock label='Will delete' tone='before' value={diff.before} />
  }
  // update: show both sides when a current object is known, else just the change body.
  return (
    <div className={styles.diffPair}>
      {diff.before !== undefined && <DiffBlock label='Current' tone='before' value={diff.before} />}
      <DiffBlock label='After' tone='after' value={diff.after} />
    </div>
  )
}

/** A plain-language line for what a git-write op ACTUALLY does — the "N writes" a publish makes are
 *  file commits / a branch / a PR, not opaque JSON. Returns null for other kinds (raw preview shown). */
const humanizeOp = (op: BlastRadiusSetOp): string | null => {
  const rec = (value: unknown): Record<string, unknown> | undefined =>
    (value && typeof value === 'object' ? value as Record<string, unknown> : undefined)
  const payload = rec(op.payloadPreview)
  const spec = rec(payload?.spec) ?? payload
  const str = (value: unknown): string | undefined => (typeof value === 'string' && value ? value : undefined)
  switch (op.gvr.resource) {
    case 'compositiondefinitions':
      return op.name ? `Register blueprint “${op.name}”` : 'Register a blueprint'
    case 'gitrefs': {
      const ref = str(spec?.ref)
      return ref ? `Create branch ${ref.replace(/^refs\/heads\//, '')}` : 'Create a branch'
    }
    case 'pullrequests': {
      const title = str(spec?.title)
      return title ? `Open change request — “${title}”` : 'Open a change request'
    }
    case 'repocontents': {
      const path = str(spec?.path)
      return path ? `Create file ${path}` : 'Commit a file'
    }
    case 'builderpublishes': {
      // The SCM-agnostic claim (composition.krateo.io): ONE op that IS the whole change request —
      // the composition pushes the held files to `branch` and the human opens a change request.
      const branch = str(spec?.branch)
      const target = rec(spec?.target)
      const repo = [str(target?.namespace), str(target?.repo)].filter(Boolean).join('/')
      const files = Array.isArray(spec?.files) ? spec.files.length : 0
      const where = repo ? ` to ${repo}` : ''
      const onBranch = branch ? ` on ${branch}` : ''
      const count = files ? ` (${files} file${files === 1 ? '' : 's'})` : ''
      return `Open a change request${where}${onBranch}${count}`
    }
    default:
      return null
  }
}

/** Meta line for the SCM-agnostic claim card — file count → branch, read from the claim payload. */
const claimPublishMeta = (op: BlastRadiusSetOp): string => {
  const payload = (op.payloadPreview && typeof op.payloadPreview === 'object' ? op.payloadPreview as Record<string, unknown> : undefined)
  const spec = (payload?.spec && typeof payload.spec === 'object' ? payload.spec as Record<string, unknown> : undefined)
  const files = Array.isArray(spec?.files) ? spec.files.length : 0
  const branch = typeof spec?.branch === 'string' ? spec.branch : ''
  return [files ? `${files} file${files === 1 ? '' : 's'}` : '', branch ? `→ ${branch}` : ''].filter(Boolean).join(' ')
}

/** True when the radius is the aggregated W0-4 set shape (vs a scalar write). */
const isSetRadius = (radius: BlastRadius | BlastRadiusSet): radius is BlastRadiusSet => 'ops' in radius

/** The github.krateo.io write kinds whose SET is really "open a change request": repocontents = a file
 *  commit, gitrefs = a branch, pullrequests = the request itself. When EVERY op is one of these, we present
 *  the set AS a change request (plain-language lines), not a raw "apply N objects" transaction. */
const GIT_PUBLISH_KINDS = new Set(['gitrefs', 'repocontents', 'pullrequests'])

/**
 * The W0-4 SET decision surface. A PUBLISH set — EITHER the legacy github.krateo.io write set
 * (gitrefs/repocontents/pullrequests) OR the SCM-agnostic single `builderpublishes` claim (the
 * default path) — reads as a CHANGE REQUEST: a plain "Open a change request" summary
 * (branch/files counts) + one plain-language line per op ("Create file …", "Open a change
 * request …"), with the raw GVR dropped — the human decides on WHAT it does, not on kubernetes
 * resource strings. Copy is host-neutral ("change request") because a publish may land as a
 * GitHub PR, a GitLab MR, etc.
 * Any other set keeps the generic verb-chip + GVR + namespace op list. One confirm for the whole
 * ordered set (stops at the first failure).
 */
const SetView = ({ radius }: { radius: BlastRadiusSet }) => {
  const irreversibleCount = radius.ops.filter((op) => op.irreversible).length
  const isGitPublish = radius.ops.length > 0 && radius.ops.every((op) => GIT_PUBLISH_KINDS.has(op.gvr.resource))
  // The SCM-agnostic path: ONE builderpublishes claim POST (composition.krateo.io) that the
  // composition renders into git-provider LocalResources. It gets the SAME "change request" card as
  // the legacy github set — the human decides on the change request, not on a raw `builderpublishes` GVR.
  const claimOp = radius.ops.length === 1 && radius.ops[0].gvr.resource === 'builderpublishes' ? radius.ops[0] : null
  const isPublish = isGitPublish || claimOp !== null
  const branches = radius.ops.filter((op) => op.gvr.resource === 'gitrefs').length
  const files = radius.ops.filter((op) => op.gvr.resource === 'repocontents').length
  const prs = radius.ops.filter((op) => op.gvr.resource === 'pullrequests').length
  const publishMeta = claimOp ? claimPublishMeta(claimOp) : [
    branches ? `${branches} branch` : '',
    files ? `${files} file${files === 1 ? '' : 's'}` : '',
    prs ? `${prs} change request` : '',
  ].filter(Boolean).join(' · ')

  return (
    <div className={styles.root} data-testid='blast-radius-confirm'>
      {isPublish ? (
        <div className={styles.gitCard}>
          <div className={styles.gitHeadline}>Open a change request</div>
          <div className={styles.gitMeta}>{publishMeta}{publishMeta ? ' · ' : ''}nothing merges without your review</div>
        </div>
      ) : (
        <>
          <div className={styles.headline}>
            <span className={styles.verb} data-verb='SET'>SET</span>
            <span className={styles.intent}>apply {radius.count} objects, in order</span>
          </div>
          <dl className={styles.facts}>
            <div className={styles.factRow}>
              <dt className={styles.factKey}>Objects</dt>
              <dd className={styles.factVal} data-testid='blast-radius-count'>{radius.count}</dd>
            </div>
            <div className={styles.factRow}>
              <dt className={styles.factKey}>Order</dt>
              <dd className={styles.factVal}>sequential — stops at the first failure</dd>
            </div>
            {irreversibleCount > 0 && (
              <div className={styles.factRow}>
                <dt className={styles.factKey}>Irreversible</dt>
                <dd className={styles.factVal}>{irreversibleCount} delete{irreversibleCount === 1 ? '' : 's'}</dd>
              </div>
            )}
          </dl>
        </>
      )}

      <ol className={styles.opList}>
        {radius.ops.map((op, index) => {
          // The index IS the op identity (dispatch order) — a set radius is immutable once built.
          const human = humanizeOp(op)
          // Humanized (git-write) ops read as a PLAIN-LANGUAGE line — the raw GVR is dropped (it's noise
          // for the human decision, and the full CR is in the preview drawer's Files tab). Non-humanized
          // ops keep the technical one-liner + body preview so nothing is ever hidden.
          return human ? (
            <li className={styles.opRow} data-testid='blast-radius-set-op' key={index}>
              <div className={styles.opHumanRow} data-testid='blast-radius-op-human'>
                <span className={styles.opIndex}>{index + 1}</span>
                <span className={styles.opHumanText}>{human}</span>
                {op.irreversible && <span className={styles.irreversible}>irreversible</span>}
              </div>
            </li>
          ) : (
            <li className={styles.opRow} data-testid='blast-radius-set-op' key={index}>
              <div className={styles.opHead}>
                <span className={styles.opIndex}>{index + 1}</span>
                <span className={styles.verb} data-verb={op.verb}>{op.verb}</span>
                <span className={styles.target}>{formatGvr(op.gvr)}{op.name ? ` · ${op.name}` : ''}</span>
                <span className={styles.opNs}>{op.namespace || '—'}</span>
                {op.irreversible && <span className={styles.irreversible}>irreversible</span>}
              </div>
              {op.payloadPreview !== undefined && (
                <YamlBlock value={op.payloadPreview} />
              )}
            </li>
          )
        })}
      </ol>
    </div>
  )
}

export interface BlastRadiusConfirmProps {
  radius: BlastRadius | BlastRadiusSet
}

/**
 * The confirm-modal body. Pure presentation of an already-built BlastRadius: the human reads
 * exactly WHAT (verb+intent), WHERE (gvr+cluster+namespace+name), HOW MANY (count), and the
 * CHANGE (diff) before clicking Confirm. A W0-4 set radius renders the ordered op list
 * (SetView) instead of the scalar diff.
 */
const BlastRadiusConfirm = ({ radius }: BlastRadiusConfirmProps) => {
  if (isSetRadius(radius)) {
    return <SetView radius={radius} />
  }

  const { cluster, count, diff, gvr, name, namespace, verb } = radius

  return (
    <div className={styles.root} data-testid='blast-radius-confirm'>
      <div className={styles.headline}>
        <span className={styles.verb} data-verb={verb}>{verb}</span>
        <span className={styles.intent}>{VERB_INTENT[verb]}</span>
        {name && <span className={styles.target}>{name}</span>}
      </div>

      <dl className={styles.facts}>
        <div className={styles.factRow}>
          <dt className={styles.factKey}>Resource</dt>
          <dd className={styles.factVal}>{formatGvr(gvr)}</dd>
        </div>
        <div className={styles.factRow}>
          <dt className={styles.factKey}>Cluster</dt>
          <dd className={styles.factVal}>{cluster}</dd>
        </div>
        <div className={styles.factRow}>
          <dt className={styles.factKey}>Namespace</dt>
          <dd className={styles.factVal}>{namespace || '—'}</dd>
        </div>
        <div className={styles.factRow}>
          <dt className={styles.factKey}>Objects</dt>
          <dd className={styles.factVal} data-testid='blast-radius-count'>{count}</dd>
        </div>
      </dl>

      <DiffView diff={diff} />
    </div>
  )
}

export default BlastRadiusConfirm
