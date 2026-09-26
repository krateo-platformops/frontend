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
import { useCallback, useEffect, useRef, useState } from 'react'
import SyntaxHighlighter from 'react-syntax-highlighter'
import atomOneDark from 'react-syntax-highlighter/dist/esm/styles/hljs/atom-one-dark.js'
import lightfair from 'react-syntax-highlighter/dist/esm/styles/hljs/lightfair.js'

import { useThemeMode } from '../../context/ThemeModeContext'
import { LAYER } from '../../theme/layers'
import { DrawerHeader, drawerCloseProps } from '../DrawerHeader/DrawerHeader'
import WidgetRenderer from '../WidgetRenderer'

import type { DraftKind } from './blueprintDraftStore'
import { DraftProblemsAlert } from './DraftProblemsAlert'
import { parseFileEdit, parseRestDefEdit } from './previewBridge'
import { AUTOPILOT_PREVIEW_EVENT, draftKindOfPayload, isHeldDraftPayload, isPageDraftPayload, openAutopilotPreview, type AutopilotPreviewPayload, type PreviewObjectEntry } from './previewBus'
import { onPreviewSurfaceClaimed, previewSurfaceClaimed } from './previewDraftChanged'
import { onDraftClose } from './previewDraftClose'
import { emitRestDefEdit } from './previewEditBus'
import { emitFileEdit } from './previewFileEdit'
import { PreviewFormSection } from './previewFormSection'
import styles from './previewSurface.module.css'

/** How far to inset the preview so it sits LEFT of the chat instead of covering it.
 *
 * READ THE RAIL'S LIVE WIDTH, never a constant. This was hardcoded at 384 — the rail's DEFAULT —
 * but the rail is user-resizable by drag, gains HISTORY_EXTRA_WIDTH when the history split opens,
 * and goes to 100% in full-width mode. Any of those made the drawer overlap and clip the
 * conversation (frontend#180: "enlarged autopilot window gets hidden by the preview block").
 *
 * AutopilotRail owns `--autopilot-rail-width` and publishes exactly this value for exactly this
 * purpose ("so body-portalled overlays can inset their right edge and never sit over the rail").
 * Using the var also means a drag RESIZES the inset live — a prop would need this component to
 * re-render on every drag frame, which it does not do. Falls back to 0 so a missing var cannot
 * push the drawer off-screen; the rail sets it to 0px when closed, so no open/closed branch. */
const RAIL_INSET = 'var(--autopilot-rail-width, 0px)'

/** Pin the preview Drawer at antd's default popup z-index (1000). Belt-and-suspenders for the
 * "confirm opens BEHIND the preview" fix (item Q): the blast-radius confirm modal is
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
/**
 * Lines of a file to light, with the sentence that says why — the composer's generated gate
 * (gateGen's `gateLineRanges`), 1-based and inclusive.
 */
export interface FileHighlight {
  path: string
  ranges: { from: number; to: number }[]
  caption: string
}

