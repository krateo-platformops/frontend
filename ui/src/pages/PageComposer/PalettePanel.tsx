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
import { useDraggable } from '@dnd-kit/core'
import { Alert, Collapse, Empty, Input, Spin, Typography } from 'antd'
import { useEffect, useState } from 'react'

import { paletteDragId } from './dndIds'
import type { DragPayload } from './dndIds'
import { listPlaceableWidgets } from './placeableWidgets'
import type { PlaceableWidget } from './placeableWidgets'
import { LAYOUT_KINDS } from './structureEdit'
import { iconForResource } from './widgetIcons'
import { WIDGET_KINDS } from './widgetKinds.generated'

const { Text } = Typography

/** Derived once from the CRDs, not per render — the table is static for the life of the bundle. */
const containerKinds = Object.keys(WIDGET_KINDS).filter((kind) => WIDGET_KINDS[kind].container).sort()
const leafKinds = Object.keys(WIDGET_KINDS).filter((kind) => !WIDGET_KINDS[kind].container).sort()

/** What a palette drag is carrying. */
export type PalettePick =
  | { kind: 'container'; layout: keyof typeof LAYOUT_KINDS; resource: string }
  | { kind: 'existing'; name: string; resource: string }
  /**
   * CREATE a widget of this kind — the variant the palette did not have.
   *
   * Containers were CREATED and everything else was only ever REFERENCED, so a page could contain
   * the five layout kinds plus whatever widgets somebody had already authored on this cluster.
   * Nobody could make a new Statistic. That is why "support any widget the frontend supports"
   * could not be delivered by lengthening a list.
   *
   * It carries no bytes: thirty-seven of the forty-four kinds have required widgetData fields, so
   * what to write is not knowable at drag time. The drop asks, and `authored` is what comes back.
   */
  | { kind: 'new'; widgetKind: string; resource: string; authored?: Record<string, unknown>; name?: string }

/**
 * A palette row.
 *
 * `sub` is RENDERED beside the name; `plural` is only carried into the tooltip. A kind row passes
 * `plural`, an instance row passes `sub`, and the difference is whether the string tells anyone
 * anything: "Card · cards" spends a third of a 182px column restating the name, while "fleet-card ·
 * cards" is the only place that instance's kind appears. With the plural rendered on kind rows too,
 * the two competed for the column and the KIND lost — "ButtonGro…  buttongro…" — which is backwards,
 * since a plural is derivable from a kind name and a kind name is not derivable from a truncated
 * one. Filtering still matches on the plural either way: it reads the data, not the rendered text.
 */
