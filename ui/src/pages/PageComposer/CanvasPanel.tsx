/**
 * The draft as nested FRAMES — the canvas, read-only.
 *
 * Stage 3 of drag & drop, and deliberately the stage with no interaction: it exists to prove the
 * PROJECTION before anything is draggable. If the canvas and the Files tab can disagree, that has
 * to surface while the only thing at stake is a rendering.
 *
 * A VIEW, NOT A MODEL — the same rule `ObjectTreePanel` states and for the same reason. Every frame
 * is derived from the draft's bytes by `buildObjectTree` on each render. Nothing is cached and no
 * structure is stored beside the files, because the Files tab can rewrite any file and a structure
 * kept alongside would be stale the moment it did, in a way nothing would report.
 *
 * WHY A SECOND VIEW AT ALL, given the tree already exists. They answer different questions. The
 * tree answers "what contains what" and is the keyboard-operable path; the canvas answers "what
 * will this look like", which is the question a person composing a page actually has. Both derive
 * from the same `buildObjectTree`, so they cannot drift — and #297's `legalTargets` will drive
 * both, so a drop behaves identically wherever it is made.
 *
 * STAGE 4 ADDS DRAG. The canvas now reports one gesture — "this node was dropped on that
 * container" — and nothing more. It does NOT decide whether the drop is allowed and does NOT
 * rewrite any file: `planMove` owns both, so the tree and the canvas cannot drift into disagreeing
 * about what a drop means. What the canvas DOES own is showing which containers will accept the
 * thing currently in the air, and it asks the same `legalTargets` that will later judge the drop —
 * so a well that lights up is a well that accepts, by construction rather than by coincidence.
 *
 * STILL ABSENT: selection-to-edit, and any keyboard path for moving a node. Dragging is a
 * pointer-only gesture, so the tree remains the accessible route and must keep its move controls.
 */
import { Empty, Tag, Tooltip, Typography } from 'antd'
import { Fragment, useMemo, useState } from 'react'

import { legalTargets } from './dropTargets'
import { buildObjectTree } from './objectTree'
import type { TreeNode } from './objectTree'
import { LAYOUT_KINDS } from './structureEdit'

const { Text } = Typography

const isContainer = (kind: string | null): boolean =>
  !!kind && Object.prototype.hasOwnProperty.call(LAYOUT_KINDS, kind)

/**
 * One frame. Containers get a dashed well their children sit inside, so nesting is visible as
 * containment rather than as indentation — which is the whole point of showing a canvas next to a
 * tree that already indents perfectly well.
 */
/** External stays dimmed; the node currently in the air dims further so the gap it leaves reads. */
const frameOpacity = (external: boolean, isDragging: boolean): number => {
  if (external) { return 0.6 }
  return isDragging ? 0.4 : 1
}

/** A node can be dragged only if its parent addresses it — a root is placed by nothing. */
const isMovable = (node: TreeNode): boolean =>
  node.drafted && !!node.parentPath && node.refId !== null && node.position !== null

/**
 * The seam between two children — and the only way to say WHERE something lands.
 *
 * Without these a drop can only mean "into this container", which `placeChild` appends: every move
 * ends up last, and reordering is impossible. The gap names an index measured against the list as
 * it is drawn, which is also how a person reads it; `reparentChild` owns the correction for the
 * fact that a same-parent move removes before it places.
 *
 * It stays in the layout at zero-ish height rather than appearing on drag, so nothing reflows
 * under the pointer mid-gesture — a target that moves as you approach it is worse than none.
 */
const DropGap = ({ at, container, live, onDrop }: {
  at: number
  /** Names the container, so a gap is identifiable in a nested page rather than ambiguous. */
  container: string
  live: boolean
  onDrop: (at: number) => void
}) => (
  <div
    data-testid={`canvas-gap-${container}-${at}`}
    onDragOver={live
      ? (event) => {
        event.preventDefault()
        event.stopPropagation()
      }
      : undefined}
    onDrop={live
      ? (event) => {
        event.preventDefault()
        event.stopPropagation()
        onDrop(at)
      }
      : undefined}
    style={{
      background: live ? 'var(--krateo-canvas-accept, #11B2E2)' : 'transparent',
      borderRadius: 2,
      height: live ? 3 : 2,
      opacity: live ? 0.45 : 0,
    }}
  />
)

