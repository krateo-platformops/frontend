/**
 * The Architecture pane — mockup screens 3, 5 and 8: the chart's resources as a graph, the states
 * that graph derives, and a stepper that lights what renders in each.
 *
 * STEPPING IS NOT A RE-LAYOUT. The graph's options depend only on its data (nodes, edges and the
 * stable card renderer), and the data is rebuilt only when the architecture file's text changes.
 * Choosing a state, or a node, changes the ELEMENT STATES of the graph already on screen —
 * `setElementState` on the live G6 graph, which redraws each card where it stands. So the person's
 * pan and zoom survive every click, and the machine is stepped the way the plan describes it: the
 * same picture, lit differently.
 *
 * NEW DATA CARRIES ITS OWN STATES. When the file changes, the graph is laid out again anyway, and the
 * states for the current step and selection travel IN the node and edge data, so that layout draws
 * them. Calling `setElementState` then would race G6's own render of the new data — so it is called
 * only when the step or the selection moves over data G6 has already drawn.
 *
 * EVERY SHAPE OF THE FILE HAS A DESIGNED STATE (architectureView): no file, a file with no
 * descriptor, a descriptor the kernel refuses, a cycle, no resources yet. None of them is a crash
 * and none is a blank box — each says what is missing and what to do about it.
 */
import type { G6 } from '@ant-design/graphs'
import { Button } from 'antd'
import { useCallback, useEffect, useMemo, useRef } from 'react'

import DependencyGraph, { type EdgeAppearance, type EdgeStateStyles, type GraphEdge, type GraphNode } from '../../components/DependencyGraph'

import { ARCHITECTURE_TEMPLATE_PATH } from './architecture'
import canvas from './ArchitectureCanvas.module.css'
import type { ArchitectureEdgeData, ArchitectureGraph, ArchitectureNodeData } from './architectureGraph'
import { ArchitectureNodeCard, NODE_SIZE } from './ArchitectureNodeCard'
import { counted, elementStates, type ArchitectureView } from './architectureView'
import styles from './BlueprintComposer.module.css'
import type { StepperModel } from './stepperModel'

/**
 * How an edge looks as the machine steps — width and opacity only; colours stay the palette's.
 * An edge inside what renders is drawn heavier; an edge into a withheld resource fades with it.
 */
export const STEPPED_EDGE_STATES: EdgeStateStyles = { lit: { lineWidth: 2 }, withheld: { opacity: 0.35 } }

/**
 * An existence-only edge is dashed (DASHED_EDGE's meaning); a readiness edge is solid. The one label
 * is `all` — over a forEach, every instance must satisfy the edge — because a line cannot say it.
 * NOT the edge's `when`: in builder-publish nearly every edge has one, and `.Values.…` paths laid
 * along the curves ran over the cards they connect. The dependent's card is dashed as optional, and
 * the inspector lists each edge's condition in full.
 */
export const architectureEdgeAppearance = (edge: GraphEdge<ArchitectureEdgeData>): EdgeAppearance =>
  ({ dashed: !edge.data?.ready, label: edge.data?.all ? 'all' : undefined })

const NO_CYCLE: string[] = []

interface CanvasStateProps {
  title: string
  children: React.ReactNode
  action?: React.ReactNode
}

/** A canvas with nothing to draw, in the box the graph would occupy. */
const CanvasState = ({ action, children, title }: CanvasStateProps) => (
  <div className={canvas.canvasState} data-testid='canvas-state'>
    <div className={canvas.canvasStateBody}>
      <div aria-hidden='true' className={canvas.canvasGlyph} />
      <p className={canvas.canvasStateTitle}>{title}</p>
      {children}
      {action}
    </div>
  </div>
)

