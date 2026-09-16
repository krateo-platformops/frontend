/**
 * The Autopilot preview drawer — the ONE surface the Wave-4 read-only preview verbs
 * (previewBlueprint / previewPage / previewRestDef) render into. Mounted once by
 * AutopilotProvider and opened via the previewBus CustomEvent, mirroring the portal's
 * global Drawer overlay pattern (widgets/Drawer). Read-only by construction: it renders
 * the payload it was handed — no dispatcher, no fetch, no write path of any kind.
 *
 * Surface anatomy (minimal + clean, per the Wave-4 ticket): a Drawer titled by the
 * verb; an optional caption qualifying WHAT kind of preview this is (e.g. source
 * preview); a render error shown AS content when present (a bad chart is data); the
 * summary lines (RestDefinition verbs/paths); then one collapsible panel per object —
 * kind/name/namespace headline, YAML body (same highlighter setup as YamlViewer).
 *
 * previewPage v2 (FE-P4): a payload carrying `liveEndpoint` renders TWO tabs —
 * "Rendered (live)": the portal's OWN WidgetRenderer mounted on the ROOT draft's
 * REAL served widgetEndpoint (snowplow compiles the sandbox drafts exactly like a
 * production page; children resolve recursively; the render runs under the viewing
 * user's identity) — and "Source": the classic per-CR YAML view. `onClose` is the
 * teardown seam: the v2 flow best-effort-DELETEs its sandbox drafts when the drawer
 * closes (epoch-guarded upstream, so a stale close never touches a newer preview).
 */
import { Alert, Button, Collapse, Drawer, Empty, Input, Space, Tabs, Tag, Typography } from 'antd'
import { useEffect, useState } from 'react'
import SyntaxHighlighter from 'react-syntax-highlighter'
import atomOneDark from 'react-syntax-highlighter/dist/esm/styles/hljs/atom-one-dark.js'
import lightfair from 'react-syntax-highlighter/dist/esm/styles/hljs/lightfair.js'

import { useThemeMode } from '../../context/ThemeModeContext'
import { LAYER } from '../../theme/layers'
import { DrawerHeader, drawerCloseProps } from '../DrawerHeader/DrawerHeader'
import WidgetRenderer from '../WidgetRenderer'

import { useAutopilot } from './AutopilotProvider'
import { parseFileEdit, parseRestDefEdit } from './previewBridge'
import { AUTOPILOT_PREVIEW_EVENT, type AutopilotPreviewPayload, type PreviewObjectEntry } from './previewBus'
import { previewSurfaceClaimed } from './previewDraftChanged'
import { emitRestDefEdit } from './previewEditBus'
import { emitFileEdit } from './previewFileEdit'
import { PreviewFormSection } from './previewFormSection'
import styles from './previewSurface.module.css'

/** The blueprint "Files" tab is labelled "Chart files"; a page keeps the generic "Files". A
 * blueprint's files are Helm chart TEMPLATES (YAML-parse-only on edit); a page's are widget CRs
 * (which additionally require the apiVersion/kind/metadata.name shape). This is the one place the
 * page/blueprint distinction is read on the edit path — the SAME discriminator the payload builders set. */
const BLUEPRINT_FILES_LABEL = 'Chart files'

/** The open Autopilot rail's fixed width (AutopilotRail.module.css `.apRail.open`). The preview
 * drawer offsets by this so it sits LEFT of the chat instead of covering it. */
const RAIL_WIDTH = 384

/** Pin the preview Drawer at antd's default popup z-index (1000). Belt-and-suspenders for the
 * "confirm opens BEHIND the preview" fix (Vincenzo item Q): the blast-radius confirm modal is
 * raised to BLAST_RADIUS_CONFIRM_Z_INDEX (1100) so it always paints above this drawer. Setting
 * the drawer explicitly keeps that ordering immune to any future `zIndexPopupBase` theme drift —
 * the confirm's raised value stays the guarantee; this just makes the relationship explicit. */
