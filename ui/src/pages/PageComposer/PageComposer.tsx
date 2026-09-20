/**
 * Page Composer — the Portal Builder's authoring surface, mounted as a page.
 *
 * WHAT THIS IS. The same surface Autopilot opens when it previews a draft: the live render, the
 * Files tab with its per-file editor, the RestDefinition editor, the validation verdicts. Until now
 * that existed only as `AutopilotPreviewDrawer`, which `AutopilotProvider` renders — so the whole
 * authoring surface was reachable exclusively through the rail, as something the AGENT opens.
 *
 * WHY THAT MATTERED. The Portal Builder could not use any of it, so it reimplemented a slice
 * through Form widgets: `compose-page` and `author-widget`. A Form cannot express a tree and
 * `SchemaFields` has no repeatable-row control, so those two can only emit a FLAT page of widgets
 * with STATIC widgetData — no Rows, Cols, Tabs, no `apiRef`, no `widgetDataTemplate`. That locks
 * the builder out of the half of the corpus that computes its data server-side (212 of 425 shipped
 * widget templates carry a `widgetDataTemplate`). The chart predicted it in
 * restaction.page-composable: "an editor that authors NEW widgets from static widgetData can only
 * produce the trivial ones — it would look finished and ship pages nobody wants."
 *
 * WHY A STATIC ROUTE AND NOT A WIDGET KIND. `/profile` is the precedent: a static child of the
 * shell route, rendering inside the same chrome, with `*` falling through to `WidgetPage` for
 * everything CR-driven. So this needs a frontend image and nothing else — no new widget kind, no
 * CRD, no installer pin, none of the 4-piece release the parity programme's B3 assumed by its name.
 *
 * WHAT IT DOES NOT CHANGE. Autopilot is untouched and loses nothing: it still proposes drafts onto
 * the same CustomEvent bus, and its drawer still opens. The only difference is that a human can now
 * start one. Publishing is unchanged and still ends at a form a person submits — the agent's
 * never-submit guarantee is not weakened by any of this.
 */
import { Alert, Button, Popconfirm, Space, Typography } from 'antd'
import { useCallback, useContext, useEffect, useRef, useState } from 'react'

import { onComposeRequest } from '../../components/Autopilot/composeRequest'
import { AUTOPILOT_PREVIEW_EVENT } from '../../components/Autopilot/previewBus'
import type { AutopilotPreviewPayload } from '../../components/Autopilot/previewBus'
import { claimPreviewSurface, onDraftChanged, requestDraftReplay } from '../../components/Autopilot/previewDraftChanged'
import { emitDraftStart } from '../../components/Autopilot/previewDraftStart'
import { emitFileAdd } from '../../components/Autopilot/previewFileAdd'
import { emitFileEdit } from '../../components/Autopilot/previewFileEdit'
import { emitPublishRequest, onPublishResult } from '../../components/Autopilot/previewPublishRequest'
import { PreviewContent } from '../../components/Autopilot/previewSurface'
import type { RestDefVerdicts } from '../../components/Autopilot/previewSurface'
import { WidgetEmpty } from '../../components/WidgetStates'
import { ConfigContext } from '../../context/ConfigContext'

import CanvasPanel from './CanvasPanel'
import { buildObjectTree, draftNamespace, flattenTree } from './objectTree'
import type { TreeNode } from './objectTree'
import ObjectTreePanel from './ObjectTreePanel'
import styles from './PageComposer.module.css'
import PalettePanel from './PalettePanel'
import type { PalettePick } from './PalettePanel'
import { planAdd } from './planAdd'
import { planMove } from './planMove'
import StartDraftModal from './StartDraftModal'
import { LAYOUT_KINDS } from './structureEdit'

/**
 * Where a newly started page is created.
 *
 * The portal's own release namespace is the honest answer and the frontend does not know it, so
 * this matches `PORTAL_CHART_REPO_DEFAULTS` — the same default every other builder path assumes.
 * It is visible and editable in the Files tab before anything is published, which is the backstop.
 */
const NEW_DRAFT_NAMESPACE = 'krateo-system'