const Stepper = ({ model, onLevel, steps }: { model: StepperModel | null; onLevel: (level: number) => void; steps: StepperModel[] }) => {
  if (!model) {
    return null
  }
  if (model.initial) {
    // The zero-state: one state, nothing in it. Named, so the stepper is never absent — the first
    // resource placed fills the same shape.
    return <span className={styles.countPill}>{`${model.label} · ${model.name}`}</span>
  }
  return (
    <div aria-label='States of the machine' className={canvas.stepper} role='group'>
      {steps.map((step) => (
        <button
          aria-pressed={step.level === model.level}
          className={canvas.step}
          data-done={step.level < model.level ? 'true' : undefined}
          key={step.label}
          onClick={() => onLevel(step.level)}
          type='button'
        >
          <span className={canvas.stepIndex}>{step.label}</span>
          {step.name ?? `level ${step.level + 1}`}
        </button>
      ))}
    </div>
  )
}

export interface ArchitectureCanvasProps {
  view: ArchitectureView
  /** Every state's model, in order — the stepper's steps. Empty when there is no machine. */
  steps: StepperModel[]
  /** The step shown. Null when there is no machine (no file, a refused file, a cycle). */
  model: StepperModel | null
  onLevel: (level: number) => void
  selected: string | null
  onSelect: (id: string) => void
  onOpenFile: (path: string) => void
  onAddDescriptor: () => void
}

