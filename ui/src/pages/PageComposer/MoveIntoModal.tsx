/**
 * Move a widget into another container, from the tree.
 *
 * WHY THIS EXISTS AT ALL. The canvas can drag a node into a different container; the tree could
 * only nudge it up or down within the parent it already had. Dragging is pointer-only, so
 * reparenting — the one structural edit that changes a page's shape rather than its order — was
 * unreachable by keyboard. That is the parity gap, and it is an accessibility gap rather than a
 * tidiness one.
 *
 * THE SAME KERNEL, NOT A SECOND ONE. The choices offered are `legalTargets` — the identical
 * function the canvas asks before it lights a well up — so the tree cannot offer a destination the
 * canvas would refuse, or refuse one it would accept. The move itself runs through `planMove`.
 *
 * WHAT IS DELIBERATELY NOT OFFERED: a position within the target. A drop names a seam because the
 * pointer is already over one; a keyboard user picking from a list has no such context, so the
 * child lands at the end and the existing up/down controls move it from there. Offering an index
 * picker would be a worse answer than the controls that already exist.
 */
import { Alert, Modal, Select, Typography } from 'antd'
import { useState } from 'react'

import { legalTargets } from './dropTargets'
import type { TreeNode } from './objectTree'

const { Text } = Typography

/**
 * The containers this node may be reparented into.
 *
 * Exported because it is the RULE, not a detail of the dialog: it must agree exactly with what the
 * canvas lights up, and a rule worth agreeing on is worth naming and testing on its own rather than
 * through a Select's DOM.
 *
 * `legalTargets` does the work — container kind, the target's own declaration, editability and the
 * cycle rule — so this adds exactly two things: a node with no declared resource can be offered
 * nowhere (nothing can say what it is), and the container it is ALREADY in is left out, because
 * ordering within the current parent is what the up and down controls are for.
 */
export const reparentTargets = (roots: readonly TreeNode[], moving: TreeNode): TreeNode[] =>
  (moving.resource
    ? legalTargets(roots, { node: moving, plural: moving.resource }).filter((node) => node.path !== moving.parentPath)
    : [])

export const MoveIntoModal = ({ moving, onCancel, onMove, open, roots }: {
  /** The node being moved — also what excludes its own subtree from the choices. */
  moving: TreeNode
  onCancel: () => void
  onMove: (target: TreeNode) => void
  open: boolean
  /** The tree the choices come from. Same object identity `planMove` will compare against. */
  roots: readonly TreeNode[]
}) => {
  const [chosen, setChosen] = useState<string | null>(null)

  const targets = reparentTargets(roots, moving)

  const body = () => {
    if (!moving.resource) {
      return <Alert message={`"${moving.name}" has no resource declared on its reference, so the draft cannot say what kind of thing it is.`} showIcon type='warning' />
    }
    if (!targets.length) {
      return <Alert message='No other container on this page will take it. A container must be carried by this draft and must not already be inside the thing being moved.' showIcon type='info' />
    }
    return (
      <Select
        autoFocus
        onChange={setChosen}
        options={targets.map((node) => ({ label: `${node.kind ?? 'container'} · ${node.name}`, value: node.name }))}
        placeholder='Choose a container'
        showSearch
        style={{ width: '100%' }}
        value={chosen}
      />
    )
  }

  return (
    <Modal
      okButtonProps={{ disabled: !chosen }}
      okText='Move'
      onCancel={onCancel}
      onOk={() => {
        const target = targets.find((node) => node.name === chosen)
        if (target) {
          onMove(target)
        }
      }}
      open={open}
      title={`Move ${moving.name} into…`}
    >
      <Text style={{ display: 'block', marginBottom: 10 }} type='secondary'>
        It lands at the end of the container you choose; use the up and down controls to position it.
      </Text>
      {body()}
    </Modal>
  )
}

export default MoveIntoModal
