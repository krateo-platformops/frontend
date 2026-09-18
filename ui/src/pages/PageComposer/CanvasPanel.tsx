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
 * WHAT IS DELIBERATELY ABSENT: drag, drop, selection-to-edit, and any mutation. Those arrive in
 * Stage 4 on top of #300's atomic commit. A node here is inert.
 */
import { Empty, Tag, Tooltip, Typography } from 'antd'
import { useMemo } from 'react'

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
const Frame = ({ depth, node, onSelect }: {
  depth: number
  node: TreeNode
  onSelect?: (path: string | null) => void
}) => {
  const container = isContainer(node.kind)
  // A node the draft does not carry is an existing cluster widget: it renders, but it has no file,
  // so it can never be edited here. Saying so is honest and it is also exactly why `canAccept`
  // refuses it as a drop target (#297).
  const external = !node.drafted

  return (
    <div
      data-testid={`canvas-frame-${node.name}`}
      style={{
        background: external ? 'transparent' : 'var(--krateo-canvas-frame-bg, rgba(127,127,127,0.04))',
        border: `1px ${container ? 'dashed' : 'solid'} rgba(127,127,127,0.35)`,
        borderRadius: 8,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        opacity: external ? 0.6 : 1,
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
          style={{ display: 'flex', flexDirection: 'column', gap: 8, minHeight: 28, paddingLeft: 10 }}
        >
          {node.children.length === 0
            ? <Text style={{ fontSize: 12 }} type='secondary'>empty</Text>
            : node.children.map((child, index) => (
              <Frame depth={depth + 1} key={`${child.name}-${child.refId ?? index}-${index}`} node={child} onSelect={onSelect} />
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
export const CanvasPanel = ({ files, onSelect }: {
  files: Record<string, string>
  onSelect?: (path: string | null) => void
}) => {
  const roots = useMemo(() => buildObjectTree(files), [files])

  if (roots.length === 0) {
    return <Empty description='Nothing to render yet — the draft carries no page root.' image={Empty.PRESENTED_IMAGE_SIMPLE} />
  }

  return (
    <div data-testid='canvas-panel' style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {roots.map((root, index) => (
        <Frame depth={0} key={`${root.name}-${index}`} node={root} onSelect={onSelect} />
      ))}
    </div>
  )
}

export default CanvasPanel