export const PREVIEW_DRAWER_Z_INDEX = LAYER.PREVIEW

const ObjectHeadline = ({ entry }: { entry: PreviewObjectEntry }) => (
  <span className={styles.headline}>
    <Tag>{entry.kind}</Tag>
    <Typography.Text strong>{entry.name ?? '(unnamed)'}</Typography.Text>
    {entry.namespace ? <Typography.Text type='secondary'>· {entry.namespace}</Typography.Text> : null}
  </span>
)

/** The re-validated view of the current (possibly edited) RestDefinition source: the verdicts the
 * drawer renders. Seeded from the payload, replaced by each accepted/attempted edit. */
export interface RestDefVerdicts {
  problems?: string[]
  warnings?: string[]
  summary?: string[]
}

/**
 * FE-K(edit) — the EDITABLE RestDefinition source. The user edits the held draft's YAML in place;
 * "Apply edits" re-validates client-side (parseRestDefEdit, the SAME pipeline the preview built) and:
 *   - a parse/CRD error → the verdicts update to show the exact errors, the gate is NOT re-armed;
 *   - a clean draft     → the edited draft is emitted on the edit bus (the provider re-arms the
 *                         preview gate with the edited bytes), and a "held for publish" note shows.
 * The held-bytes guarantee holds: the edit is a human action on the held YAML, never a model round-trip.
 * `onVerdicts` lifts the current verdicts up so the shared Alert blocks reflect the LATEST edit.
 */
const RestDefEditSection = ({
  initialYaml,
  onVerdicts,
  restDefKind,
}: {
  initialYaml: string
  onVerdicts: (verdicts: RestDefVerdicts) => void
  restDefKind: string
}) => {
  const { mode } = useThemeMode()
  const [text, setText] = useState(initialYaml)
  // The applied-edit signal: null before any apply, then the accepted verdict for the LAST apply.
  const [applied, setApplied] = useState<{ ok: boolean } | null>(null)
  const dirty = text !== initialYaml

  const onApply = () => {
    const result = parseRestDefEdit(text)
    // Lift the fresh verdicts so the drawer's Alert blocks (problems/immutability/summary) update.
    onVerdicts({ problems: result.problems, summary: result.summary, warnings: result.warnings })
    setApplied({ ok: result.ok })
    // Only a CLEAN edit re-arms the gate — an invalid edit arms nothing (deny-by-default, exactly
    // as an invalid model draft never arms the gate). The provider re-validates once more before recording.
    if (result.ok && result.draft) {
      emitRestDefEdit(result.draft)
    }
  }

  // The apply-status line: absent before any apply, a success/danger note after (no nested ternary).
  let status: React.ReactNode = null
  if (applied?.ok) {
    status = <Typography.Text type='success'>Valid — held for publish</Typography.Text>
  } else if (applied) {
    status = <Typography.Text type='danger'>Fix the errors above, then apply again</Typography.Text>
  }

  return (
    <div className={styles.edit}>
      <div className={styles.editHead}>
        <Typography.Text strong>Edit source</Typography.Text>
        <Typography.Text type='secondary'>· {restDefKind} — edited here, held for publish (never retyped by the model)</Typography.Text>
      </div>
      <Input.TextArea
        aria-label='RestDefinition source'
        autoSize={{ maxRows: 28, minRows: 8 }}
        className={mode === 'dark' ? styles.editAreaDark : undefined}
        onChange={(event) => setText(event.target.value)}
        spellCheck={false}
        value={text}
      />
      <Space>
        <Button disabled={!dirty} onClick={onApply} type='primary'>Apply edits</Button>
        {status}
      </Space>
    </div>
  )
}

