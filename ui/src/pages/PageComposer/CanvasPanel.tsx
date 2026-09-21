/**
 * The draft as nested FRAMES — the canvas.
 *
 * A VIEW, NOT A MODEL — the same rule `ObjectTreePanel` states and for the same reason. Every frame
 * is derived from the draft's bytes by `buildObjectTree` on each render. Nothing is cached and no
 * structure is stored beside the files, because the Files tab can rewrite any file and a structure
 * kept alongside would be stale the moment it did, in a way nothing would report.
 *
 * WHY A SECOND VIEW AT ALL, given the tree already exists. They answer different questions. The
 * tree answers "what contains what"; the canvas answers "what will this look like", which is the
 * question a person composing a page actually has. Both derive from the same `buildObjectTree`, so
 * they cannot drift — and both consult `legalTargets`, so a drop behaves identically wherever made.
 *
 * WHY dnd-kit AND NOT NATIVE HTML5 DRAG. The canvas used the browser's own drag, and four of its
 * properties turned out to be defects rather than trade-offs:
 *
 *   1. AN ILLEGAL DROP COULD NOT SPEAK. `preventDefault` on `dragover` is what makes an element a
 *      drop target, so declining to call it — the correct mechanic — meant `drop` never fired on an
 *      illegal container. Every refusal `planAdd`/`planMove` computes ("x cannot hold a cards") was
 *      structurally unreachable from a drag; the only signal was an absent highlight among several
 *      present ones. Here every container is a droppable and the KERNEL refuses, so the reason
 *      reaches the person who made the gesture. That is the whole reason for this change.
 *   2. NOTHING WORKED ON TOUCH. Native DnD does not fire on a coarse pointer at all, so the canvas
 *      was inert on a tablet. dnd-kit's PointerSensor is pointer-events based and does.
 *   3. THERE WAS NO KEYBOARD PATH. Not one of 80 tab stops landed in the canvas. KeyboardSensor
 *      gives lift/move/drop on Space and the arrow keys, with announcements. The TREE's claim to be
 *      the keyboard route is now true as well: it restores focus after an edit and writes every
 *      outcome into the composer's live region, neither of which it did when the claim was written.
 *   4. THE DRAG IMAGE WAS THE ELEMENT. The browser's default ghost is a translucent copy of the
 *      whole subtree, which covered the very drop targets it was being aimed at. `DragOverlay`
 *      renders a small chip instead.
 *
 * The kernel is untouched by all of it: `planAdd`, `planMove` and `canAccept` decide exactly as
 * before, and this file still owns nothing but "which gesture happened".
 *
 * ONE CURRENT TARGET, plus the legal set. The old canvas lit every legal well and every gap at once
 * — six candidate destinations with no indication which one the pointer was over. Showing the legal
 * SET and showing the CURRENT TARGET are different messages and both are wanted, so they are drawn
 * differently: legal containers get a faint tint, the one under the pointer gets a solid ring.
 */
import { useDraggable, useDroppable } from '@dnd-kit/core'
import { Empty, Tag, Tooltip, Typography } from 'antd'
import { Fragment, useMemo } from 'react'

import { gapDropId, nodeDragId, wellDropId } from './dndIds'
import type { DragPayload, DropPayload } from './dndIds'
import { legalTargets } from './dropTargets'
import { buildObjectTree } from './objectTree'
import type { TreeNode } from './objectTree'
import { LAYOUT_KINDS } from './structureEdit'

const { Text } = Typography

const isContainer = (kind: string | null): boolean =>
  !!kind && Object.prototype.hasOwnProperty.call(LAYOUT_KINDS, kind)

/** External stays dimmed; the node currently in the air dims further so the gap it leaves reads. */
const frameOpacity = (external: boolean, isDragging: boolean): number => {
  if (external) { return 0.6 }
  return isDragging ? 0.4 : 1
}

/** A node can be dragged only if its parent addresses it — a root is placed by nothing. */
/** grab when it can be dragged, pointer when it can only be selected, default when neither. */
const handleCursor = (movable: boolean, selectable: boolean): string => {
  if (movable) { return 'grab' }
  return selectable ? 'pointer' : 'default'
}

const isMovable = (node: TreeNode): boolean =>
  node.drafted && !!node.parentPath && node.refId !== null && node.position !== null

/**
 * The seam between two children — and the only way to say WHERE something lands.
 *
 * Without these a drop can only mean "into this container", which `placeChild` appends: every move
 * ends up last, and reordering is impossible.
 *
 * THE HIT AREA IS 24px; THE INK IS 3px. It was 3px of both, and that was measured to convert a 6px
 * aiming error into a silent change of meaning — "insert at position 1" became "append last", with
 * nothing in the feedback distinguishing them. WCAG 2.5.8 asks 24px. The padding/negative-margin
 * pair grows the target while leaving the laid-out height byte-identical, which preserves the
 * property the old comment cared about: nothing reflows under the pointer mid-gesture.
 */
