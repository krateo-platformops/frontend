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
import { Button, Empty, Typography } from 'antd'
import { useEffect, useState } from 'react'

import { AUTOPILOT_PREVIEW_EVENT } from '../../components/Autopilot/previewBus'
import type { AutopilotPreviewPayload } from '../../components/Autopilot/previewBus'
import { PreviewContent } from '../../components/Autopilot/previewSurface'
import type { RestDefVerdicts } from '../../components/Autopilot/previewSurface'

import styles from './PageComposer.module.css'

const PageComposer = () => {
  const [payload, setPayload] = useState<AutopilotPreviewPayload | null>(null)
  // Re-validated verdicts after an applied edit, so the Alert blocks reflect the latest draft
  // rather than the one that was first handed over. Same contract the drawer keeps.
  const [editVerdicts, setEditVerdicts] = useState<RestDefVerdicts | null>(null)

  // The SAME bus the drawer listens on. A preview proposed by Autopilot while this page is open
  // therefore lands here too — which is the point: one draft, two doors. Deliberately not a
  // separate channel; a second bus would be a second source of truth about what is being authored.
  useEffect(() => {
    const onPreview = (event: CustomEvent<AutopilotPreviewPayload>) => {
      setPayload(event.detail)
      setEditVerdicts(null)
    }
    window.addEventListener(AUTOPILOT_PREVIEW_EVENT, onPreview as EventListener)
    return () => window.removeEventListener(AUTOPILOT_PREVIEW_EVENT, onPreview as EventListener)
  }, [])

  return (
    <div className={styles.page}>
      <header className={styles.head}>
        <Typography.Title level={2} style={{ margin: 0 }}>Page composer</Typography.Title>
        <Typography.Paragraph style={{ margin: 0 }} type='secondary'>
          Author a page and everything it needs — widgets, layout and the RESTActions behind
          them — then publish the whole set as one change request.
        </Typography.Paragraph>
      </header>

      {payload
        ? (
          <PreviewContent editVerdicts={editVerdicts} onVerdicts={setEditVerdicts} payload={payload} />
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
            <Button disabled type='primary'>Start a page</Button>
            <Typography.Paragraph className={styles.hint} type='secondary'>
              Start-a-page lands next: it seeds an empty draft with a root Flex and a page header.
            </Typography.Paragraph>
          </Empty>
        )}
    </div>
  )
}

export default PageComposer
