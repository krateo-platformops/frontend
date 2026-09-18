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
import { Alert, Button, Empty, Popconfirm, Space, Tabs, Typography } from 'antd'
import { useCallback, useContext, useEffect, useRef, useState } from 'react'

import { AUTOPILOT_PREVIEW_EVENT } from '../../components/Autopilot/previewBus'
import type { AutopilotPreviewPayload } from '../../components/Autopilot/previewBus'
import { claimPreviewSurface, onDraftChanged, requestDraftReplay } from '../../components/Autopilot/previewDraftChanged'
import { emitDraftStart } from '../../components/Autopilot/previewDraftStart'
import { emitFileEdit } from '../../components/Autopilot/previewFileEdit'
import { emitPublishRequest, onPublishResult } from '../../components/Autopilot/previewPublishRequest'
import { PreviewContent } from '../../components/Autopilot/previewSurface'
import type { RestDefVerdicts } from '../../components/Autopilot/previewSurface'
import { ConfigContext } from '../../context/ConfigContext'

import CanvasPanel from './CanvasPanel'
import type { TreeNode } from './objectTree'
import ObjectTreePanel from './ObjectTreePanel'
import styles from './PageComposer.module.css'
import { planMove } from './planMove'
import StartDraftModal from './StartDraftModal'

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
          // Two columns: the surface (live render + files + verdicts) beside the tree that says
          // what the draft actually CONTAINS. The tree is derived from payload.files on every
          // render — see objectTree.ts for why it is never stored.
          <div className={styles.split}>
            <div className={styles.surface}>
              <PreviewContent editVerdicts={editVerdicts} focusPath={focusPath} onVerdicts={setEditVerdicts} payload={payload} />
            </div>
            <div className={styles.rail}>
              <Tabs
                items={[
                  // STRUCTURE FIRST, and it stays the default on purpose. The tree is the proven
                  // surface and the keyboard-operable one; the canvas is new and pointer-only, so
                  // it is offered rather than imposed. When it earns the default — an insertion
                  // index and a palette are what it is missing — that is a deliberate change, not
                  // a side effect of mounting it.
                  {
                    children: <ObjectTreePanel files={files} onSelect={setFocusPath} snowplowBaseUrl={snowplowBaseUrl} />,
                    key: 'structure',
                    label: 'Structure',
                  },
                  {
                    children: (
                      <div className={styles.canvasPane}>
                        <CanvasPanel files={files} onMove={applyMove} onSelect={setFocusPath} />
                      </div>
                    ),
                    key: 'canvas',
                    label: 'Canvas',
                  },
                ]}
              />
            </div>
          </div>
        )
        : (
          // An honest empty state rather than a fake canvas: nothing is being authored yet, and
          // saying so beats rendering an empty page that looks like a failed load.
          <Empty
            description={
              <span>
                No draft open. Start one, or ask Autopilot for a page — either way the draft
                lands here and you review every file before it is published.
              </span>
            }
            image={Empty.PRESENTED_IMAGE_SIMPLE}
          >
            <Button onClick={() => setStarting(true)} type='primary'>Start a page</Button>
            <Typography.Paragraph className={styles.hint} type='secondary'>
              Or ask Autopilot — either way the draft lands here and nothing is published until
              you submit the change request yourself.
            </Typography.Paragraph>
          </Empty>
        )}
    </div>
  )
}

export default PageComposer