/**
 * FE-K(edit), page/blueprint half — ONE editable file in the "Files" tab. Read-only by default (the
 * highlighted YAML + an "Edit" affordance); "Edit" swaps in an inline Input.TextArea for THAT file only.
 * On "Apply edits": parseFileEdit re-validates client-side (YAML always; the widget-CR shape for a page
 * file) and:
 *   - a parse/shape error → an inline Alert (the SAME style #135's RestDefinition errors use), the held
 *     content is UNCHANGED, nothing is emitted (deny-by-default: the previously-held bytes stand);
 *   - a clean edit        → the accepted bytes are emitted on the previewFileEdit bus (the provider writes
 *     them into the held tree + re-arms the page/blueprint gate) and the tab reflects the updated content.
 * The held-bytes guarantee holds: the edit is a human action on the held file, never a model round-trip.
 */
const FileEditBlock = ({
  content,
  isPageWidget,
  mode,
  path,
  style,
}: {
  content: string
  isPageWidget: boolean
  mode: 'dark' | 'light'
  path: string
  style: { [key: string]: React.CSSProperties }
}) => {
  // The CURRENT held content (seeded from the payload; replaced by each accepted edit).
  const [current, setCurrent] = useState(content)
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState(content)
  const [error, setError] = useState<string | null>(null)

  const beginEdit = () => {
    setText(current)
    setError(null)
    setEditing(true)
  }

  const onApply = () => {
    const result = parseFileEdit(text, isPageWidget)
    if (!result.ok || result.content === undefined) {
      // Deny-by-default: surface the error inline; the held bytes (current) are untouched, nothing emitted.
      setError(result.problems[0] ?? 'the edit could not be applied')
      return
    }
    setCurrent(result.content)
    setError(null)
    setEditing(false)
    emitFileEdit({ content: result.content, path })
  }

  return (
    <div className={styles.file}>
      <div className={styles.fileHead}>
        <div className={styles.filePath}><Typography.Text code>{path}</Typography.Text></div>
        {editing ? null : <Button onClick={beginEdit} size='small' type='link'>Edit</Button>}
      </div>
      {error ? (
        <Alert
          description={<span className={styles.errorText}>{error}</span>}
          message='This edit was not applied'
          showIcon
          type='error'
        />
      ) : null}
      {editing ? (
        <div className={styles.edit}>
          <Input.TextArea
            aria-label={`Edit ${path}`}
            autoSize={{ maxRows: 28, minRows: 8 }}
            className={mode === 'dark' ? styles.editAreaDark : undefined}
            onChange={(event) => setText(event.target.value)}
            spellCheck={false}
            value={text}
          />
          <Space>
            <Button disabled={text === current} onClick={onApply} type='primary'>Apply edits</Button>
            <Button onClick={() => { setEditing(false); setError(null) }}>Cancel</Button>
          </Space>
        </div>
      ) : (
        <div className={styles.yaml}>
          <SyntaxHighlighter language='yaml' showLineNumbers style={style} wrapLines wrapLongLines>
            {current}
          </SyntaxHighlighter>
        </div>
      )}
    </div>
  )
}

/**
 * The payload-to-JSX half of the preview surface — the live render, the Files tab with its
 * per-file editor, the RestDefinition editor, the verdict Alerts.
 *
 * SPLIT OUT so it can be mounted somewhere that is not a drawer. All of this was the body of
 * `AutopilotPreviewDrawer`, which `AutopilotProvider` renders — so the whole authoring surface was
 * reachable only inside the Autopilot rail, as something the AGENT opens. The Portal Builder could
 * not use any of it and reimplemented a slice through Form widgets, which is why it can only emit a
 * flat page of static widgets: a Form cannot express a tree, and SchemaFields has no repeatable-row
 * control. Making this mountable is what lets a human start the same draft the agent proposes.
 *
 * Still read-only with respect to the cluster: it renders what it is handed and emits edits on the
 * existing CustomEvent buses. No dispatcher, no fetch, no write path — unchanged.
 *
 * `onVerdicts` lifts re-validated verdicts to the owner so the Alert blocks reflect the latest edit;
 * the drawer keeps that in its own state, a page may keep it in its own.
 */
/**
 * A DOM id for one file block. Non-alphanumerics collapse to `-` so a repo path is a valid id.
 * Derived on both sides from the displayed path, so the reveal cannot drift from what it targets.
 */
