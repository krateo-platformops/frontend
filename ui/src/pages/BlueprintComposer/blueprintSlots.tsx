/**
 * The Blueprint Builder's slot plugins — `kinds` (palette), `architecture-graph` (canvas) and `node`
 * (inspector) — each drawing its part of the blueprint workbench (useBlueprintWorkbench) inside the
 * frame ComposerHost gives it. Registered by name in builders/pluginRegistry.ts.
 */
import type { CanvasPlugin, SlotPlugin, SlotProps } from '../../builders/host/hostTypes'

import ArchitectureCanvas from './ArchitectureCanvas'
import ArchitecturePalette from './ArchitecturePalette'
import { ConditionsStrip } from './ConditionsStrip'
import { edgeHead, PendingEdgeInspector, RefusedMoment, WhatJustHappened } from './EdgeInspector'
import NodeInspector from './NodeInspector'
import { readinessOptions } from './readinessOptions'
import StatePanel from './StatePanel'
import type { BlueprintSlots } from './useBlueprintWorkbench'

/** The workbench's slots — the host has already checked that this plugin's kind is the workbench's. */
const slotsOf = ({ workbench }: SlotProps): BlueprintSlots => workbench.slots as BlueprintSlots

const KindsPalette = (props: SlotProps) => <ArchitecturePalette {...slotsOf(props).palette} />

const ArchitectureGraphCanvas = (props: SlotProps) => {
  const { conditions: machine, edges, ...canvas } = slotsOf(props).canvas
  return (
    <ArchitectureCanvas
      {...canvas}
      conditions={<ConditionsStrip conditions={machine.conditions} onChange={machine.set} onReset={machine.reset} positions={machine.positions} />}
      drawing={edges.drawingStates}
      edgeDraw={edges.edgeDraw}
      edgeHead={edgeHead(edges)}
    />
  )
}

/**
 * The side column: the state the machine is in, then whichever the moment asks for — a refused drop,
 * the pending edge's questions, what an accepted edge did — and otherwise the selected node.
 */
const NodeInspectorColumn = (props: SlotProps) => {
  const { inspector } = slotsOf(props)
  const { architecture, edges, files, model, pendingTarget, selectedNode, targets, view } = inspector
  return (
    <>
      <StatePanel model={model} variant={inspector.machine.variant} view={inspector.stepView} />
      {edges.refusedMoment ? <RefusedMoment onDismiss={edges.dismissRefusal} reason={edges.refusedMoment} /> : null}
      {edges.pending && pendingTarget ? (
        <PendingEdgeInspector
          key={`${edges.pending.from}→${edges.pending.to}`}
          onAccept={edges.accept}
          onCancel={edges.cancel}
          pending={edges.pending}
          plan={edges.planPending}
          status={inspector.pendingStatus}
          target={pendingTarget}
        />
      ) : null}
      {!edges.pending && edges.accepted ? <WhatJustHappened edge={edges.accepted} onDone={inspector.onDone} /> : null}
      {edges.pending || edges.accepted ? null : (
        <NodeInspector
          editing={selectedNode && targets ? {
            onAddDependency: (to) => edges.choose(selectedNode.id, to),
            onRemoveEdge: (to) => edges.removeEdge(selectedNode.id, to),
            onRemoveNode: () => {
              const refused = edges.removeNode(selectedNode.id)
              if (!refused) { inspector.onSelectedRemoved() }
              return refused
            },
            onSetEdgeReady: (to, ready) => edges.setEdgeReady(selectedNode.id, to, ready),
            onSetReadyWhen: (readyWhen) => edges.setReadyWhen(selectedNode.id, readyWhen),
            order: architecture?.resources.map((resource) => resource.id) ?? [],
            readyWhen: readinessOptions(selectedNode, inspector.selectedStatus),
            targets,
          } : null}
          fileCount={Object.keys(files).length}
          hasFile={inspector.hasFile}
          levels={view.status === 'ok' ? view.derived.levels : null}
          node={selectedNode}
          onClear={inspector.onClear}
          onOpenFile={inspector.onOpenFile}
          onOpenFormEditor={inspector.onOpenFormEditor}
          onSetForEach={inspector.onSetForEach}
          placedNote={inspector.placedNote}
          schemaText={inspector.schemaText}
          templateText={selectedNode && inspector.hasFile(selectedNode.template) ? files[selectedNode.template] : undefined}
        />
      )}
    </>
  )
}

export const kindsPalette: SlotPlugin = { Component: KindsPalette, kind: 'blueprint' }
export const architectureGraphCanvas: CanvasPlugin = { Component: ArchitectureGraphCanvas, frame: 'panes', kind: 'blueprint' }
export const nodeInspector: SlotPlugin = { Component: NodeInspectorColumn, kind: 'blueprint' }
