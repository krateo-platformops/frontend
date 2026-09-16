/**
 * "Place existing" — put a widget that is already on the cluster onto this page.
 *
 * THE SAFE HALF OF THE OLD BUILDER, KEPT. `form.compose-page` could only arrange widgets that
 * already existed, and that limitation was also its virtue: those widgets are already wired to
 * their own data, so a page built from them works. Retiring that card must not take the capability
 * with it, and this offers the SAME set — `page-composable`'s seven composable plurals, read under
 * the caller's own RBAC.
 *
 * WHAT IT ADDS OVER THE CARD. The card appended to a flat list. This inserts into the container you
 * picked in the tree, which is the whole difference between arranging a page and composing one.
 *
 * A LIST, NOT A SEARCH BOX. The realistic corpus is tens of widgets, not thousands; antd's Select
 * already filters as you type. A search endpoint would be machinery for a problem nobody has.
 */
import { Alert, Modal, Select, Typography } from 'antd'
import { useEffect, useState } from 'react'

import { listPlaceableWidgets } from './placeableWidgets'
import type { PlaceableWidget } from './placeableWidgets'

export const PlaceWidgetModal = ({ into, namespace, onCancel, onPlace, open, snowplowBaseUrl }: {
  /** Display name of the container the widget lands in — so the title says where. */
  into: string
  /** Namespace the listed widgets live in, and the one their ref entry must carry. */
  namespace: string
  onCancel: () => void
  onPlace: (widget: PlaceableWidget) => void
  open: boolean
  snowplowBaseUrl: string
}) => {
  const [widgets, setWidgets] = useState<PlaceableWidget[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [chosen, setChosen] = useState<string | null>(null)

  // Fetched on OPEN, not on mount: the list is only needed once someone asks to place something,
  // and a page that queries the cluster just for being open is a page that costs something to look
  // at. Re-fetched each time, because a widget authored since the last open should appear.
  useEffect(() => {
    if (!open) {
      return
    }
    setWidgets(null)
    setError(null)
    setChosen(null)
    let live = true
    void listPlaceableWidgets(snowplowBaseUrl, namespace).then((result) => {
      if (!live) {
        return
      }
      if (result.ok) {
        setWidgets(result.widgets)
      } else {
        setError(result.error)
      }
    })
    return () => { live = false }
  }, [namespace, open, snowplowBaseUrl])

  const submit = () => {
    const widget = widgets?.find((entry) => `${entry.resource}/${entry.name}` === chosen)
    if (!widget) {
      setError('pick a widget to place')
      return
    }
    onPlace(widget)
  }

  return (
    <Modal
      okButtonProps={{ disabled: !chosen }}
      okText='Place'
      onCancel={onCancel}
      onOk={submit}
      open={open}
      title={`Place a widget inside ${into}`}
      width={560}
    >
      <Typography.Paragraph type='secondary'>
        Widgets already on the cluster, each already wired to its own data. Only the ones you have
        permission to read are listed.
      </Typography.Paragraph>
      <Select
        loading={widgets === null && !error}
        onChange={setChosen}
        optionFilterProp='label'
        // The value carries the plural because the parent must declare it to render the child —
        // the same `<plural>/<name>` pairing `form.compose-page` uses, for the same reason.
        options={(widgets ?? []).map((widget) => ({
          label: `${widget.name} · ${widget.resource}`,
          value: `${widget.resource}/${widget.name}`,
        }))}
        placeholder={widgets === null ? 'Loading…' : 'Choose a widget'}
        showSearch
        style={{ width: '100%' }}
        value={chosen}
        // Virtualization off: `page-composable` returns one namespace's composable widgets — tens,
        // not thousands — so it buys nothing here, and rc-virtual-list needs a measured height it
        // never gets under jsdom, which makes the control impossible to drive in a test.
        virtual={false}
      />
      {widgets?.length === 0 && !error
        ? (
          <Alert
            showIcon
            style={{ marginBlockStart: 12 }}
            title='No composable widgets exist in this namespace yet. Author one, or bind data to create a table.'
            type='info'
          />
        )
        : null}
      {error ? <Alert showIcon style={{ marginBlockStart: 12 }} title={error} type='error' /> : null}
    </Modal>
  )
}

export default PlaceWidgetModal