const fileAnchorId = (path: string): string => `preview-file-${path.replace(/[^a-zA-Z0-9]+/g, '-')}`

export const PreviewContent = ({ editVerdicts, focusPath, onVerdicts, payload }: {
  editVerdicts: RestDefVerdicts | null
  /**
   * The draft file to reveal in the Files tab — the composer's tree selection.
   *
   * A HELD KEY (`statistic.stat-ready.yaml`), matched as a SUFFIX of each file's displayed path.
   * The two vocabularies differ — a page's files are shown at their routed repo destination while
   * the draft holds them under bare tokens — and a suffix match is the one comparison that works
   * for both without this component having to know which kind of draft it is showing.
   *
   * Without it the two halves of the composer are unrelated views: a tree that says what is in the
   * draft, beside a list that will not show you the one you just clicked. Optional — the drawer
   * has no tree, and passes nothing.
   */
  focusPath?: string | null
  onVerdicts: (verdicts: RestDefVerdicts) => void
  payload: AutopilotPreviewPayload
}): React.ReactNode => {
  const { mode } = useThemeMode()
  const setEditVerdicts = onVerdicts
  // Controlled so a tree selection can switch to Files; `onChange` keeps manual switching working.
  const [activeTab, setActiveTab] = useState<string | undefined>(undefined)

  // The verdicts to render: the live edit verdicts once the user applied an edit, else the payload's.
  const problems = editVerdicts ? editVerdicts.problems : payload.problems
  const warnings = editVerdicts ? editVerdicts.warnings : payload.warnings
  const summary = editVerdicts ? editVerdicts.summary : payload.summary
  // The editable RestDefinition source (single object). Only RestDefinition previews mark editRestDef.
  const editableYaml = payload.editRestDef ? payload.objects?.[0]?.yaml : undefined

  const highlighterStyle = (mode === 'dark' ? atomOneDark : lightfair) as { [key: string]: React.CSSProperties }
  const items = (payload.objects ?? []).map((entry, index) => ({
    children: (
      <div className={styles.yaml}>
        <SyntaxHighlighter language='yaml' showLineNumbers style={highlighterStyle} wrapLines wrapLongLines>
          {entry.yaml}
        </SyntaxHighlighter>
      </div>
    ),
    key: `${index}-${entry.kind}-${entry.name ?? 'unnamed'}`,
    label: <ObjectHeadline entry={entry} />,
  }))

  // The unified "Files" tab: the SOURCE tree a publish commits, each file headed by its repo-relative
  // destination path. Same shape for both builders (a page's widget CRs / a blueprint's chart tree) —
  // it IS the write-set the blast-radius later confirms, shown up front. FE-K(edit): each file is
  // EDITABLE in place — an accepted edit rides the previewFileEdit bus into the held draft (the provider
  // re-arms the gate; the $fileContent publish path then commits the edited bytes automatically).
  // A page's files are widget CRs (require the apiVersion/kind/metadata.name shape); a blueprint's are
  // Helm chart templates (YAML-parse-only) — distinguished by the payload's files label.
  const isPageWidget = (payload.filesLabel ?? '') !== BLUEPRINT_FILES_LABEL
  const filesBody = payload.files?.length ? (
    <div className={styles.body}>
      {payload.files.map((file, index) => (
        <div id={fileAnchorId(file.path)} key={`file-${index}-${file.path}`}>
          <FileEditBlock
            content={file.content}
            isPageWidget={isPageWidget}
            mode={mode}
            path={file.path}
            style={highlighterStyle}
          />
        </div>
      ))}
    </div>
  ) : null

  // The classic source view (error / verdicts / summary / per-object YAML). With a
  // v2 `liveEndpoint` this becomes the "Source" tab next to the live render. For a
  // RestDefinition preview (editRestDef) the read-only Collapse is REPLACED by the
  // editable source textarea — the verdicts above it re-validate on each applied edit.
  // (Computed here to avoid a nested ternary in the JSX below.) `key` re-seeds the editor
  // when a NEW preview of the SAME kind reopens (its own local text state would otherwise persist).
  let sourceView: React.ReactNode = null
  if (editableYaml !== undefined) {
    sourceView = (
      <RestDefEditSection
        initialYaml={editableYaml}
        key={payload.title}
        onVerdicts={setEditVerdicts}
        restDefKind={payload.restDefKind ?? 'RestDefinition'}
      />
    )
  } else if (items.length) {
    sourceView = <Collapse items={items} />
  }
  const sourceBody = (
    <div className={styles.body}>
      {payload.error ? (
        <Alert
          description={<pre className={styles.errorText}>{payload.error}</pre>}
          message='Render failed'
          showIcon
          type='error'
        />
      ) : null}
      {/* FE-K1: client-side validation of the previewed draft (vs the live CRD shape)
          and the CEL-immutability warnings — the decide-before-publish surface. Once the
          user edits the source, these reflect the re-validated EDITED draft (editVerdicts). */}
      {problems?.length ? (
        <Alert
          description={<ul className={styles.issueList}>{problems.map((line, index) => <li key={`problem-${index}`}>{line}</li>)}</ul>}
          message='Validation errors — publishing this draft would be rejected'
          showIcon
          type='error'
        />
      ) : null}
      {warnings?.length ? (
        <Alert
          description={<ul className={styles.issueList}>{warnings.map((line, index) => <li key={`warning-${index}`}>{line}</li>)}</ul>}
          message='Immutable after generation'
          showIcon
          type='warning'
        />
      ) : null}
      {summary?.length ? (
        <ul className={styles.summary}>
          {summary.map((line, index) => (
            <li key={`${index}-${line}`}>
              <Typography.Text code>{line}</Typography.Text>
            </li>
          ))}
        </ul>
      ) : null}
      {/* FE-K(edit): the editable RestDefinition source (or the read-only Collapse), computed above. */}
      {sourceView}
      {/* FE-B1: the create-form half of a blueprint preview — the draft's
          values.schema.json mounted read-only through the production SchemaForm. */}
      {payload.formSchema ? <PreviewFormSection formSchema={payload.formSchema} /> : null}
      {!items.length && !payload.error && !summary?.length && !payload.formSchema && !problems?.length && editableYaml === undefined
        ? <Empty description='Nothing to preview' image={Empty.PRESENTED_IMAGE_SIMPLE} />
        : null}
    </div>
  )

  // The unified tab set — the same shape for BOTH builders: [Rendered (live) if a sandbox endpoint] →
  // [Files: the committed source tree with paths] → [Source: rendered output / CRs + validation].
  // Reveal the selected file: switch to Files and scroll it into view.
  //
  // Suffix match, because the tree speaks HELD KEYS and this list shows routed repo destinations.
  // A node with no file of its own — a placed EXISTING widget — matches nothing and is left alone
  // rather than scrolling somewhere arbitrary.
  const focusedFile = focusPath
    ? payload.files?.find((file) => file.path === focusPath || file.path.endsWith(`/${focusPath}`))
    : undefined
  useEffect(() => {
    if (!focusedFile) {
      return
    }
    setActiveTab('files')
    // Next frame: the Files tab may have just been mounted by the line above, and an unmounted
    // node has nothing to scroll to.
    const frame = requestAnimationFrame(() => {
      document.getElementById(fileAnchorId(focusedFile.path))?.scrollIntoView({ block: 'nearest' })
    })
    return () => cancelAnimationFrame(frame)
  }, [focusedFile])

  const tabs = [
    ...(payload.liveEndpoint
      // The REAL renderer on the REAL served endpoint: snowplow resolves the sandbox drafts
      // (templates, apiRef data, children) like any page; its own loading/error states are honest.
      ? [{ children: <div className={styles.live}><WidgetRenderer widgetEndpoint={payload.liveEndpoint} /></div>, key: 'live', label: 'Rendered (live)' }]
      : []),
    ...(filesBody ? [{ children: filesBody, key: 'files', label: payload.filesLabel ?? 'Files' }] : []),
    { children: sourceBody, key: 'source', label: 'Source' },
  ]

  return (
    <div className={styles.body}>
      {payload.caption ? <Typography.Paragraph type='secondary'>{payload.caption}</Typography.Paragraph> : null}
      {payload.publishTarget ? (
        <div className={styles.target}>
          <Tag color='geekblue'>Publishes to</Tag>
          <Typography.Text code>{payload.publishTarget.repo}</Typography.Text>
          {payload.publishTarget.base ? <Typography.Text type='secondary'>· change request into {payload.publishTarget.base}</Typography.Text> : null}
          {payload.publishTarget.note ? <Typography.Text type='secondary'>· {payload.publishTarget.note}</Typography.Text> : null}
          {/* The destination is user-owned: these are DEFAULTS — a proper form asks at publish. */}
          <Typography.Text type='secondary'>· you confirm the destination at publish</Typography.Text>
        </div>
      ) : null}
      <Tabs activeKey={activeTab ?? tabs[0]?.key} items={tabs} onChange={setActiveTab} />
    </div>
  )
}