const FileEditBlock = ({
  content,
  editable,
  highlight,
  isPageWidget,
  kind,
  live,
  mode,
  path,
  style,
}: {
  content: string
  /** Only the HELD draft's files: an edit is written into whatever is held, by path. */
  editable: boolean
  /** Lines to light in the read-only view, and why. */
  highlight?: Pick<FileHighlight, 'caption' | 'ranges'>
  /**
   * `content` IS the held bytes (a surface's live files), so the edit can be pinned to them. The
   * drawer shows a one-shot payload, which need not be byte-for-byte what is held, and pins nothing.
   */
  live: boolean
  /** What the preview showed — the provider refuses an edit whose kind is not what it holds. */
  kind: DraftKind
  isPageWidget: boolean
  mode: 'dark' | 'light'
  path: string
  style: { [key: string]: React.CSSProperties }
}) => {
  // The CURRENT held content (seeded from the payload; replaced by each accepted edit).
  const [current, setCurrent] = useState(content)
  // …and by the HELD bytes when they change under it. A composer passes its live files, so an Undo,
  // an agent's write or a start over the same path arrives here as a new `content` — and the block
  // kept showing the bytes it was first mounted with, because the key is the path and the path had
  // not changed. Adjusted during render (React's derived-state pattern), so no frame shows the old
  // bytes; an edit in progress keeps its text, and its Apply compares against the new bytes.
  const [seenContent, setSeenContent] = useState(content)
  if (seenContent !== content) {
    setSeenContent(content)
    setCurrent(content)
  }
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState(content)
  // The held bytes the edit STARTED from. The text is the whole file, so applying it over bytes that
  // moved in between — a node placed from the palette, the agent's write, an Undo — would silently
  // undo that change: the file-edit bus writes what it is given. So Apply refuses once they differ,
  // as the form editor's Apply does, and the provider checks the same pin (`expect`) on its side.
  const [base, setBase] = useState(content)
  const [error, setError] = useState<string | null>(null)

  const beginEdit = () => {
    setText(current)
    setBase(current)
    setError(null)
    setEditing(true)
  }

  const onApply = () => {
    if (current !== base) {
      setError(`${path} changed while you were editing it — nothing was written. Cancel, then Edit again to start from the held text.`)
      return
    }
    const result = parseFileEdit(text, isPageWidget, path)
    if (!result.ok || result.content === undefined) {
      // Deny-by-default: surface the error inline; the held bytes (current) are untouched, nothing emitted.
      setError(result.problems[0] ?? 'the edit could not be applied')
      return
    }
    // The PROVIDER decides whether it is held — the byte cap, a path it does not hold. Refused: said
    // here, the editor stays open on the person's text, and the block goes on showing the held bytes
    // (the ones a publish commits). No answer at all (no provider) keeps the old optimistic show.
    const outcome = emitFileEdit({ content: result.content, kind, path, ...(live ? { expect: base } : {}) })
    if (outcome && !outcome.ok) {
      setError(outcome.error)
      return
    }
    // What the provider HOLDS, which is not always what was typed: a chart's architecture file comes
    // back with its graph block regenerated.
    setCurrent(outcome?.ok && outcome.content !== undefined ? outcome.content : result.content)
    setError(null)
    setEditing(false)
  }

  return (
    <div className={styles.file}>
      <div className={styles.fileHead}>
        <div className={styles.filePath}><Typography.Text code>{path}</Typography.Text></div>
        {editing || !editable ? null : <Button onClick={beginEdit} size='small' type='link'>Edit</Button>}
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
          {highlight ? <Typography.Paragraph className={styles.gateCaption} data-testid='gate-caption'>{highlight.caption}</Typography.Paragraph> : null}
          <SyntaxHighlighter
            language='yaml'
            lineProps={highlight ? (line: number) => (highlight.ranges.some((range) => line >= range.from && line <= range.to)
              ? { className: styles.gateLine, 'data-gate': 'true' } as React.HTMLProps<HTMLElement>
              : {}) : undefined}
            showLineNumbers
            style={style}
            wrapLines
            wrapLongLines
          >
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

export const PreviewContent = ({ caption, editVerdicts, focusNonce, focusPath, hideDraftProblems, highlight, liveFiles, onVerdicts, payload, sourceNotes }: {
  /**
   * OVERRIDES the payload's own caption, for a surface that is not the drawer.
   *
   * `LIVE_PREVIEW_CAPTION` is written for the drawer and says so — "Closing this drawer removes
   * them". The composer embeds this same component INLINE, in the lower half of its split, where
   * there is no drawer to close and the equivalent control is "Close draft". So the drawer's
   * sentence was being shown to a reader who could not act on it, describing a thing that was not
   * on their screen.
   *
   * Omitted, the payload's caption stands — the drawer keeps its own wording unchanged.
   */
  caption?: string
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
  /**
   * A new value is a new REQUEST to reveal `focusPath`, even the same path again. The reveal is keyed
   * on the path, and asking for the file you asked for last — the Template link after switching to
   * Source, the node clicked a second time — changed nothing React could see, so nothing happened.
   * A surface that re-reveals on request bumps this with each one; the drawer and the page composer
   * pass nothing and keep reveal-on-change.
   */
  focusNonce?: number
  /**
   * The surface shows the held draft's lint problems itself, above this component — so this one
   * does not repeat them. The Blueprint Composer puts them under its header, beside the Publish
   * they disable; a second copy below the canvas would say the same thing twice. Absent (the
   * drawer, the page composer): shown here, as before.
   */
  hideDraftProblems?: boolean
  /**
   * THE DRAFT AS IT IS NOW, when the surface showing it has one.
   *
   * `payload` is built ONCE, by the verb that proposed the draft, and nothing re-emits it — which
   * this file's callers already knew: the composer's canvas and tree were moved onto a separate
   * live `files` state for exactly that reason. The Files tab was not moved with them, so it went
   * on rendering the bytes as they were when the draft was first previewed. Three views of one
   * draft, and the one LABELLED Files — presented as the write set the blast-radius confirm will
   * act on — was the only one that was neither live nor authoritative.
   *
   * Keyed by held key, which for a page draft IS the chart-relative path (`pagePublishPath` is the
   * identity function now), so no routing is needed to show them.
   *
   * Optional: the drawer has no live state and passes nothing, keeping its behaviour exactly as it
   * was.
   */
  liveFiles?: Record<string, string>
  /**
   * Lines of one file to light in Files, with a caption — the Blueprint Composer's generated gate,
   * right after an edge wrote it. Absent everywhere else.
   */
  highlight?: FileHighlight | null
  onVerdicts: (verdicts: RestDefVerdicts) => void
  payload: AutopilotPreviewPayload
  /**
   * Notes the surface adds to the Source tab — the Blueprint Composer's unmanaged gates. Said only when
   * there are any (exception-only), and never instead of the render's own verdicts.
   */
  sourceNotes?: string[]
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
  // re-arms the gate; the publish claim then commits the edited bytes, since it carries the held files).
  // A page's files are widget CRs (require the apiVersion/kind/metadata.name shape); a blueprint's are
  // Helm chart templates (YAML-parse-only) — distinguished by what the payload says it IS, not by its
  // tab label: a label is copy, and keying the edit parser on copy is how a chart got a page's rules.
  const isPageWidget = isPageDraftPayload(payload)
  // …and editable at all only when the payload IS the held draft. A preview nothing holds — a draft
  // that failed its render — has files too, and an edit to its Chart.yaml would land in the held one.
  const heldDraft = isHeldDraftPayload(payload)
  // The live draft when the surface has one, the one-shot payload otherwise.
  const shownFiles = liveFiles
    ? Object.entries(liveFiles).map(([path, content]) => ({ content, path })).sort((left, right) => left.path.localeCompare(right.path))
    : payload.files
  const filesBody = shownFiles?.length ? (
    <div className={styles.body}>
      {shownFiles.map((file, index) => (
        <div id={fileAnchorId(file.path)} key={`file-${index}-${file.path}`}>
          <FileEditBlock
            content={file.content}
            editable={heldDraft}
            highlight={highlight?.path === file.path ? highlight : undefined}
            isPageWidget={isPageWidget}
            kind={isPageWidget ? 'page' : 'blueprint'}
            live={liveFiles !== undefined}
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
      {sourceNotes?.length ? (
        <Alert
          description={<ul className={styles.issueList}>{sourceNotes.map((line) => <li key={line}>{line}</li>)}</ul>}
          message='Unmanaged gates'
          showIcon
          type='info'
        />
      ) : null}
      {/* FE-K(edit): the editable RestDefinition source (or the read-only Collapse), computed above. */}
      {sourceView}
      {/* FE-B1: the create-form half of a blueprint preview — the draft's
          values.schema.json mounted read-only through the production SchemaForm. */}
      {payload.formSchema ? <PreviewFormSection formSchema={payload.formSchema} /> : null}
      {!items.length && !payload.error && !summary?.length && !payload.formSchema && !problems?.length && editableYaml === undefined && !sourceNotes?.length
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
  //
  // Keyed on the matched PATH, a string, not on the file entry: with `liveFiles` the entries are
  // rebuilt on every render, so an effect keyed on the entry ran on every render — and switched
  // back to Files each time. With a node selected, clicking Source re-rendered, and the effect put
  // Files back: Source could not be opened at all until the selection was cleared.
  const focusedPath = focusPath
    ? shownFiles?.find((file) => file.path === focusPath || file.path.endsWith(`/${focusPath}`))?.path
    : undefined
  useEffect(() => {
    if (!focusedPath) {
      return
    }
    setActiveTab('files')
    // Next frame: the Files tab may have just been mounted by the line above, and an unmounted
    // node has nothing to scroll to.
    const frame = requestAnimationFrame(() => {
      document.getElementById(fileAnchorId(focusedPath))?.scrollIntoView({ block: 'nearest' })
    })
    return () => cancelAnimationFrame(frame)
  }, [focusedPath, focusNonce])

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
      {heldDraft && !hideDraftProblems ? <DraftProblemsAlert /> : null}
      {(caption ?? payload.caption)
        ? <Typography.Paragraph type='secondary'>{caption ?? payload.caption}</Typography.Paragraph>
        : null}
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
  const [open, setOpen] = useState(false)
  const [payload, setPayload] = useState<AutopilotPreviewPayload | null>(null)
  // FE-K(edit): the LIVE verdicts of the (possibly edited) RestDefinition source — null until the
  // user applies an edit, then the re-validated verdicts REPLACE the payload's original ones so the
  // problems/immutability/summary Alert blocks reflect the edit. Reset whenever a new payload arrives.
  const [editVerdicts, setEditVerdicts] = useState<RestDefVerdicts | null>(null)

  // The HELD draft this drawer is showing, if any — written where the payload is set, not during
  // render. A discard re-announced when a late re-apply lands arrives in the same tick that apply
  // opened its payload, before React has rendered it; a render-time ref would still say "nothing".
  const heldShown = useRef<AutopilotPreviewPayload | null>(null)
  /**
   * Close the held draft shown here — it was discarded, or a page this drawer defers replaced it in
   * the store. Left open, its Files tab writes by path into whatever is held NOW, and a page set
   * holds Chart.yaml and values.schema.json under the same names a chart does.
   */
  const dropHeld = useCallback(() => {
    const shown = heldShown.current
    if (!shown) {
      return
    }
    heldShown.current = null
    setOpen(false)
    // Epoch-guarded upstream: the close of a superseded page render never deletes a newer one.
    shown.onClose?.()
  }, [])

  useEffect(() => {
    const handleOpen = (event: CustomEvent<AutopilotPreviewPayload>) => {
      // Defer to a mounted composer OF THIS KIND: it is already showing this draft and owns its
      // close, and opening over it would put two surfaces on one draft — for a page, two live
      // sandbox renders, where closing THIS one tears down the CRs the composer still renders.
      // Only the claimed kind: a composer can show nothing else, so deferring any other preview to
      // it would show that preview NOWHERE. A deferred draft replaces the held one, so a held draft
      // this drawer is showing is superseded and dropped.
      if (previewSurfaceClaimed(draftKindOfPayload(event.detail))) {
        dropHeld()
        return
      }
      heldShown.current = isHeldDraftPayload(event.detail) ? event.detail : null
      setPayload(event.detail)
      setEditVerdicts(null)
      setOpen(true)
    }
    window.addEventListener(AUTOPILOT_PREVIEW_EVENT, handleOpen as EventListener)
    return () => window.removeEventListener(AUTOPILOT_PREVIEW_EVENT, handleOpen as EventListener)
  }, [dropHeld])

  // A draft discarded elsewhere — the composer's Discard — takes its preview with it.
  useEffect(() => onDraftClose(dropHeld), [dropHeld])

  // A composer of the held draft's kind mounted while this was open on it: the draft has one
  // surface, and it is the composer now (see claimPreviewSurface). Anything else shown here — an
  // inspection, the other kind — stays.
  //
  // HANDED OVER, NOT DROPPED. Dropping fired the payload's close, and for a live page render that
  // close is the sandbox teardown: opening the Portal Builder deleted the draft CRs the person was
  // looking at, and the composer — which adopts only NEW previews — fell back to a render-less held
  // view. So the drawer shuts WITHOUT the close and re-announces the payload for the composer to
  // adopt, render and close together. A microtask, because the claim is made in the composer's
  // first mount effect and its preview listener is registered by a later one; React runs a commit's
  // effects in one pass, so by then it is listening. The re-announce comes back here too, is
  // deferred to the claim, and finds nothing held to drop. If nothing adopts it, nothing leaks: a
  // discard tears the sandbox down regardless, and the next apply sweeps what the last one made.
  useEffect(() => onPreviewSurfaceClaimed((kind) => {
    const shown = heldShown.current
    if (shown && draftKindOfPayload(shown) === kind) {
      heldShown.current = null
      setOpen(false)
      queueMicrotask(() => openAutopilotPreview(shown))
    }
  }), [])

  if (!payload) {
    return null
  }

  return (
    <Drawer
      // #86 §0.10: shared close placement (X at the END), from the one drawerCloseProps source.
      closable={drawerCloseProps.closable}
      destroyOnHidden
      // #3 — don't cover the chat: drop the dimming mask, and inset the drawer by the rail's LIVE
      // width so the preview AND the conversation stay visible + interactive at once, at any rail size.
      mask={false}
      onClose={() => {
        heldShown.current = null
        setOpen(false)
        // previewPage v2 teardown seam — fired on the ACTUAL close (epoch-guarded
        // upstream, so a payload replaced while open never double-tears-down).
        payload.onClose?.()
      }}
      open={open}
      rootStyle={{ insetInlineEnd: RAIL_INSET }}
      size='large'
      // #86 §0.10: title via the shared DrawerHeader (default 16px tier). payload.title stays a
      // string → previewBus/verbRegistry untouched.
      title={<DrawerHeader title={payload.title} />}
      // Pin below the blast-radius confirm (1100) so a publish/apply gate is never trapped behind
      // this drawer (item Q). The confirm's raised z-index is the guarantee; this is explicit.
      zIndex={PREVIEW_DRAWER_Z_INDEX}
    >
      <PreviewContent editVerdicts={editVerdicts} onVerdicts={setEditVerdicts} payload={payload} />
    </Drawer>
  )
}

export default AutopilotPreviewDrawer