const DropGap = ({ at, container, live, node }: {
  at: number
  /** Names the container, so a gap is identifiable in a nested page rather than ambiguous. */
  container: string
  /** Something is in the air. Gaps are inert otherwise — they are not affordances at rest. */
  live: boolean
  node: TreeNode
}) => {
  const { isOver, setNodeRef } = useDroppable({
    data: { at: 'gap', index: at, node } satisfies DropPayload,
    disabled: !live,
    id: gapDropId(node, at),
  })
  return (
    <div
      data-over={isOver ? 'yes' : undefined}
      data-testid={`canvas-gap-${container}-${at}`}
      ref={setNodeRef}
      style={{
        // The target, not the ink: 24px tall and invisible, pulled back out of the layout.
        marginBlock: live ? -11 : 0,
        paddingBlock: live ? 11 : 0,
      }}
    >
      <div
        style={{
          background: isOver ? 'var(--krateo-color-action-primary)' : 'transparent',
          borderRadius: 2,
          height: live ? 3 : 2,
          opacity: isOver ? 1 : 0,
        }}
      />
    </div>
  )
}

/** The well — a drop INTO this container. Droppable even when illegal, so the kernel can say why. */
const Well = ({ accepts, children, live, node }: {
  accepts: boolean
  children: React.ReactNode
  live: boolean
  node: TreeNode
}) => {
  const { isOver, setNodeRef } = useDroppable({
    data: { at: 'well', node } satisfies DropPayload,
    // DELIBERATELY NOT `disabled: !accepts`. A disabled droppable is invisible to collision
    // detection, so an illegal drop would land on whatever is behind it — usually an ancestor that
    // DOES accept — and silently do something the person did not ask for. Enabled-and-refused is
    // both truthful and the only way the refusal reason gets spoken.
    disabled: !live,
    id: wellDropId(node),
  })
  let ring = 'transparent'
  if (isOver) {
    ring = accepts ? 'var(--krateo-color-action-primary)' : 'var(--krateo-color-status-error)'
  }
  return (
    <div
      data-accepts={accepts ? 'yes' : undefined}
      data-over={isOver ? 'yes' : undefined}
      data-testid={`canvas-well-${node.name}`}
      ref={setNodeRef}
      style={{
        // The legal SET is a faint tint; the CURRENT target is a ring. Two messages, two channels.
        background: live && accepts ? 'var(--krateo-color-background-selected)' : undefined,
        borderRadius: 6,
        boxShadow: `inset 0 0 0 2px ${ring}`,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        minHeight: 28,
        paddingLeft: 12,
      }}
    >
      {children}
    </div>
  )
}

