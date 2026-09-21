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
import { ApiOutlined, ArrowDownOutlined, ArrowUpOutlined, DeleteOutlined, DragOutlined, GroupOutlined, ImportOutlined, PlusOutlined } from '@ant-design/icons'
import { App, Badge, Button, Dropdown, Empty, Popconfirm, Space, Tag, Tooltip, Tree, Typography } from 'antd'
import type { DataNode } from 'antd/es/tree'
import { useMemo, useState } from 'react'

import { emitFileAdd } from '../../components/Autopilot/previewFileAdd'
import { emitFileEdit } from '../../components/Autopilot/previewFileEdit'
import { emitFileRemove } from '../../components/Autopilot/previewFileRemove'

import BindDataModal from './BindDataModal'
import { announce } from './composerAnnounce'
import type { BindingResult } from './generateBinding'
import MoveIntoModal from './MoveIntoModal'
import { buildObjectTree, draftNamespace, flattenTree } from './objectTree'
import type { TreeNode } from './objectTree'
import styles from './PageComposer.module.css'
import type { PlaceableWidget } from './placeableWidgets'
import PlaceWidgetModal from './PlaceWidgetModal'
import { planMove } from './planMove'
import { containerPath, LAYOUT_KINDS, moveChild, newContainerYaml, placeChild, removeChild, wrapChild } from './structureEdit'
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

/** Where `page-composable` lists from when the draft itself declares no namespace. */
const PORTAL_NAMESPACE = 'krateo-system'

const toDataNode = (
  node: TreeNode,
  key: string,
  mutate: (node: TreeNode, op: 'up' | 'down' | 'remove') => void,
  addLayout: (node: TreeNode, kind: LayoutKind) => void,
  bindInto: (node: TreeNode) => void,
  wrapIn: (node: TreeNode, kind: LayoutKind) => void,
  placeInto: (node: TreeNode) => void,
  moveInto: (node: TreeNode) => void,
): DataNode => ({
  children: node.children.map((child, index) => toDataNode(child, `${key}-${index}`, mutate, addLayout, bindInto, wrapIn, placeInto, moveInto)),
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
          <Tooltip title='Place a widget that already exists on the cluster'>
            <Button aria-label={`Place inside ${node.name}`} icon={<ImportOutlined />} onClick={(event) => { event.stopPropagation(); placeInto(node) }} size='small' type='text' />
          </Tooltip>
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
            {/* Wrap: the operation that actually creates nesting. Inserting an empty container
                beside this node would leave the two as siblings and every object you wanted
                inside as a separate move. */}
            <Dropdown
              menu={{
                items: Object.keys(LAYOUT_KINDS).map((kind) => ({ key: kind, label: `Wrap in ${kind}` })),
                onClick: ({ key: kind }) => wrapIn(node, kind as LayoutKind),
              }}
              trigger={['click']}
            >
              <Tooltip title='Put this inside a new layout container'>
                <Button aria-label={`Wrap ${node.name}`} icon={<GroupOutlined />} onClick={(event) => event.stopPropagation()} size='small' type='text' />
              </Tooltip>
            </Dropdown>
            {/*
              ONE TOOLTIP PER BUTTON. This was a single <Tooltip title='Move earlier'> wrapping
              BOTH of these, so at most one could receive it and the text was wrong for the other:
              the left-hand control reparents into a different container, which is not "earlier"
              by any reading. The aria-labels were always right, so it cost sighted mouse users
              only — which is exactly the kind of defect that survives, because the people most
              likely to notice it are the ones not being shown it.
            */}
            <Tooltip title='Move into another container'>
              {/* Reparenting from the KEYBOARD. The canvas can drag a node into another container;
                  without this the tree could only reorder within the parent it already had, so the
                  one edit that changes a page's shape was pointer-only. */}
              <Button aria-label={`Move ${node.name} into another container`} icon={<DragOutlined />} onClick={(event) => { event.stopPropagation(); moveInto(node) }} size='small' type='text' />
            </Tooltip>
            <Tooltip title='Move earlier'>
              <Button aria-label={`Move ${node.name} up`} icon={<ArrowUpOutlined />} onClick={(event) => { event.stopPropagation(); mutate(node, 'up') }} size='small' type='text' />
            </Tooltip>
            <Tooltip title='Move later'>
              <Button aria-label={`Move ${node.name} down`} icon={<ArrowDownOutlined />} onClick={(event) => { event.stopPropagation(); mutate(node, 'down') }} size='small' type='text' />
            </Tooltip>
            {/*
              CONFIRMED, because it is unrecoverable: removing the last placement of a drafted
              object now deletes its file, and the composer has no undo of any kind. This was a bare
              onClick on an operation that silently orphaned a file; it is now a decision.
            */}
            <Popconfirm
              cancelText='Keep'
              okText='Remove'
              onConfirm={() => mutate(node, 'remove')}
              title={`Remove ${node.name} from this page?`}
            >
              <Tooltip title='Remove from this page'>
                <Button aria-label={`Remove ${node.name}`} icon={<DeleteOutlined />} onClick={(event) => event.stopPropagation()} size='small' type='text' />
              </Tooltip>
            </Popconfirm>
          </Space>
        )
        : null}
    </span>
  ),
})