export const ArchitectureCanvas = ({ model, onAddDescriptor, onLevel, onOpenFile, onSelect, selected, steps, view }: ArchitectureCanvasProps) => {
  const graph: ArchitectureGraph | null = view.status === 'ok' || view.status === 'cycle' ? view.graph : null
  const cycle = view.status === 'cycle' ? view.cycle : NO_CYCLE

  const states = useMemo(() => (graph ? elementStates(graph, model, selected, cycle) : {}), [cycle, graph, model, selected])
  // Read by the data builders below, which must not depend on it: a step is not new data.
  const statesRef = useRef(states)
  statesRef.current = states
  const nodes = useMemo(
    () => (graph?.nodes ?? []).map((node) => ({ ...node, states: statesRef.current[node.id] ?? [] })),
    [graph],
  )
  const edges = useMemo(
    () => (graph?.edges ?? []).map((edge) => ({ ...edge, states: statesRef.current[edge.id] ?? [] })),
    [graph],
  )

  const graphRef = useRef<G6.Graph | null>(null)
  const drawn = useRef<ArchitectureGraph | null>(null)
  useEffect(() => {
    if (drawn.current !== graph) {
      // New data: its states are in it, and G6 is laying it out right now — see the header.
      drawn.current = graph
      return
    }
    const live = graphRef.current
    if (!live || live.destroyed) {
      return
    }
    // Every element, not only the ones that changed: a node that LEAVES a state must be told.
    // A failure here is a graph mid-teardown; the next step or selection draws again.
    live.setElementState(states, false).catch(() => undefined)
  }, [graph, states])

  // The card renders in G6's own React root, from this closure only; it must be stable, or every
  // render is new options and a re-layout. The handler it calls is read through a ref.
  const selectRef = useRef(onSelect)
  useEffect(() => {
    selectRef.current = onSelect
  }, [onSelect])
  const renderNode = useCallback(
    (node: GraphNode<ArchitectureNodeData>) => <ArchitectureNodeCard node={node} onSelect={(id) => selectRef.current(id)} />,
    [],
  )

  const openDescriptor = (
    <Button onClick={() => onOpenFile(ARCHITECTURE_TEMPLATE_PATH)}>Open {ARCHITECTURE_TEMPLATE_PATH}</Button>
  )

  let body: React.ReactNode
  if (view.status === 'absent') {
    body = (
      <CanvasState
        action={<Button onClick={onAddDescriptor} type='primary'>Add {ARCHITECTURE_TEMPLATE_PATH}</Button>}
        title='This chart has no architecture file'
      >
        <p className={canvas.canvasStateText}>
          There is no <code>{ARCHITECTURE_TEMPLATE_PATH}</code>, so there is no graph to draw and no states to step.
          Charts written before the composer — or by an agent that did not write one — look like this. Chart files,
          Preview and Publish still work. Add the file to describe what the chart deploys and what waits for what;
          it starts empty, and adding it means previewing again before you publish.
        </p>
      </CanvasState>
    )
  } else if (view.status === 'unreadable') {
    body = (
      <CanvasState action={openDescriptor} title='The architecture file carries no descriptor'>
        <p className={canvas.canvasStateText}>
          <code>{ARCHITECTURE_TEMPLATE_PATH}</code> is here, but not the <code>data.architecture</code> block the
          composer and the composition detail page read the descriptor from. Put the block back in Chart files.
        </p>
      </CanvasState>
    )
  } else if (view.status === 'invalid') {
    body = (
      <CanvasState action={openDescriptor} title='The architecture file cannot be drawn'>
        <p className={canvas.canvasStateText}>
          Fix these in Chart files — the same problems keep the chart from being published:
        </p>
        <ul className={canvas.problemList}>
          {view.problems.map((problem) => (
            <li key={`${problem.path}:${problem.message}`}>{problem.path ? `${problem.path} — ${problem.message}` : problem.message}</li>
          ))}
        </ul>
      </CanvasState>
    )
  } else if (view.status === 'ok' && view.architecture.resources.length === 0) {
    body = (
      <CanvasState action={openDescriptor} title='No resources yet'>
        <p className={canvas.canvasStateText}>
          Each resource becomes a node here and a file in <code>templates/</code>. Add one by editing
          {' '}<code>{ARCHITECTURE_TEMPLATE_PATH}</code> in Chart files below, or ask Autopilot to add it — placing
          them from a palette comes later. A <code>dependsOn</code> entry from A to B says A waits for B.
        </p>
      </CanvasState>
    )
  } else {
    body = (
      <>
        {view.status === 'cycle' ? (
          <p className={canvas.cycleNote} role='alert'>
            {`The dependencies form a cycle: ${view.cycle.join(' → ')}. A chart with a cycle never leaves its first state, so there are no states to step — remove one of these dependsOn entries in ${ARCHITECTURE_TEMPLATE_PATH}.`}
          </p>
        ) : null}
        <div className={canvas.graph} data-testid='architecture-graph'>
          <DependencyGraph<ArchitectureNodeData, ArchitectureEdgeData>
            edgeAppearance={architectureEdgeAppearance}
            edgeStates={STEPPED_EDGE_STATES}
            edges={edges}
            graphRef={graphRef}
            nodeSize={NODE_SIZE}
            nodes={nodes}
            onNodeClick={onSelect}
            renderNode={renderNode}
          />
        </div>
      </>
    )
  }

  const resources = view.status === 'ok' || view.status === 'cycle' ? view.architecture.resources.length : null
  let stateCount: string | null = null
  if (view.status === 'cycle') {
    stateCount = 'no states'
  } else if (model) {
    stateCount = counted(model.total, 'state')
  }

  return (
    <section aria-label='Architecture' className={styles.pane}>
      <div className={styles.paneHead}>
        <span className={styles.paneTitle}>Architecture</span>
        {resources === null ? null : <span className={styles.countPill}>{counted(resources, 'resource')}</span>}
        {stateCount ? <span className={styles.countPill}>{stateCount}</span> : null}
        <span className={styles.spacer} />
        {model ? <span className={styles.eyebrow}>{model.initial ? 'States' : 'Step the machine'}</span> : null}
        <Stepper model={model} onLevel={onLevel} steps={steps} />
      </div>
      {body}
      {model && !model.initial ? (
        <div className={styles.paneFoot}>
          <p className={canvas.caption}>
            States are derived from the dependsOn edges, never written by hand — each column is one. Nothing here needs a
            cluster: it is the machine <code>helm template</code> cannot show, because it has nothing to look up.
          </p>
        </div>
      ) : null}
    </section>
  )
}

export default ArchitectureCanvas