const Frame = ({ airborne, depth, draggingId, legal, node, onSelect }: {
  /** Something is in the air — a node being moved OR a palette pick. The highlight asks this rather
   *  than the dragged node, because a pick has no node and would otherwise light nothing up. */
  airborne: boolean
  depth: number
  draggingId: string | null
  legal: ReadonlySet<TreeNode>
  node: TreeNode
  onSelect?: (path: string | null) => void
}) => {
  const container = isContainer(node.kind)
  const movable = isMovable(node)
  // Asked of the SAME function that will judge the drop, so the tint cannot promise something the
  // drop then refuses.
  const accepts = airborne && legal.has(node)
  // A node the draft does not carry is an existing cluster widget: it renders, but it has no file,
  // so it can never be edited here.
  const external = !node.drafted

  const dragId = nodeDragId(node)
  const { attributes, listeners, setNodeRef } = useDraggable({
    data: { from: 'canvas', node } satisfies DragPayload,
    disabled: !movable,
    id: dragId,
  })

  return (
    <div
      data-accepts={accepts ? 'yes' : undefined}
      data-testid={`canvas-frame-${node.name}`}
      ref={setNodeRef}
      style={{
        background: external ? 'transparent' : 'var(--krateo-color-background-surface)',
        border: `1px ${container ? 'dashed' : 'solid'} ${accepts ? 'var(--krateo-color-action-primary)' : 'var(--krateo-color-border-strong)'}`,
        borderRadius: 8,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        opacity: frameOpacity(external, draggingId === dragId),
        padding: 12,
      }}
    >
      <div style={{ alignItems: 'center', display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {/*
          THE HANDLE IS THE KIND LABEL, and it is a real button.
          It was a bare `<Text onClick>` with `cursor: pointer` and no tabIndex, role or key
          handler — the exact shape the portal's own rule C8 names ("a clickable row is
          keyboard-operable: focusable, announced, activated by Enter and Space"), in a file written
          after C8 was marked fixed. dnd-kit's `attributes` supply role, tabIndex and aria-roledescription;
          `listeners` supply the lift. So the same element is now the drag handle AND the selection
          control, reachable by keyboard for both.
        */}
        <Text
          {...(movable ? attributes : {})}
          {...(movable ? listeners : {})}
          data-testid={`canvas-handle-${node.name}`}
          onClick={node.path ? () => onSelect?.(node.path) : undefined}
          onKeyDown={node.path
            ? (event: React.KeyboardEvent) => {
              // Enter selects. Space is left to dnd-kit's lift, which is the convention its own
              // KeyboardSensor documents and what a screen-reader user will expect.
              if (event.key === 'Enter') {
                event.preventDefault()
                onSelect?.(node.path)
              }
            }
            : undefined}
          // NOT after the spread when movable: dnd-kit's `attributes` already carry role, tabIndex
          // and aria-roledescription, and re-declaring tabIndex here overwrote theirs with
          // undefined — which silently removed the keyboard reachability this change exists to add.
          // A non-movable node that can be SELECTED still needs its own.
          {...(movable ? {} : { role: node.path ? 'button' : undefined, tabIndex: node.path ? 0 : undefined })}
          strong
          style={{ cursor: handleCursor(movable, !!node.path) }}
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
        {/*
          WHAT THIS CONTAINER SAYS IT HOLDS, readable AT REST.
          Whether a container is constrained was previously visible only during a drag you may not
          have started — so "why did that not drop" had no answer you could look up. A non-empty
          declaration is a statement of intent and belongs on the frame beside the other tags.
        */}
        {container && node.allowedResources?.length ? (
          <Tooltip title='its widgetData.allowedResources — edit the file in Files to change it'>
            <Tag>{node.allowedResources.join(', ')} only</Tag>
          </Tooltip>
        ) : null}
      </div>

      {container ? (
        <Well accepts={accepts} live={airborne} node={node}>
          {node.children.length === 0 ? <Text style={{ fontSize: 12 }} type='secondary'>empty</Text> : null}
          <DropGap at={0} container={node.name} live={airborne} node={node} />
          {node.children.map((child, index) => (
            <Fragment key={`${child.name}-${child.refId ?? index}-${index}`}>
              <Frame
                airborne={airborne}
                depth={depth + 1}
                draggingId={draggingId}
                legal={legal}
                node={child}
                onSelect={onSelect}
              />
              <DropGap at={index + 1} container={node.name} live={airborne} node={node} />
            </Fragment>
          ))}
        </Well>
      ) : null}
    </div>
  )
}

/**
 * The canvas. `files` is the held draft — the same input the tree takes, so the two cannot be given
 * different pictures of the same page.
 *
 * The `DndContext` is NOT here: it wraps the palette and the canvas together in `PageComposer`,
 * because a drag that starts in one and ends in the other has to be one gesture in one context.
 */
export const CanvasPanel = ({ airborne = null, draggingId = null, files, onSelect, roots }: {
  /** Something is in the air, from either panel. Absent means nothing is — the resting state, and
   *  the one a render-only test wants. */
  airborne?: DragPayload | null
  draggingId?: string | null
  files: Record<string, string>
  onSelect?: (path: string | null) => void
  /** The tree the gesture will be applied against — built once by the composer and shared, because
   *  `legalTargets` compares nodes by REFERENCE and a second `buildObjectTree` would yield nodes
   *  that are equal but not identical. */
  roots?: readonly TreeNode[]
}) => {
  const built = useMemo(() => buildObjectTree(files), [files])
  const tree = roots ?? built

  const legal = useMemo(() => {
    if (!airborne) {
      return new Set<TreeNode>()
    }
    const plural = airborne.from === 'palette' ? airborne.pick.resource : airborne.node.resource
    if (!plural) {
      return new Set<TreeNode>()
    }
    return new Set(legalTargets(tree, {
      node: airborne.from === 'canvas' ? airborne.node : undefined,
      plural,
    }))
  }, [airborne, tree])

  if (!tree.length) {
    return <Empty description='Nothing to render yet — the draft carries no page root.' image={Empty.PRESENTED_IMAGE_SIMPLE} />
  }

  return (
    <div data-testid='canvas-panel' style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {tree.map((root, index) => (
        <Frame
          airborne={!!airborne}
          depth={0}
          draggingId={draggingId}
          key={`${root.name}-${index}`}
          legal={legal}
          node={root}
          onSelect={onSelect}
        />
      ))}
    </div>
  )
}

export default CanvasPanel