export const ObjectTreePanel = ({ files, onSelect, snowplowBaseUrl }: {
  /** The held draft, keyed by HELD KEY — the same key a write is addressed by. */
  files: Record<string, string>
  /** The selected object's held key, so the surface can reveal that file. */
  onSelect?: (path: string) => void
  /** Base URL for the `page-composable` RESTAction that lists placeable widgets. */
  snowplowBaseUrl: string
}) => {
  const { message } = App.useApp()
  // Which container a generated binding will be placed into. Null closes the modal.
  const [bindTarget, setBindTarget] = useState<TreeNode | null>(null)
  // Which container a placed EXISTING widget lands in. Null closes the modal.
  const [placeTarget, setPlaceTarget] = useState<TreeNode | null>(null)
  const [moveSubject, setMoveSubject] = useState<TreeNode | null>(null)
  const tree = useMemo(() => buildObjectTree(files), [files])
  const flat = useMemo(() => flattenTree(tree), [tree])
  // Where anything new is created. Read from the draft's own objects because the widget CRDs
  // require a namespace on both `apiRef` and every `resourcesRefs` entry and default neither.
  const namespace = useMemo(() => draftNamespace(files), [files])
  // Where EXISTING widgets are listed from and placed from. The draft's namespace when it has one
  // — a page and the widgets it places normally live together — falling back to the portal's own.
  const placeNamespace = namespace ?? PORTAL_NAMESPACE

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
  /**
   * SAY WHAT HAPPENED, AND PUT FOCUS BACK.
   *
   * Both halves matter and neither worked. The tree re-renders after every edit, which destroys the
   * focused button — measured: after pressing "Move … down", document.activeElement was BODY, and
   * getting back to the same control took seventeen tabs in a three-object draft. So the keyboard
   * route existed in the sense that the controls could be reached, and not in the sense that anyone
   * could use it: one drag-equivalent cost about a hundred keystrokes.
   *
   * Focus is restored BY ARIA-LABEL rather than by node identity, because the node objects are
   * rebuilt from the draft's bytes on every render — there is no stable reference to hold. The
   * label is what the person was last on, which is also what they would look for.
   */
  const settle = (message: string, label?: string) => {
    announce(message)
    if (!label) {
      return
    }
    // After the re-render, not during it.
    window.setTimeout(() => {
      // Compared rather than selected: a label is arbitrary user text (it contains the CR's name),
      // so putting it inside a selector needs escaping — and `CSS.escape` is absent in jsdom, which
      // would make this the one path the tests could not cover.
      const control = [...document.querySelectorAll<HTMLElement>('[aria-label]')]
        .find((candidate) => candidate.getAttribute('aria-label') === label)
      control?.focus()
    }, 0)
  }

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
      settle(`Not done: ${result.error}`)
      return
    }
    emitFileEdit({ content: result.content, path: node.parentPath })
    // The removed node's controls are gone, so focus goes back to its PARENT's — the nearest thing
    // still on screen, and where someone removing several children wants to be.
    settle(
      op === 'remove' ? `Removed ${node.name}` : `Moved ${node.name} ${op}`,
      op === 'remove' ? undefined : `Move ${node.name} ${op}`,
    )

    /*
     * REMOVE ALSO REMOVES THE FILE — which it did not, and that was the whole defect.
     *
     * `removeChild` rewrites the PARENT: it deletes the reference and nothing else. The child's file
     * stayed in the held draft, `buildObjectTree` saw a file nothing referenced and drew it as a page
     * ROOT, and the thing just removed reappeared on the canvas beside the page. It had no
     * `parentPath`, so the tree drew no buttons on it — there was no Remove to press a second time —
     * and `pagePublish` builds one repocontents op per held key, so it shipped in the change request
     * too. "I pressed Remove and it is still there, and now I cannot get rid of it."
     *
     * ONLY WHEN NOTHING ELSE HOLDS IT. The same widget may legitimately be placed twice — a divider
     * between two sections — and each placement is its own reference. Deleting the file on the first
     * removal would blank the surviving placement. So the file goes only when this was the last
     * placement of it, counted over the tree as it stands BEFORE the removal.
     */
    if (op === 'remove' && node.drafted && node.path) {
      const placements = flat.filter((other) => other.name === node.name && other.refId !== null)
      if (placements.length <= 1) {
        emitFileRemove({ path: node.path })
      }
    }
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

  /**
   * Wrap this node in a new container — re-parenting, not insertion.
   *
   * Two emissions, container BEFORE parent, for the same reason every other add is ordered that
   * way: the parent's new reference must resolve to a file that already exists. `wrapChild`
   * computes both documents from the parent's CURRENT bytes, so a refusal costs nothing — neither
   * has been emitted yet.
   */
  const wrapIn = (node: TreeNode, kind: LayoutKind) => {
    const parentYaml = node.parentPath ? files[node.parentPath] : undefined
    if (!node.parentPath || parentYaml === undefined || !node.refId || node.position === null) {
      message.error('that object has no parent to rewrite')
      return
    }
    if (!namespace) {
      message.error('this draft declares no namespace, so a new container cannot be created in one')
      return
    }
    const existing = new Set(Object.keys(files))
    let name = `${node.name}-${kind.toLowerCase()}`
    let suffix = 2
    while (existing.has(containerPath(kind, name))) {
      name = `${node.name}-${kind.toLowerCase()}-${suffix}`
      suffix += 1
    }
    const result = wrapChild(parentYaml, { index: node.position, refId: node.refId }, { kind, name, namespace })
    if (!result.ok) {
      message.warning(result.error)
      return
    }
    emitFileAdd({ content: result.container, path: containerPath(kind, name) })
    emitFileEdit({ content: result.parent, path: node.parentPath })
  }

  const nodes = useMemo(
    () => tree.map((node, index) => toDataNode(node, `${index}`, mutate, addLayout, setBindTarget, wrapIn, setPlaceTarget, setMoveSubject)),
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
    // THE PLURAL THE GENERATOR ACTUALLY EMITTED, not a literal repeated here. It was `'tables'`,
    // which was true — generateBinding emits a Table — but true by coincidence at this call site
    // rather than by construction. A placement declaring the wrong plural renders nothing and
    // reports nothing, which is the failure this file can least afford to introduce silently.
    const placed = placeChild(parentYaml, { name: result.name, namespace, resource: result.resource })
    if (!placed.ok) {
      message.warning(placed.error)
      return
    }
    emitFileAdd({ content: result.restAction.content, path: result.restAction.path })
    emitFileAdd({ content: result.widget.content, path: result.widget.path })
    emitFileEdit({ content: placed.content, path: target.path })
    setBindTarget(null)
  }

  /**
   * Place an EXISTING cluster widget into a container.
   *
   * One emission, not two: the widget is already on the cluster, so nothing is added to the draft —
   * only the parent changes. The ref entry carries the namespace the LISTING reported, not the
   * draft's, because that is where the widget actually lives and snowplow resolves it there.
   */
  const acceptPlacement = (target: TreeNode, widget: PlaceableWidget) => {
    const parentYaml = target.path ? files[target.path] : undefined
    if (!target.path || parentYaml === undefined) {
      message.error('that container is not part of the draft')
      return
    }
    const placed = placeChild(parentYaml, {
      name: widget.name,
      namespace: placeNamespace,
      resource: widget.resource,
    })
    if (!placed.ok) {
      message.warning(placed.error)
      return
    }
    emitFileEdit({ content: placed.content, path: target.path })
    setPlaceTarget(null)
  }

  /**
   * A reparent chosen from the tree, applied through the SAME planner a drag uses.
   *
   * `tree` is passed as the roots so the node identities match the ones `legalTargets` compared
   * when it offered the choice — rebuilding here would make every move illegal for a reason no
   * message could explain.
   */
  const acceptMove = (moving: TreeNode, target: TreeNode) => {
    const plan = planMove(files, tree, moving, target)
    setMoveSubject(null)
    if (!plan.ok) {
      message.warning(plan.reason)
      return
    }
    Object.entries(plan.files).forEach(([path, content]) => emitFileEdit({ content, path }))
  }

  return (
    <div className={styles.tree}>
      {moveSubject
        ? (
          <MoveIntoModal
            moving={moveSubject}
            onCancel={() => setMoveSubject(null)}
            onMove={(target) => acceptMove(moveSubject, target)}
            open
            roots={tree}
          />
        )
        : null}
      {placeTarget
        ? (
          <PlaceWidgetModal
            into={placeTarget.name}
            namespace={placeNamespace}
            onCancel={() => setPlaceTarget(null)}
            onPlace={(widget) => acceptPlacement(placeTarget, widget)}
            open
            snowplowBaseUrl={snowplowBaseUrl}
          />
        )
        : null}
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
          // `node.path` is null for a placed EXISTING widget — it has no file in this draft, so
          // there is nothing to reveal and nothing is claimed.
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
