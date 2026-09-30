/**
 * The Portal Builder's slot plugins — `widgets` (palette), `page-grid` (canvas) and `object-tree`
 * (inspector) — each drawing its part of the page workbench (usePageWorkbench) inside the `split`
 * frame ComposerHost gives it. Registered by name in builders/pluginRegistry.ts.
 *
 * THE ORDER FOLLOWS THE WORK: pick something (palette), place it (canvas), operate on it (tree). All
 * three are mounted at once — a drag cannot cross a tab boundary, so the palette and the canvas MUST
 * share a screen; and the tree is the keyboard-operable route to the same edits (move, wrap, add
 * inside, remove, bind), so hiding it behind a tab would take those controls from anyone not using a
 * pointer.
 */
import { Typography } from 'antd'

import type { CanvasPlugin, SlotPlugin, SlotProps } from '../../builders/host/hostTypes'

import CanvasPanel from './CanvasPanel'
import ObjectTreePanel from './ObjectTreePanel'
import PalettePanel from './PalettePanel'
import type { PageSlots } from './usePageWorkbench'

/** The workbench's slots — the host has already checked that this plugin's kind is the workbench's. */
const slotsOf = ({ workbench }: SlotProps): PageSlots => workbench.slots as PageSlots

const WidgetsPalette = (props: SlotProps) => (
  <>
    <Typography.Text strong>Add</Typography.Text>
    <PalettePanel {...slotsOf(props).palette} />
  </>
)

const PageGridCanvas = (props: SlotProps) => (
  <>
    <Typography.Text strong>Layout</Typography.Text>
    <CanvasPanel {...slotsOf(props).canvas} />
  </>
)

/** Draws its own box and heading — see .structure for why the frame does not wrap it in one. */
const ObjectTree = (props: SlotProps) => <ObjectTreePanel {...slotsOf(props).inspector} />

export const widgetsPalette: SlotPlugin = { Component: WidgetsPalette, kind: 'page' }
export const pageGridCanvas: CanvasPlugin = { Component: PageGridCanvas, frame: 'split', kind: 'page' }
export const objectTreeInspector: SlotPlugin = { Component: ObjectTree, kind: 'page' }