export const AutopilotPreviewDrawer = () => {
  const { open: railOpen } = useAutopilot()
  const [open, setOpen] = useState(false)
  const [payload, setPayload] = useState<AutopilotPreviewPayload | null>(null)
  // FE-K(edit): the LIVE verdicts of the (possibly edited) RestDefinition source — null until the
  // user applies an edit, then the re-validated verdicts REPLACE the payload's original ones so the
  // problems/immutability/summary Alert blocks reflect the edit. Reset whenever a new payload arrives.
  const [editVerdicts, setEditVerdicts] = useState<RestDefVerdicts | null>(null)

  useEffect(() => {
    const handleOpen = (event: CustomEvent<AutopilotPreviewPayload>) => {
      // Defer to a mounted page composer: it is already showing this draft, it owns the close, and
      // opening over it would put two live sandbox renders on one endpoint — where closing THIS
      // one fires the teardown that deletes the draft CRs the composer is still rendering.
      if (previewSurfaceClaimed()) {
        return
      }
      setPayload(event.detail)
      setEditVerdicts(null)
      setOpen(true)
    }
    window.addEventListener(AUTOPILOT_PREVIEW_EVENT, handleOpen as EventListener)
    return () => window.removeEventListener(AUTOPILOT_PREVIEW_EVENT, handleOpen as EventListener)
  }, [])

  if (!payload) {
    return null
  }

  return (
    <Drawer
      // #86 §0.10: shared close placement (X at the END), from the one drawerCloseProps source.
      closable={drawerCloseProps.closable}
      destroyOnHidden
      // #3 — don't cover the chat: drop the dimming mask, and when the rail is open shift the drawer
      // left of its 384px so the preview AND the conversation stay visible + interactive at once.
      mask={false}
      onClose={() => {
        setOpen(false)
        // previewPage v2 teardown seam — fired on the ACTUAL close (epoch-guarded
        // upstream, so a payload replaced while open never double-tears-down).
        payload.onClose?.()
      }}
      open={open}
      rootStyle={railOpen ? { insetInlineEnd: RAIL_WIDTH } : undefined}
      size='large'
      // #86 §0.10: title via the shared DrawerHeader (default 16px tier). payload.title stays a
      // string → previewBus/verbRegistry untouched.
      title={<DrawerHeader title={payload.title} />}
      // Pin below the blast-radius confirm (1100) so a publish/apply gate is never trapped behind
      // this drawer (Vincenzo item Q). The confirm's raised z-index is the guarantee; this is explicit.
      zIndex={PREVIEW_DRAWER_Z_INDEX}
    >
      <PreviewContent editVerdicts={editVerdicts} onVerdicts={setEditVerdicts} payload={payload} />
    </Drawer>
  )
}

export default AutopilotPreviewDrawer
