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
import { Badge, Empty, Tag, Tooltip, Tree, Typography } from 'antd'
import type { DataNode } from 'antd/es/tree'
import { useMemo } from 'react'

import { buildObjectTree, flattenTree } from './objectTree'
import type { TreeNode } from './objectTree'
import styles from './PageComposer.module.css'

/** Container kinds — the ones whose job is to hold other widgets. Worth a quieter label. */
const CONTAINERS = new Set(['Flex', 'Row', 'Col', 'Tabs', 'Card', 'Layout'])

const toDataNode = (node: TreeNode, key: string): DataNode => ({
  children: node.children.map((child, index) => toDataNode(child, `${key}-${index}`)),
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
    </span>
  ),
})

export const ObjectTreePanel = ({ files, onSelect }: {
  files: Record<string, string>
  onSelect?: (path: string) => void
}) => {
  const tree = useMemo(() => buildObjectTree(files), [files])
  const flat = useMemo(() => flattenTree(tree), [tree])
  const nodes = useMemo(() => tree.map((node, index) => toDataNode(node, `${index}`)), [tree])

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
