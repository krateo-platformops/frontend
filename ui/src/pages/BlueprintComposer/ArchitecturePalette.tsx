/**
 * The Add pane — mockup screens 3, 4 and 5: what this person may place, in three classes, and the
 * form fields below them.
 *
 * WHAT IT READS, AND AS WHOM. The native kinds are a fixed table. The custom kinds and the installed
 * blueprints come from the portal's `blueprint-palette` RESTAction over snowplow `/call`, under the
 * person's own credential (blueprintPalette.ts) — so the pane lists exactly what they may list, and a
 * class they may not is a SENTENCE in its place, never an empty list that reads as "nothing here".
 * Read once per mount; a failure of the RESTAction itself is one sentence at the top, and the native
 * kinds still place.
 *
 * ONE GESTURE PLACES. Every row is a real `<button>`: Enter, Space or a click places its kind (C8).
 * There is no drag-to-place — the layout is dagre's, which discards where a drop landed. While the
 * CRD of a custom kind or a blueprint is read, its row is busy and says so. A kind already in the
 * chart is marked "✓ placed" in the faint token and stays a button: a chart may hold two.
 *
 * A REFUSAL IS SAID UNDER THE ROW THAT WAS REFUSED, not at the top of the pane: a row the person
 * scrolled down to reach (a composition, a kind inside an open group) would otherwise be refused
 * off-screen, and the click would seem to do nothing. Filtering or folding a group away clears it,
 * so it never ends up under a row that is no longer shown.
 *
 * GROUPS START CLOSED. 123 custom kinds in 29 groups is a list nobody reads; each group is a
 * disclosure button (`aria-expanded`), and a filter opens every group it matches.
 *
 * IT DIMS WHILE AN EDGE IS DRAWN (06:58): the pane is `aria-disabled` and says so, and a row does not
 * place — one gesture at a time, and the pending edge is planned from the chart as it is.
 *
 * ITS READ IS THE COMPOSER'S TOO (`onRead`): the readiness picker finds a node's CRD by the plural
 * this list carries, rather than reading the palette twice or pluralising a Kind.
 */
import { Alert, Input } from 'antd'
import { Fragment, useContext, useEffect, useId, useMemo, useRef, useState } from 'react'

import { ConfigContext } from '../../context/ConfigContext'

import type { ResourceNode } from './architecture'
import { counted } from './architectureView'
import styles from './BlueprintComposer.module.css'
import { readBlueprintPalette, type PaletteRead } from './blueprintPalette'
import { paletteModel, rowLabel, type PaletteRow } from './paletteModel'
import { FORM_FIELD_TYPES, type FormFieldType } from './schemaEdit'

const Section = ({ busy, children, count, title }: { busy?: boolean; children: React.ReactNode; count?: string; title: string }) => {
  const id = useId()
  return (
    <div aria-busy={busy ? 'true' : undefined} aria-labelledby={id} className={styles.paletteSection} role='group'>
      <div className={styles.paletteSectionHead}>
        <span className={styles.eyebrow} id={id}>{title}</span>
        {count ? <span className={styles.countPill}>{count}</span> : null}
      </div>
      {children}
    </div>
  )
}

const Row = ({ busy, nested, onPlace, row }: { busy: boolean; nested?: boolean; onPlace: (row: PaletteRow) => void; row: PaletteRow }) => (
  <button
    aria-busy={busy ? 'true' : undefined}
    aria-label={busy ? `${rowLabel(row)} · placing` : rowLabel(row)}
    className={nested ? `${styles.paletteRow} ${styles.paletteNested}` : styles.paletteRow}
    data-row={row.key}
    onClick={() => onPlace(row)}
    type='button'
  >
    <span className={styles.paletteKind}>{row.primary}</span>
    <span className={styles.paletteDetail}>
      {busy ? 'Placing…' : row.secondary}
      {row.placed ? <span className={styles.placedMark}>{' ✓ placed'}</span> : null}
    </span>
  </button>
)

