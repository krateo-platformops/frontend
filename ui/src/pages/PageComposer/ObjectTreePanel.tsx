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
import { ApiOutlined, ArrowDownOutlined, ArrowUpOutlined, DeleteOutlined, PlusOutlined } from '@ant-design/icons'
import { App, Badge, Button, Dropdown, Empty, Space, Tag, Tooltip, Tree, Typography } from 'antd'
import type { DataNode } from 'antd/es/tree'
import { useMemo, useState } from 'react'

import { emitFileAdd } from '../../components/Autopilot/previewFileAdd'
import { emitFileEdit } from '../../components/Autopilot/previewFileEdit'

import BindDataModal from './BindDataModal'
import type { BindingResult } from './generateBinding'
import { buildObjectTree, draftNamespace, flattenTree } from './objectTree'
import type { TreeNode } from './objectTree'
import styles from './PageComposer.module.css'
import { containerPath, LAYOUT_KINDS, moveChild, newContainerYaml, placeChild, removeChild } from './structureEdit'
import type { LayoutKind } from './structureEdit'

/**
 * Kinds that can HOLD another widget — exactly the kinds this panel can insert.
 *
 * Derived from LAYOUT_KINDS rather than listed again, because the two had already drifted: this set
 * also carried `Layout`, whose CRD has neither `widgetData.items` nor `allowedResources`. The
 * widget CRDs are strict, so an "add inside" on a Layout produced a parent the apiserver rejects
 * outright — an affordance that could only ever fail. One list, and the drift cannot recur.
 */
const CONTAINERS = new Set<string>(Object.keys(LAYOUT_KINDS))