const Item = ({ label, pick, plural, sub }: {
  label: string
  pick: PalettePick
  plural?: string
  sub?: string
}) => {
  const Glyph = iconForResource(pick.resource)
  // A BUTTON, not a bare draggable div. dnd-kit's `attributes` supply role, tabIndex and
  // aria-roledescription, so the item is reachable by keyboard and announced — where the old
  // `<div draggable>` had role:null, tabindex:null, aria-label:null and could not be tabbed to at
  // all. `listeners` carry both the pointer lift and the keyboard one.
  const { attributes, listeners, setNodeRef } = useDraggable({
    data: { from: 'palette', pick } satisfies DragPayload,
    id: paletteDragId(pick),
  })
  return (
    <div
      {...attributes}
      {...listeners}
      data-testid={`palette-item-${label}`}
      ref={setNodeRef}
      style={{
        alignItems: 'center',
        border: '1px solid var(--krateo-color-border-subtle)',
        borderRadius: 6,
        cursor: 'grab',
        display: 'flex',
        gap: 8,
        padding: '6px 8px',
      }}
      title={(sub ?? plural) ? `${label} \u00b7 ${sub ?? plural}` : label}
    >
      <Glyph />
      {/* nowrap HERE TOO. The plural below was fixed for this exact defect and the label was left
          with it: at the measured 182px column "ButtonGroup" rendered as "ButtonGrou" / "p" and
          "PageHeader" as "PageHeade" / "r" — every frame of both demo videos. Truncating with an
          ellipsis rather than wrapping keeps each item one row high, so the list stays scannable;
          `minWidth: 0` is what lets a flex child shrink far enough to ellipsize at all, and the
          title attribute now carries the full label so a truncated one is still recoverable. */}
      <Text style={{ flexShrink: 1, fontSize: 12, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</Text>
      {/* nowrap: at the measured 182px column the plural badge wrapped mid-word, rendering as
          "card" / "s" on two lines.

          SHRINKS FIRST, by a factor of a hundred. With the plural rigid, the 182px column gave it
          all the room it asked for and truncated the KIND instead — "ButtonGr…  buttongroups",
          which is backwards: a plural is derivable from a kind name, a kind name is not derivable
          from a truncated one. flex-shrink is a weight, so this makes the plural absorb essentially
          all the deficit while still degrading gracefully if a kind ever outgrows the column
          alone. */}
      {sub ? <Text style={{ flexShrink: 100, fontSize: 11, marginLeft: 'auto', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} type='secondary'>{sub}</Text> : null}
    </div>
  )
}

/* A COLUMN, always. The palette used to offer a wrapping-row mode, which existed for one reason:
   it had to share a 320px rail with the canvas, and a column would have pushed the canvas off the
   panel. The builder now gives the palette a column of its own, so the strip has nothing left to
   solve — and a list that reflows its height as you filter it was never the better read. */
const Section = ({ children, title }: { children: React.ReactNode; title: string }) => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
    <Text strong style={{ fontSize: 11, letterSpacing: 0.4, textTransform: 'uppercase' }} type='secondary'>{title}</Text>
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {children}
    </div>
  </div>
)

export const PalettePanel = ({ namespace, snowplowBaseUrl }: {
  /** The draft's namespace — existing widgets are listed from it. */
  namespace: string | null
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

  /**
   * ONE FILTER OVER EVERYTHING. The palette answers "what can I put on this page", and that used to
   * be a flat list of three hundred items on a real cluster — 16,793px of it. Capping the height
   * made it usable; it did not make it navigable, and the kind set has since grown from five to
   * forty-four. Matching on the name AND the plural is what lets someone who thinks in either
   * vocabulary find the same thing.
   */
  const [filter, setFilter] = useState('')
  const needle = filter.trim().toLowerCase()
  const matches = (name: string, plural: string): boolean =>
    !needle || name.toLowerCase().includes(needle) || plural.toLowerCase().includes(needle)

  const containers = containerKinds.filter((kind) => matches(kind, WIDGET_KINDS[kind].plural))
  const leaves = leafKinds.filter((kind) => matches(kind, WIDGET_KINDS[kind].plural))
  const instances = (existing ?? []).filter((widget) => matches(widget.name, widget.resource))

  /**
   * Instances are grouped by plural and behind a disclosure; KINDS are not.
   *
   * The two are different questions and only one of them scales. There are forty-four kinds and
   * that number moves when the chart does; there were two hundred and ninety-five instances on one
   * cluster and that number moves when anyone authors a widget. Showing every instance by default
   * is what made the source of a drag and its target impossible to see at the same time.
   */
  const grouped = new Map<string, PlaceableWidget[]>()
  for (const widget of instances) {
    grouped.set(widget.resource, [...(grouped.get(widget.resource) ?? []), widget])
  }

  return (
    <div data-testid='palette-panel' style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <Input
        allowClear
        aria-label='Filter the palette'
        onChange={(event) => setFilter(event.target.value)}
        placeholder='Filter by name or plural'
        size='small'
        value={filter}
      />

      {/*
        ELEVEN CONTAINERS, NOT FIVE, and thirty-three widgets that could not be created at all.
        Both lists come from the CRDs (see widgetKinds.generated) rather than from a literal, so a
        kind added to the chart appears here without anyone remembering to add it — and PageHeader,
        a container the composer has always treated as a leaf, is offered as one.
      */}
      {containers.length ? (
        <Section title={`Containers · ${containers.length}`}>
          {containers.map((kind) => (
            <Item
              key={kind}
              label={kind}
              pick={kind in LAYOUT_KINDS
                ? { kind: 'container', layout: kind as keyof typeof LAYOUT_KINDS, resource: WIDGET_KINDS[kind].plural }
                : { kind: 'new', resource: WIDGET_KINDS[kind].plural, widgetKind: kind }}
              plural={WIDGET_KINDS[kind].plural}
            />
          ))}
        </Section>
      ) : null}

      {/* CREATE, as opposed to PLACE — dropping one opens the form that asks what its CRD requires. */}
      {leaves.length ? (
        <Section title={`New widgets · ${leaves.length}`}>
          {leaves.map((kind) => (
            <Item
              key={kind}
              label={kind}
              pick={{ kind: 'new', resource: WIDGET_KINDS[kind].plural, widgetKind: kind }}
              plural={WIDGET_KINDS[kind].plural}
            />
          ))}
        </Section>
      ) : null}

      <Section title={`Existing widgets${instances.length ? ` · ${instances.length}` : ''}`}>
        {error ? <Alert message={error} showIcon type='warning' /> : null}
        {!error && existing === null ? <Spin size='small' /> : null}
        {!error && existing?.length === 0
          ? <Empty description='Nothing placeable here yet.' image={Empty.PRESENTED_IMAGE_SIMPLE} />
          : null}
        {/*
          Open when the filter has narrowed them, closed otherwise. A search that found something
          and then hid it behind a click is a search that did not answer.
        */}
        {grouped.size ? (
          <Collapse
            activeKey={needle ? [...grouped.keys()] : undefined}
            ghost
            items={[...grouped.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([plural, widgets]) => ({
              children: (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {widgets.map((widget) => (
                    <Item
                      key={`${widget.resource}/${widget.name}`}
                      label={widget.name}
                      pick={{ kind: 'existing', name: widget.name, resource: widget.resource }}
                      sub={widget.resource}
                    />
                  ))}
                </div>
              ),
              key: plural,
              label: `${plural} · ${widgets.length}`,
            }))}
            size='small'
          />
        ) : null}
      </Section>
    </div>
  )
}

export default PalettePanel