/** Why a placement did not happen — and the row it is said under. */
export interface PlaceRefusal {
  key: string
  reason: string
}

export interface ArchitecturePaletteProps {
  /** The descriptor's nodes — what "✓ placed" counts. */
  resources: readonly Pick<ResourceNode, 'apiVersion' | 'kind'>[]
  /** Chart.yaml's name — the one blueprint that cannot be nested into itself. */
  chart: string | null
  /** The row whose placement is in flight, by key. */
  placing: string | null
  /** Why the last placement did not happen, and which row it was — or null. */
  refusal: PlaceRefusal | null
  onDismissRefusal: () => void
  onPlace: (row: PaletteRow) => void
  onFormField: (type: FormFieldType) => void
  /** An edge is being drawn or is pending: the pane dims and places nothing. */
  dimmed?: boolean
  /** The palette's read, once it lands — the readiness picker's source of plurals. */
  onRead?: (read: PaletteRead) => void
}

export const ArchitecturePalette = ({ chart, dimmed, onDismissRefusal, onFormField, onPlace, onRead, placing, refusal, resources }: ArchitecturePaletteProps) => {
  // `useContext`, not a throwing hook: the page mounts bare in tests, and a portal with no config
  // still places native kinds.
  const config = useContext(ConfigContext)?.config
  const base = config?.api?.SNOWPLOW_API_BASE_URL
  const namespace = config?.params?.FRONTEND_NAMESPACE
  const [read, setRead] = useState<PaletteRead | null>(null)
  const [filter, setFilter] = useState('')
  // Groups the person opened or closed by hand — forgotten when the filter changes, which opens
  // (or, cleared, closes) every group it matches.
  const [toggled, setToggled] = useState<Record<string, boolean>>({})

  // Read through a ref: a new callback is not a reason to read the palette again.
  const readRef = useRef(onRead)
  readRef.current = onRead
  useEffect(() => {
    let live = true
    void readBlueprintPalette(base, namespace).then((answer) => {
      if (!live) { return }
      setRead(answer)
      readRef.current?.(answer)
    })
    return () => { live = false }
  }, [base, namespace])

  const model = useMemo(() => paletteModel(read, filter, resources, chart), [chart, filter, read, resources])
  const filtering = !!model.filter
  const expanded = (group: string): boolean =>
    (Object.prototype.hasOwnProperty.call(toggled, group) ? toggled[group] : filtering)
  const changeFilter = (next: string) => {
    setFilter(next)
    setToggled({})
    if (refusal) { onDismissRefusal() }
  }
  const toggle = (group: string) => {
    setToggled((last) => ({ ...last, [group]: !expanded(group) }))
    if (refusal) { onDismissRefusal() }
  }
  const row = (entry: PaletteRow, nested?: boolean) => (
    <Fragment key={entry.key}>
      <Row busy={placing === entry.key} nested={nested} onPlace={(picked) => { if (!dimmed) { onPlace(picked) } }} row={entry} />
      {refusal?.key === entry.key ? <Alert closable onClose={onDismissRefusal} showIcon title={refusal.reason} type='error' /> : null}
    </Fragment>
  )

  const { compositions, custom } = model
  // How many groups the filter opened — no suffix at none, where "Nothing matches" or the rows speak.
  // `custom.groups` is empty unless the custom read answered, so this is also the read's check.
  const groupsMatch = filtering ? custom.groups.length : 0
  return (
    <section aria-label='Add' className={`${styles.pane} ${styles.palettePane}`}>
      <div className={styles.paneHead}>
        <span className={styles.paneTitle}>Add</span>
      </div>
      {dimmed ? <p className={styles.paletteDimmed}>Palette dims while an edge is being drawn.</p> : null}
      {/* A group, so it can be aria-disabled — a region cannot. */}
      <div
        aria-disabled={dimmed ? 'true' : undefined}
        aria-label='Palette'
        className={dimmed ? `${styles.paletteBody} ${styles.paletteBodyDimmed}` : styles.paletteBody}
        role='group'
      >
        <Input
          allowClear
          aria-label='Filter by kind or group'
          onChange={(event) => changeFilter(event.target.value)}
          placeholder='Filter by kind or group'
          size='small'
          suffix={groupsMatch ? <span className={styles.paletteMatches}>{`${counted(groupsMatch, 'group')} ${groupsMatch === 1 ? 'matches' : 'match'}`}</span> : undefined}
          value={filter}
        />
        {read?.unavailable ? <p className={styles.paletteNote}>{read.unavailable}</p> : null}
        {model.nothingMatches ? <p className={styles.fieldText}>{`Nothing matches “${model.filter}”.`}</p> : null}

        <Section count={String(model.native.length)} title='Kubernetes native'>
          {model.native.map((entry) => row(entry))}
        </Section>

        {read?.unavailable ? null : (
          <Section busy={custom.state === 'loading'} count={custom.state === 'ok' ? `${custom.kinds} kinds · ${custom.groupCount} groups` : undefined} title='Custom resources'>
            {custom.state === 'loading' ? <p className={styles.fieldText}>Listing what you may place…</p> : null}
            {custom.sentence ? <p className={styles.paletteNote}>{custom.sentence}</p> : null}
            {custom.state === 'ok' && !custom.kinds ? <p className={styles.fieldText}>No custom resources are installed here that a composition can place.</p> : null}
            {custom.groups.map((group) => (
              <div className={styles.paletteGroup} key={group.group}>
                <button
                  aria-expanded={expanded(group.group)}
                  className={styles.paletteGroupHead}
                  onClick={() => toggle(group.group)}
                  type='button'
                >
                  <span aria-hidden='true'>{expanded(group.group) ? '▾' : '▸'}</span>
                  <span className={styles.paletteGroupName}>{group.group}</span>
                  <span className={styles.countPill}>{group.owner ? `${group.owner} · ${group.total}` : String(group.total)}</span>
                </button>
                {expanded(group.group) ? group.rows.map((entry) => row(entry, true)) : null}
              </div>
            ))}
            {custom.clusterScoped ? (
              <p className={styles.fieldText}>
                {`${counted(custom.clusterScoped, 'cluster-scoped kind')} ${custom.clusterScoped === 1 ? 'is' : 'are'} not listed: a composition's resources live in its own namespace.`}
              </p>
            ) : null}
          </Section>
        )}

        {read?.unavailable ? null : (
          <Section busy={compositions.state === 'loading'} count={compositions.state === 'ok' ? `${compositions.installed} installed` : undefined} title='Krateo compositions'>
            {compositions.state === 'loading' ? <p className={styles.fieldText}>Listing what you may place…</p> : null}
            {compositions.sentence ? <p className={styles.paletteNote}>{compositions.sentence}</p> : null}
            {compositions.state === 'ok' && !compositions.installed ? (
              <p className={styles.fieldText}>No blueprints are installed here yet. Publish and register one, and it can be nested here.</p>
            ) : null}
            {compositions.rows.map((entry) => row(entry))}
            {compositions.selfNesting ? (
              <p className={styles.note}>
                {`Nesting the chart you are composing (${compositions.selfNesting} into ${compositions.selfNesting}) is refused as a cycle when you try it — the same kernel that refuses a cyclic edge.`}
              </p>
            ) : null}
          </Section>
        )}

        <div className={styles.paletteSecondary}>
          <Section title='Form fields'>
            <div className={styles.paletteFields}>
              {FORM_FIELD_TYPES.map((field) => (
                <button className={styles.paletteField} disabled={dimmed} key={field.type} onClick={() => onFormField(field.type)} type='button'>{field.label}</button>
              ))}
            </div>
          </Section>
        </div>
      </div>
    </section>
  )
}

export default ArchitecturePalette