const toDataNode = (
  node: TreeNode,
  key: string,
  mutate: (node: TreeNode, op: 'up' | 'down' | 'remove') => void,
  addLayout: (node: TreeNode, kind: LayoutKind) => void,
  bindInto: (node: TreeNode) => void,
): DataNode => ({
  children: node.children.map((child, index) => toDataNode(child, `${key}-${index}`, mutate, addLayout, bindInto)),
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
      {/* A container can take a child; a leaf cannot. Offering "add" on a Statistic would produce
          a CR whose kind has no items, which the strict widget CRDs reject at apply. */}
      {node.drafted && CONTAINERS.has(node.kind ?? '')
        ? (
          <Dropdown
            menu={{
              items: Object.keys(LAYOUT_KINDS).map((kind) => ({ key: kind, label: kind })),
              onClick: ({ key }) => addLayout(node, key as LayoutKind),
            }}
            trigger={['click']}
          >
            <Tooltip title='Add a layout container inside this one'>
              <Button aria-label={`Add inside ${node.name}`} icon={<PlusOutlined />} onClick={(event) => event.stopPropagation()} size='small' type='text' />
            </Tooltip>
          </Dropdown>
        )
        : null}
      {node.drafted && CONTAINERS.has(node.kind ?? '')
        ? (
          <Tooltip title='Add a table that reads live data from the cluster'>
            <Button aria-label={`Bind data inside ${node.name}`} icon={<ApiOutlined />} onClick={(event) => { event.stopPropagation(); bindInto(node) }} size='small' type='text' />
          </Tooltip>
        )
        : null}
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
  /** The held draft, keyed by HELD KEY — the same key a write is addressed by. */
  files: Record<string, string>
  onSelect?: (path: string) => void
}) => {
  const { message } = App.useApp()
  // Which container a generated binding will be placed into. Null closes the modal.
  const [bindTarget, setBindTarget] = useState<TreeNode | null>(null)
  const tree = useMemo(() => buildObjectTree(files), [files])
  const flat = useMemo(() => flattenTree(tree), [tree])
  // Where anything new is created. Read from the draft's own objects because the widget CRDs
  // require a namespace on both `apiRef` and every `resourcesRefs` entry and default neither.
  const namespace = useMemo(() => draftNamespace(files), [files])

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
    // Addressed by POSITION, carrying the refId as a check.
    //
    // `refId` and not `name`, because the parent holds an id in
    // `widgetData.items[].resourceRefId` which `resourcesRefs` maps to the CR name, and nothing
    // requires the two to be equal — matching on the name refused every edit where they differ.
    // Position and not id alone, because the same widget may be placed twice: by id, "remove"
    // deleted both copies and "move" always moved the first, whichever one was clicked.
    if (!node.refId || node.position === null) {
      message.error('that object carries no reference id, so its parent cannot address it')
      return
    }
    const child = { index: node.position, refId: node.refId }
    const result = op === 'remove'
      ? removeChild(parentYaml, child)
      : moveChild(parentYaml, child, op)
    if (!result.ok) {
      message.warning(result.error)
      return
    }
    emitFileEdit({ content: result.content, path: node.parentPath })
  }

  /**
   * Insert an empty container inside `parent`: create its file, then place it.
   *
   * TWO EMISSIONS, IN THIS ORDER, and the order is the point. The add must land before the place,
   * because the parent's new reference resolves to a file that has to exist — reversed, the draft
   * briefly holds a page pointing at nothing, and the live render shows an empty slot for a widget
   * nobody can find. Ordering them here rather than making a combined bus event keeps each bus
   * doing one thing, and each is re-checked independently by the provider.
   *
   * Naming is derived, not asked for. A dialog per insert would make building a three-section page
   * a five-prompt affair; the name is visible in the tree and editable in the Files tab.
   */
  const addLayout = (parent: TreeNode, kind: LayoutKind) => {
    const parentYaml = parent.path ? files[parent.path] : undefined
    if (!parent.path || parentYaml === undefined) {
      message.error('that container is not part of the draft, so nothing can be added inside it')
      return
    }
    if (!namespace) {
      message.error('this draft declares no namespace, so a new container cannot be created in one')
      return
    }
    const existing = new Set(Object.keys(files))
    let name = `${parent.name}-${kind.toLowerCase()}`
    let suffix = 2
    while (existing.has(containerPath(kind, name))) {
      name = `${parent.name}-${kind.toLowerCase()}-${suffix}`
      suffix += 1
    }
    const path = containerPath(kind, name)

    // Place FIRST in memory so a refusal costs nothing: if the parent will not take the child there
    // is no orphan file to clean up, because nothing has been emitted yet.
    const placed = placeChild(parentYaml, { name, namespace, resource: LAYOUT_KINDS[kind] })
    if (!placed.ok) {
      message.warning(placed.error)
      return
    }
    emitFileAdd({ content: newContainerYaml(kind, name, namespace), path })
    emitFileEdit({ content: placed.content, path: parent.path })
  }

  const nodes = useMemo(
    () => tree.map((node, index) => toDataNode(node, `${index}`, mutate, addLayout, setBindTarget)),
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

  /**
   * A generated binding is THREE emissions, and the order matters for the same reason it does when
   * adding a container: the parent's reference must resolve to files that already exist, or the
   * draft briefly points at nothing. RESTAction first because the widget's apiRef names it.
   */
  const acceptBinding = (target: TreeNode, result: Extract<BindingResult, { ok: true }>) => {
    const parentYaml = target.path ? files[target.path] : undefined
    if (!target.path || parentYaml === undefined) {
      message.error('that container is not part of the draft')
      return
    }
    if (!namespace) {
      message.error('this draft declares no namespace, so the query and table cannot be created in one')
      return
    }
    // Refuse a name the draft already holds, BEFORE anything is emitted.
    //
    // `addFile` refuses an existing path, but it refuses it silently from here — so re-binding
    // under a name already in the draft dropped both generated files on the floor while the place
    // still went through, leaving the parent referencing the OLD table twice. Checking first makes
    // the collision the author's to resolve, which is the only party that can.
    const clash = [result.restAction.path, result.widget.path].filter((path) => path in files)
    if (clash.length) {
      message.warning(`"${result.name}" is already in this draft — pick another name, or edit ${clash[0]} in Files`)
      return
    }
    // `result.name`, not the filename parsed back out of a path: the generator already knows it,
    // and re-deriving it would be a second place that has to agree about naming.
    const placed = placeChild(parentYaml, { name: result.name, namespace, resource: 'tables' })
    if (!placed.ok) {
      message.warning(placed.error)
      return
    }
    emitFileAdd({ content: result.restAction.content, path: result.restAction.path })
    emitFileAdd({ content: result.widget.content, path: result.widget.path })
    emitFileEdit({ content: placed.content, path: target.path })
    setBindTarget(null)
  }

  return (
    <div className={styles.tree}>
      {bindTarget
        ? (
          <BindDataModal
            namespace={namespace}
            onCancel={() => setBindTarget(null)}
            onGenerate={(result) => acceptBinding(bindTarget, result)}
            open
          />
        )
        : null}
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
