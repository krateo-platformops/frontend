/**
 * The draft as the tree it actually is.
 *
 * WHY THIS PANEL EXISTS. The Files tab is a flat list of paths; nothing in it shows that
 * `row.fleet-top` CONTAINS `statistic.fleet-ready`. Structure is the thing the old builder could
 * not express at all — `form.compose-page` emits one level, `vertical: true, items: [...]`, and a
 * Form widget cannot do better because SchemaFields has no repeatable-row control. Showing the
 * nesting is the first half of being able to author it.
 *
 * A VIEW, NOT A MODEL. Every node is derived from the draft's bytes by `buildObjectTree` on each
 * render. Nothing is cached here and no structure is stored beside the files, because the Files tab
 * lets a person rewrite any file's YAML — a structure kept alongside would be stale the moment they
 * did, in a way nothing would report.
 */
import { ArrowDownOutlined, ArrowUpOutlined, DeleteOutlined } from '@ant-design/icons'
import { App, Badge, Button, Empty, Space, Tag, Tooltip, Tree, Typography } from 'antd'
import type { DataNode } from 'antd/es/tree'
import { useMemo } from 'react'

import { emitFileEdit } from '../../components/Autopilot/previewFileEdit'

import { buildObjectTree, flattenTree } from './objectTree'
import type { TreeNode } from './objectTree'
import styles from './PageComposer.module.css'
import { moveChild, removeChild } from './structureEdit'

/** Container kinds — the ones whose job is to hold other widgets. Worth a quieter label. */
const CONTAINERS = new Set(['Flex', 'Row', 'Col', 'Tabs', 'Card', 'Layout'])

const toDataNode = (
  node: TreeNode,
  key: string,
  mutate: (node: TreeNode, op: 'up' | 'down' | 'remove') => void,
): DataNode => ({
  children: node.children.map((child, index) => toDataNode(child, `${key}-${index}`, mutate)),
  key,
  title: (
    <span className={styles.node}>
      <Typography.Text strong={CONTAINERS.has(node.kind ?? '')}>{node.name}</Typography.Text>
      {node.kind ? <Tag className={styles.kindTag}>{node.kind}</Tag> : null}
      {node.bound
        ? (
          <Tooltip title='Reads its data from a RESTAction — spec.apiRef'>
            <Tag color='blue'>data</Tag>
          </Tooltip>
        )
        : null}
      {node.drafted
        ? null
        : (
          <Tooltip title='An existing widget on the cluster, placed on this page. Not part of the draft, so it is not published — only referenced.'>
            <Tag>placed</Tag>
          </Tooltip>
        )}
      {/* Only a node with a parent can move or be removed: a child is a REFERENCE held by its
          parent, so both operations rewrite the parent's file. A root is placed by nothing. */}
      {node.parentPath
        ? (
          <Space className={styles.nodeActions} size={0}>
            <Tooltip title='Move earlier'>
              <Button aria-label={`Move ${node.name} up`} icon={<ArrowUpOutlined />} onClick={(event) => { event.stopPropagation(); mutate(node, 'up') }} size='small' type='text' />
            </Tooltip>
            <Tooltip title='Move later'>
              <Button aria-label={`Move ${node.name} down`} icon={<ArrowDownOutlined />} onClick={(event) => { event.stopPropagation(); mutate(node, 'down') }} size='small' type='text' />
            </Tooltip>
            <Tooltip title='Remove from this page'>
              <Button aria-label={`Remove ${node.name}`} icon={<DeleteOutlined />} onClick={(event) => { event.stopPropagation(); mutate(node, 'remove') }} size='small' type='text' />
            </Tooltip>
          </Space>
        )
        : null}
    </span>
  ),
})

export const ObjectTreePanel = ({ files, onSelect }: {
  files: Record<string, string>
  onSelect?: (path: string) => void
}) => {
  const { message } = App.useApp()
  const tree = useMemo(() => buildObjectTree(files), [files])
  const flat = useMemo(() => flattenTree(tree), [tree])

  /**
   * Apply a structural edit and hand the result to the SAME bus the Files-tab editor uses.
   *
   * The provider owns the held draft and the preview gate; this panel owns neither, exactly as the
   * preview drawer owns neither. Emitting on `previewFileEdit` means a structural edit and a
   * hand-typed YAML edit travel the identical path — one place re-checks the cap, one place
   * re-arms the gate — instead of this panel growing a second way to mutate a draft.
   *
   * A refusal is SHOWN. Moving the first child up is a real refusal, not a no-op, and saying so
   * beats a button that appears to do nothing.
   */
  const mutate = (node: TreeNode, op: 'up' | 'down' | 'remove') => {
    const parentYaml = node.parentPath ? files[node.parentPath] : undefined
    if (!node.parentPath || parentYaml === undefined) {
      message.error('that object has no parent to edit')
      return
    }
    const result = op === 'remove'
      ? removeChild(parentYaml, node.name)
      : moveChild(parentYaml, node.name, op)
    if (!result.ok) {
      message.warning(result.error)
      return
    }
    emitFileEdit({ content: result.content, path: node.parentPath })
  }

  const nodes = useMemo(
    () => tree.map((node, index) => toDataNode(node, `${index}`, mutate)),
    // `mutate` closes over `files` and is recreated each render; depending on it would defeat the
    // memo entirely. `tree` already changes whenever `files` does, which is the only time the
    // rendered nodes need rebuilding.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tree],
  )

  // Index by the same key the DataNode carries, so a click resolves back to the file it came from
  // without threading the path through antd's node type.
  const byKey = useMemo(() => {
    const map = new Map<string, TreeNode>()
    const walk = (node: TreeNode, key: string) => {
      map.set(key, node)
      node.children.forEach((child, index) => walk(child, `${key}-${index}`))
    }
    tree.forEach((node, index) => walk(node, `${index}`))
    return map
  }, [tree])

  if (!flat.length) {
    return (
      <div className={styles.tree}>
        <Empty
          description='Nothing in this draft yet.'
          image={Empty.PRESENTED_IMAGE_SIMPLE}
        />
      </div>
    )
  }

  const boundCount = flat.filter((node) => node.bound).length

  return (
    <div className={styles.tree}>
      <div className={styles.treeHead}>
        <Typography.Text strong>Objects</Typography.Text>
        <span className={styles.counts}>
          <Badge color='default' count={flat.length} overflowCount={999} showZero title='objects on this page' />
          {boundCount
            ? <Tooltip title={`${boundCount} read their data from a RESTAction`}><Tag color='blue'>{boundCount} data</Tag></Tooltip>
            : null}
        </span>
      </div>
      <Tree
        defaultExpandAll
        onSelect={(keys) => {
          const node = byKey.get(String(keys[0]))
          if (node?.path && onSelect) {
            onSelect(node.path)
          }
        }}
        selectable
        treeData={nodes}
      />
    </div>
  )
}

export default ObjectTreePanel
