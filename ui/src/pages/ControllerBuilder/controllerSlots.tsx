/**
 * The Controller Builder's slot plugins (T8, frontend#412) — `openapi` (palette), `restdef-graph`
 * (canvas, in the `panes` frame the Blueprint Composer uses) and `restdef-mapping` (inspector) — each
 * drawing its part of the controller workbench (useControllerWorkbench). Registered by name in
 * builders/pluginRegistry.ts.
 */
import type { CanvasPlugin, SlotPlugin, SlotProps } from '../../builders/host/hostTypes'

import ControllerCanvas from './ControllerCanvas'
import ControllerPalette from './ControllerPalette'
import KindInspector from './KindInspector'
import type { ControllerSlots } from './useControllerWorkbench'

/** The workbench's slots — the host has already checked that this plugin's kind is the workbench's. */
const slotsOf = ({ workbench }: SlotProps): ControllerSlots => workbench.slots as ControllerSlots

const OpenApiPalette = (props: SlotProps) => <ControllerPalette {...slotsOf(props).palette} />
const RestDefGraphCanvas = (props: SlotProps) => <ControllerCanvas {...slotsOf(props).canvas} />
const RestDefMappingInspector = (props: SlotProps) => <KindInspector {...slotsOf(props).inspector} />

export const openapiPalette: SlotPlugin = { Component: OpenApiPalette, kind: 'controller' }
export const restdefGraphCanvas: CanvasPlugin = { Component: RestDefGraphCanvas, frame: 'panes', kind: 'controller' }
export const restdefMappingInspector: SlotPlugin = { Component: RestDefMappingInspector, kind: 'controller' }
