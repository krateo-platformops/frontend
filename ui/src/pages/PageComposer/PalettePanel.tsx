/**
 * The palette: what can be added to a page, as drag sources.
 *
 * TWO KINDS OF THING, and they are genuinely different rather than two lists for symmetry:
 *
 *   CONTAINERS are CREATED. Dropping one writes a new file into the draft (`newContainerYaml`) and
 *   places a reference to it. There are exactly five and they are known at build time.
 *
 *   EXISTING WIDGETS are PLACED. Dropping one writes no file at all — it adds a reference to a CR
 *   that is already on the cluster. The set is whatever THIS user may list, resolved per session by
 *   `listPlaceableWidgets`, whose authorization is the caller's own credential (see that module).
 *
 * The tree already offers both through modals ("Add inside", "Place inside"). This is the same two
 * capabilities as a gesture, so the palette must not quietly offer a NARROWER set than the modal
 * does — it reads the same source for the same reason that module's header gives.
 *
 * DRAG STATE IS LIFTED, not carried in dataTransfer. The canvas already tracks what is in the air
 * as React state, and a second mechanism for the same question would be two things to keep in step;
 * `onPick`/`onDrop` hand the choice to the composer, which owns both panels.
 *
 * WHAT THIS STAGE DOES NOT DO: the drop itself. The canvas accepts TreeNodes today, and teaching it
 * a second payload is its own change — done here, the palette would look finished while dropping
 * did nothing, which is worse than a panel that plainly has no target yet.
 */
import { Alert, Empty, Spin, Typography } from 'antd'
import { useEffect, useState } from 'react'

import { listPlaceableWidgets } from './placeableWidgets'
import type { PlaceableWidget } from './placeableWidgets'
import { LAYOUT_KINDS } from './structureEdit'
import { iconForResource } from './widgetIcons'

const { Text } = Typography

/** What a palette drag is carrying. */
export type PalettePick =
  | { kind: 'container'; layout: keyof typeof LAYOUT_KINDS; resource: string }
  | { kind: 'existing'; name: string; resource: string }

const Item = ({ label, onPick, pick, sub }: {
  label: string
  onPick?: (pick: PalettePick) => void
  pick: PalettePick
  sub?: string
}) => {
  const Glyph = iconForResource(pick.resource)
  return (
    <div
      data-testid={`palette-item-${label}`}
      draggable
      onDragEnd={() => onPick?.(pick)}
      onDragStart={() => onPick?.(pick)}
      style={{
        alignItems: 'center',
        border: '1px solid rgba(127,127,127,0.25)',
        borderRadius: 6,
        cursor: 'grab',
        display: 'flex',
        gap: 8,
        padding: '6px 8px',
      }}
      title={sub ?? label}
    >
      <Glyph />
      <Text style={{ fontSize: 12 }}>{label}</Text>
      {sub ? <Text style={{ fontSize: 11, marginLeft: 'auto' }} type='secondary'>{sub}</Text> : null}
    </div>
  )
}

const Section = ({ children, title }: { children: React.ReactNode; title: string }) => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
    <Text strong style={{ fontSize: 11, letterSpacing: 0.4, textTransform: 'uppercase' }} type='secondary'>{title}</Text>
    {children}
  </div>
)

export const PalettePanel = ({ namespace, onPick, snowplowBaseUrl }: {
  /** The draft's namespace — existing widgets are listed from it. */
  namespace: string | null
  onPick?: (pick: PalettePick) => void
  snowplowBaseUrl?: string
}) => {
  const [existing, setExisting] = useState<PlaceableWidget[] | null>(null)
  // A string, not a boolean: the reason is the content when the list cannot be had. An empty picker
  // that does not say why is the failure worth avoiding, as placeableWidgets' own header argues.
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!snowplowBaseUrl || !namespace) {
      return
    }
    let live = true
    void listPlaceableWidgets(snowplowBaseUrl, namespace).then((result) => {
      if (!live) {
        return
      }
      if (result.ok) {
        setExisting(result.widgets)
        setError(null)
      } else {
        setError(result.error)
      }
    })
    return () => { live = false }
  }, [namespace, snowplowBaseUrl])

  return (
    <div data-testid='palette-panel' style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <Section title='Containers'>
        {(Object.keys(LAYOUT_KINDS) as (keyof typeof LAYOUT_KINDS)[]).map((layout) => (
          <Item
            key={layout}
            label={layout}
            onPick={onPick}
            pick={{ kind: 'container', layout, resource: LAYOUT_KINDS[layout] }}
          />
        ))}
      </Section>

      <Section title='Existing widgets'>
        {error ? <Alert message={error} showIcon type='warning' /> : null}
        {!error && existing === null ? <Spin size='small' /> : null}
        {!error && existing?.length === 0
          ? <Empty description='Nothing placeable here yet.' image={Empty.PRESENTED_IMAGE_SIMPLE} />
          : null}
        {(existing ?? []).map((widget) => (
          <Item
            key={`${widget.resource}/${widget.name}`}
            label={widget.name}
            onPick={onPick}
            pick={{ kind: 'existing', name: widget.name, resource: widget.resource }}
            sub={widget.resource}
          />
        ))}
      </Section>
    </div>
  )
}

export default PalettePanel
