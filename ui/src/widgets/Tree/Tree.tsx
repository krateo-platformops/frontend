import type { IconProp } from '@fortawesome/fontawesome-svg-core'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { Tree as AntdTree, type TreeDataNode } from 'antd'
import { useMemo } from 'react'
import { useNavigate } from 'react-router'

import { getColorCode } from '../../theme/palette'
import type { WidgetProps } from '../../types/Widget'
import { navigateOrExternal } from '../../utils/navigation'

import { ancestorsOf, buildTree, type NestedNode } from './buildTree'
import styles from './Tree.module.css'
import type { Tree as WidgetType } from './Tree.type'

export type TreeWidgetData = WidgetType['spec']['widgetData']
type TreeItem = TreeWidgetData['items'][number]

const toTreeData = (entries: NestedNode<TreeItem>[]): TreeDataNode[] => entries.map(({ children, node }) => {
  const { color, description, disabled, icon, key, navigateTo, title } = node
  return {
    children: children.length > 0 ? toTreeData(children) : undefined,
    className: navigateTo ? undefined : styles.inert,
    disabled,
    icon: icon
      ? <FontAwesomeIcon color={color ? getColorCode(color) : 'var(--gray-color)'} fixedWidth icon={icon as IconProp} />
      : undefined,
    isLeaf: children.length === 0,
    key,
    selectable: Boolean(navigateTo),
    title: (
      <>
        <span className={styles.title}>{title}</span>
        {description && <span className={styles.description}>{description}</span>}
      </>
    ),
  }
})

/**
 * Faithful wrapper of antd `Tree`, for a hierarchy: a composition and the resources it owns, a
 * catalog by category, a folder layout.
 *
 * The nodes arrive FLAT, each naming its parent (`parentKey`), and are nested here (buildTree.ts):
 * a CRD schema cannot recurse, and a flat list is what a RESTAction's jq produces. A node whose
 * parent is missing is drawn at the root rather than lost.
 *
 * Selecting a node opens its `navigateTo` through the one navigation entry point every widget uses
 * (an app path in the SPA, an absolute URL in a new tab). A node without one is not selectable and
 * reads as text. `selectedKey` marks the open page's node, and its ancestors open so it is in view.
 *
 * An icon's `color` is a palette NAME, the enum Timeline, Progress and Table take, resolved for the
 * active mode; the `description` is data, so it is set in the data face.
 */
const Tree = ({ uid, widgetData }: WidgetProps<TreeWidgetData>) => {
  const { defaultExpandAll, defaultExpandedKeys, height, items, selectedKey, showLine } = widgetData
  const navigate = useNavigate()

  const roots = useMemo(() => buildTree(items), [items])
  const treeData = useMemo(() => toTreeData(roots), [roots])
  // The first node with a key wins, as in buildTree, so a click opens the node that was drawn.
  const byKey = useMemo(() => new Map([...items].reverse().map((item) => [item.key, item])), [items])
  const expanded = useMemo(
    () => [...(defaultExpandedKeys ?? []), ...(selectedKey ? ancestorsOf(roots, selectedKey) : [])],
    [defaultExpandedKeys, roots, selectedKey],
  )

  return (
    <AntdTree
      blockNode
      defaultExpandAll={defaultExpandAll}
      defaultExpandParent
      defaultExpandedKeys={expanded}
      height={height}
      key={uid}
      onSelect={(_keys, { node }) => navigateOrExternal(navigate, byKey.get(String(node.key))?.navigateTo)}
      selectedKeys={selectedKey ? [selectedKey] : []}
      showIcon={items.some((item) => item.icon)}
      showLine={showLine}
      treeData={treeData}
    />
  )
}

export default Tree