const Frame = ({ depth, dragging, legal, node, onDragEnd, onDragStart, onDrop, onSelect }: {
  depth: number
  dragging: TreeNode | null
  legal: ReadonlySet<TreeNode>
  node: TreeNode
  onDragEnd: () => void
  onDragStart: (node: TreeNode) => void
  onDrop: (target: TreeNode, at?: number) => void
  onSelect?: (path: string | null) => void
}) => {
  const container = isContainer(node.kind)
  const movable = isMovable(node)
  // Asked of the SAME function that will judge the drop, so the highlight cannot promise something
  // the drop then refuses.
  const accepts = !!dragging && legal.has(node)
  // A node the draft does not carry is an existing cluster widget: it renders, but it has no file,
  // so it can never be edited here. Saying so is honest and it is also exactly why `canAccept`
  // refuses it as a drop target (#297).
  const external = !node.drafted

  return (
    <div
      data-accepts={accepts ? 'yes' : undefined}
      data-testid={`canvas-frame-${node.name}`}
      draggable={movable}
      onDragEnd={movable ? onDragEnd : undefined}
      onDragStart={movable
        ? (event) => {
          // Without this the drag bubbles to every ancestor frame and the outermost one wins, so
          // dragging a card would move the page.
          event.stopPropagation()
          onDragStart(node)
        }
        : undefined}
      style={{
        background: external ? 'transparent' : 'var(--krateo-canvas-frame-bg, rgba(127,127,127,0.04))',
        border: `1px ${container ? 'dashed' : 'solid'} ${accepts ? 'var(--krateo-canvas-accept, #11B2E2)' : 'rgba(127,127,127,0.35)'}`,
        borderRadius: 8,
        cursor: movable ? 'grab' : 'default',
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        opacity: frameOpacity(external, dragging === node),
        padding: 10,
      }}
    >
      <div style={{ alignItems: 'center', display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        <Text
          onClick={node.path ? () => onSelect?.(node.path) : undefined}
          strong
          style={{ cursor: node.path ? 'pointer' : 'default' }}
        >
          {node.kind ?? 'unresolved'}
        </Text>
        <Text style={{ fontSize: 12 }} type='secondary'>{node.name}</Text>
        {node.bound ? (
          <Tooltip title='reads its data from a RESTAction (spec.apiRef)'>
            <Tag color='cyan'>data</Tag>
          </Tooltip>
        ) : null}
        {external ? (
          <Tooltip title='referenced but not carried in this draft — an existing cluster widget'>
            <Tag>external</Tag>
          </Tooltip>
        ) : null}
      </div>

      {container ? (
        <div
          data-testid={`canvas-well-${node.name}`}
          onDragOver={accepts
            ? (event) => {
              // preventDefault is what MAKES an element a drop target. Calling it only when the
              // well accepts means an illegal container refuses the drop at the browser level —
              // the cursor says "no" before anyone lets go.
              event.preventDefault()
              event.stopPropagation()
            }
            : undefined}
          onDrop={accepts
            ? (event) => {
              event.preventDefault()
              event.stopPropagation()
              onDrop(node)
            }
            : undefined}
          style={{
            background: accepts ? 'var(--krateo-canvas-accept-bg, rgba(17,178,226,0.08))' : undefined,
            borderRadius: 6,
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
            minHeight: 28,
            paddingLeft: 10,
          }}
        >
          {node.children.length === 0 ? <Text style={{ fontSize: 12 }} type='secondary'>empty</Text> : null}
          <DropGap at={0} container={node.name} live={accepts} onDrop={(at) => onDrop(node, at)} />
          {node.children.map((child, index) => (
            <Fragment key={`${child.name}-${child.refId ?? index}-${index}`}>
              <Frame
                depth={depth + 1}
                dragging={dragging}
                legal={legal}
                node={child}
                onDragEnd={onDragEnd}
                onDragStart={onDragStart}
                onDrop={onDrop}
                onSelect={onSelect}
              />
              <DropGap at={index + 1} container={node.name} live={accepts} onDrop={(at) => onDrop(node, at)} />
            </Fragment>
          ))}
        </div>
      ) : null}
    </div>
  )
}

/**
 * The canvas. `files` is the held draft — the same input the tree takes, so the two cannot be given
 * different pictures of the same page.
 */
export const CanvasPanel = ({ files, onMove, onSelect }: {
  files: Record<string, string>
  /**
   * A completed gesture: `moving` was dropped on `target`, within `roots`.
   *
   * `roots` is handed over deliberately rather than left for the consumer to rebuild. `legalTargets`
   * compares nodes by REFERENCE, so a consumer that called `buildObjectTree` again would hold nodes
   * that are equal in every field and identical to none — and every move would be refused as
   * illegal, for a reason no message could explain. Passing the tree these nodes came from keeps
   * the identity intact.
   *
   * The consumer must still run `planMove`: that is what produces the bytes, and it re-checks,
   * because the canvas's `legal` set is a render-time snapshot.
   */
  onMove?: (moving: TreeNode, target: TreeNode, roots: readonly TreeNode[], at?: number) => void
  onSelect?: (path: string | null) => void
}) => {
  const roots = useMemo(() => buildObjectTree(files), [files])
  const [dragging, setDragging] = useState<TreeNode | null>(null)

  // Recomputed per drag, not per render: the answer depends on what is in the air.
  const legal = useMemo(
    () => new Set(dragging?.resource ? legalTargets(roots, { node: dragging, plural: dragging.resource }) : []),
    [dragging, roots],
  )

  if (roots.length === 0) {
    return <Empty description='Nothing to render yet — the draft carries no page root.' image={Empty.PRESENTED_IMAGE_SIMPLE} />
  }

  const finish = () => setDragging(null)

  return (
    <div data-testid='canvas-panel' style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {roots.map((root, index) => (
        <Frame
          depth={0}
          dragging={dragging}
          key={`${root.name}-${index}`}
          legal={legal}
          node={root}
          onDragEnd={finish}
          onDragStart={setDragging}
          onDrop={(target, at) => {
            if (dragging && dragging !== target) {
              onMove?.(dragging, target, roots, at)
            }
            finish()
          }}
          onSelect={onSelect}
        />
      ))}
    </div>
  )
}

export default CanvasPanel