const PageComposer = () => {
  // `useContext`, not `useConfigContext`: the hook throws with no provider above it, and this page
  // only DEGRADES without config — the widget picker reports that it cannot reach the list. Taking
  // the whole route down for that would be worse, and the page is asserted to mount bare.
  const snowplowBaseUrl = useContext(ConfigContext)?.config?.api?.SNOWPLOW_API_BASE_URL ?? ''
  const [payload, setPayload] = useState<AutopilotPreviewPayload | null>(null)
  /**
   * The draft AS IT IS NOW, keyed by held key — not `payload.files`.
   *
   * This was the bug that invalidated everything built on top of it. The preview payload is built
   * once, by the verb that proposed the draft, and nothing re-emits it; a tree that read its bytes
   * from there computed every structural edit against the file as it was when the draft was FIRST
   * previewed. Two edits to the same parent and the second silently reverted the first, because
   * both were derived from the same original — and the tree never redrew to show it.
   *
   * The store in the provider is the source of truth, so the tree re-reads from its broadcast. Held
   * KEYS rather than displayed paths: what the tree emits back are writes, and a write addressed by
   * the routed path is a path that gets routed twice.
   */
  const [files, setFiles] = useState<Record<string, string>>({})
  // Why a move can be refused, shown where the other outcomes are shown. Not antd `message`: the
  // composer already reports through Alerts, and a toast that vanishes is the wrong surface for
  // "this drop was rejected and here is why".
  const [moveError, setMoveError] = useState<string | null>(null)

  /** What the palette has in the air. Lifted here because the palette and the canvas are siblings. */
  const [pick, setPick] = useState<PalettePick | null>(null)

  /**
   * Where a NEW object this page authors is created.
   *
   * The draft's own namespaces are Helm templates once serialized as a chart, so `draftNamespace`
   * legitimately finds none — and "none" must not mean "refuse to bind data". A page started here
   * was started in NEW_DRAFT_NAMESPACE; that is the honest fallback, and it is the same namespace
   * every other builder path assumes.
   */
  const authoringNamespace = draftNamespace(files) ?? NEW_DRAFT_NAMESPACE

  /**
   * A palette drop: plan it, then persist through the same buses a hand edit uses.
   *
   * ORDER IS LOAD-BEARING when a container was created — the file must be ADDED before the parent
   * that references it, or the parent momentarily names a file the draft does not carry. planAdd
   * returns the created file separately so this cannot be got the wrong way round by accident.
   */
  const applyAdd = useCallback((target: TreeNode, at: number | undefined, picked: PalettePick) => {
    const plan = planAdd(files, target, picked, authoringNamespace, at)
    if (!plan.ok) {
      setMoveError(plan.reason)
      return
    }
    setMoveError(null)
    if (plan.created) {
      emitFileAdd(plan.created)
    }
    Object.entries(plan.files).forEach(([path, content]) => emitFileEdit({ content, path }))
  }, [authoringNamespace, files])

  /**
   * A drop from the canvas: plan it, then persist through the SAME file-edit bus the Files tab uses
   * (emitFileEdit -> blueprintDraftStore -> broadcast -> the `files` this component holds). Nothing
   * is written directly, so a move goes through the draft's own byte cap and gate-rearming exactly
   * like a hand edit, and the canvas re-renders from the store rather than from local state.
   *
   * `roots` comes from the canvas rather than being rebuilt here — see CanvasPanel's onMove.
   */
  const applyMove = useCallback((moving: TreeNode, target: TreeNode, roots: readonly TreeNode[], at?: number) => {
    const plan = planMove(files, roots, moving, target, at)
    if (!plan.ok) {
      setMoveError(plan.reason)
      return
    }
    setMoveError(null)
    // Only the files the transaction changed — usually the two parents, one for a same-parent move.
    Object.entries(plan.files).forEach(([path, content]) => emitFileEdit({ content, path }))
  }, [files])
  const [starting, setStarting] = useState(false)
  // The tree selection, reflected in the Files list. Without it the two halves of the page are
  // unrelated views of the same draft.
  const [focusPath, setFocusPath] = useState<string | null>(null)
  // The publish in flight, and its outcome. Held here rather than shown in the chat rail: the
  // person who pressed the button is looking at this page, and sending them to the conversation to
  // find out what happened is the coupling this whole surface exists to remove.
  const [publishing, setPublishing] = useState(false)
  const [outcome, setOutcome] = useState<{ denial: string | null; deepLink: string | null } | null>(null)
  const publishId = useRef<string | null>(null)
  // Re-validated verdicts after an applied edit, so the Alert blocks reflect the latest draft
  // rather than the one that was first handed over. Same contract the drawer keeps.
  const [editVerdicts, setEditVerdicts] = useState<RestDefVerdicts | null>(null)

  // The SAME bus the drawer listens on. A preview proposed by Autopilot while this page is open
  // therefore lands here too — which is the point: one draft, two doors. Deliberately not a
  // separate channel; a second bus would be a second source of truth about what is being authored.
  // Claim the preview while this page is mounted, so the drawer does not ALSO open on the same
  // payload. Two surfaces on one draft is not just redundant: the drawer's close fires the sandbox
  // teardown, which deletes the draft CRs this page is still rendering live.
  useEffect(() => claimPreviewSurface(), [])

  useEffect(() => {
    const onPreview = (event: CustomEvent<AutopilotPreviewPayload>) => {
      setPayload(event.detail)
      setEditVerdicts(null)
    }
    window.addEventListener(AUTOPILOT_PREVIEW_EVENT, onPreview as EventListener)
    return () => window.removeEventListener(AUTOPILOT_PREVIEW_EVENT, onPreview as EventListener)
  }, [])

  // The answer to OUR publish, ignoring any other surface's.
  useEffect(() => onPublishResult(({ deepLink, denial, id }) => {
    if (publishId.current !== id) {
      return
    }
    publishId.current = null
    setPublishing(false)
    setOutcome({ deepLink, denial })
  }), [])

  // The held draft, and a replay request for the case this page mounted after it was seeded —
  // navigate here with a draft already open and the tree would otherwise sit empty until the next
  // edit, describing a draft that exists as if it did not.
  /**
   * THE AGENT RESTRUCTURING THE DRAFT — through the same kernel as a drag.
   *
   * The proposal names the intent ("put this widget in that container"); everything that decides
   * whether it is legal and what bytes result is `planMove`/`planAdd`, unchanged. So an agent
   * cannot place a child a person could not have dragged there, and a refusal reads the same way
   * for both — including in the same Alert.
   *
   * Nodes are resolved from ONE tree so the identities `legalTargets` compares by reference all
   * come from the same build; rebuilding per lookup would make every proposal illegal for a reason
   * no message could explain (the trap #304 documents).
   */
  useEffect(() => onComposeRequest((request) => {
    const roots = buildObjectTree(files)
    const byName = (name: string) => flattenTree(roots).find((node) => node.name === name)
    const target = byName(request.target)
    if (!target) {
      setMoveError(`"${request.target}" is not in this draft`)
      return
    }
    if (request.op === 'move') {
      const moving = byName(request.widget)
      if (!moving) {
        setMoveError(`"${request.widget}" is not in this draft`)
        return
      }
      applyMove(moving, target, roots, request.at)
      return
    }
    if (request.op === 'addContainer') {
      // Validated against the real map, not cast: a proposal can name anything, and a bogus layout
      // must be refused with a reason rather than coerced into a kind that does not exist.
      const layout = (Object.keys(LAYOUT_KINDS) as (keyof typeof LAYOUT_KINDS)[])
        .find((kind) => kind.toLowerCase() === request.layout.toLowerCase())
      if (!layout) {
        setMoveError(`"${request.layout}" is not a layout kind — try one of ${Object.keys(LAYOUT_KINDS).join(', ')}`)
        return
      }
      applyAdd(target, request.at, { kind: 'container', layout, resource: LAYOUT_KINDS[layout] })
      return
    }
    applyAdd(target, request.at, { kind: 'existing', name: request.name, resource: request.resource })
  }), [applyAdd, applyMove, files])

  useEffect(() => {
    const stop = onDraftChanged(({ files: next }) => setFiles(next))
    requestDraftReplay()
    return stop
  }, [])

  /**
   * Close the draft — and with it the sandbox.
   *
   * `payload.onClose` is the v2 teardown seam: it DELETEs the draft CRs snowplow was serving the
   * live render from. It is epoch-guarded upstream, so a payload replaced while this page was open
   * never double-tears-down. Clearing local state after it is what returns the honest empty state
   * rather than leaving a dead endpoint mounted.
   */
  /**
   * Publish — the same `runDraftPublish` the agent's verb takes, asked for by a person.
   *
   * The destination form and the blast-radius confirm both still run, so this button PROPOSES the
   * write; it does not perform one. What it removes is the detour: until now the only way to ship
   * a draft you had authored here was to go and ask the agent to emit a publish directive.
   */
  const publish = () => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`
    publishId.current = id
    setOutcome(null)
    setPublishing(true)
    emitPublishRequest({ id, verb: 'publishPage' })
  }

  const closeDraft = () => {
    payload?.onClose?.()
    setPayload(null)
    setEditVerdicts(null)
    setFiles({})
    setFocusPath(null)
  }

  return (
    <div className={styles.page}>
      {/* NEW_DRAFT_NAMESPACE, not a namespace read from the draft: there IS no draft yet, which is
          the whole point of this control. It matches what every Autopilot-published page already
          carries, so starting one here and asking the agent for one produce the same bytes. */}
      <StartDraftModal
        namespace={NEW_DRAFT_NAMESPACE}
        onCancel={() => setStarting(false)}
        onStart={(result) => {
          setStarting(false)
          emitDraftStart({ title: 'Page draft', widgets: result.widgets })
        }}
        open={starting}
      />
      <header className={styles.head}>
        <Typography.Title level={2} style={{ margin: 0 }}>Page composer</Typography.Title>
        <Typography.Paragraph style={{ margin: 0 }} type='secondary'>
          Author a page and everything it needs — widgets, layout and the RESTActions behind
          them — then publish the whole set as one change request.
        </Typography.Paragraph>
        {/* Closing is the sandbox TEARDOWN, which this page now owns: it took the claim, so the
            drawer that used to carry this control never opens here. Confirmed rather than
            immediate, because the draft is not recoverable and nothing else in view says so. */}
        {payload
          ? (
            <Space className={styles.actions}>
              <Button loading={publishing} onClick={publish} type='primary'>
                {publishing ? 'Publishing…' : 'Publish'}
              </Button>
              <Popconfirm
                cancelText='Keep editing'
                okText='Discard'
                onConfirm={closeDraft}
                title='Discard this draft? The sandbox and its unpublished files are deleted.'
              >
                <Button>Close draft</Button>
              </Popconfirm>
            </Space>
          )
          : null}
        {moveError
          ? (
            <Alert
              closable
              onClose={() => setMoveError(null)}
              showIcon
              title={moveError}
              type='warning'
            />
          )
          : null}
        {outcome
          ? (
            <Alert
              action={outcome.deepLink
                ? <Button href={outcome.deepLink} rel='noreferrer' target='_blank' type='link'>Open change request</Button>
                : null}
              closable
              onClose={() => setOutcome(null)}
              showIcon
              title={outcome.denial ?? 'Published — the change request is open for review.'}
              type={outcome.denial ? 'warning' : 'success'}
            />
          )
          : null}
      </header>

      {payload
        ? (
          /*
           * BUILD ABOVE, RESULT BELOW — and exactly one tab bar on the page.
           *
           * WHAT THIS REPLACES. The composer used to face two tab bars at each other: the preview
           * surface carried Rendered|Files|Source on the left, a rail carried Structure|Canvas on
           * the right. Neither named the same axis, nothing said which bar a given view lived in,
           * and the CANVAS — the thing you manipulate — was in the 320px rail while the read-mostly
           * preview held the wide column. The palette had to be folded into a wrapping strip above
           * the canvas just to fit beside it.
           *
           * THE ORDER NOW FOLLOWS THE WORK. The top row is the builder and everything in it is a
           * tool: pick something (palette), place it (canvas), operate on it (tree). All three are
           * mounted at once, which is not a preference — a drag cannot cross a tab boundary, so the
           * palette and the canvas MUST share a screen; and the tree is not a view of the canvas
           * but the keyboard-operable route to the same edits (move, wrap, add inside, remove,
           * bind), so hiding it behind a tab would take those controls away from anyone not using a
           * pointer. Below sits the one thing that is genuinely a set of VIEWS of the result, and
           * it keeps its own tab bar — now the only one.
           */
          <>
            <div className={styles.build}>
              <section className={styles.palette}>
                <Typography.Text strong>Add</Typography.Text>
                {/* A column, not a strip: the palette has a column of its own now, so it no longer
                    has to reflow its height to share one with the canvas. */}
                <PalettePanel
                  namespace={authoringNamespace}
                  onPick={setPick}
                  snowplowBaseUrl={snowplowBaseUrl}
                />
              </section>

              <section className={styles.canvas}>
                <Typography.Text strong>Layout</Typography.Text>
                <CanvasPanel files={files} onAdd={applyAdd} onMove={applyMove} onSelect={setFocusPath} pick={pick} />
              </section>

              {/* Draws its own box and heading — see .structure for why it is not wrapped in one. */}
              <div className={styles.structure}>
                <ObjectTreePanel files={files} onSelect={setFocusPath} snowplowBaseUrl={snowplowBaseUrl} />
              </div>
            </div>

            {/* Full width, because the live render is a page and a page wants the width. Selecting
                a node above still reveals its bytes in Files here — same `focusPath` as before. */}
            <div className={styles.result}>
              <PreviewContent editVerdicts={editVerdicts} focusPath={focusPath} onVerdicts={setEditVerdicts} payload={payload} />
            </div>
          </>
        )
        : (
          /*
           * An honest empty state rather than a fake canvas: nothing is being authored yet, and
           * saying so beats rendering an empty page that looks like a failed load.
           *
           * THROUGH `WidgetEmpty`, not a hand-rolled `<Empty>` — design rule C14. This page used to
           * roll its own because the shared one had no action slot and the state needs a "Start a
           * page" button; the slot was added rather than the rule worked around, so a future change
           * to the empty treatment reaches here too.
           *
           * ONE SENTENCE, because it used to say the same thing twice. The description ended
           * "...you review every file before it is published" and a second paragraph under the
           * button ended "...nothing is published until you submit the change request yourself" —
           * the same guarantee, restated. P16: say what to do next, do not fill space.
           */
          <WidgetEmpty
            description='No draft open. Start a page here, or ask Autopilot to draft one — either way you review every file before anything is published.'
          >
            <Button onClick={() => setStarting(true)} type='primary'>Start a page</Button>
          </WidgetEmpty>
        )}
    </div>
  )
}

export default PageComposer
