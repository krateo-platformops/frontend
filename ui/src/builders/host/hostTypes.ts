/**
 * The composer host's contracts (T4, frontend#410): what the host hands a builder's workbench, what the
 * workbench hands back, and the one props shape every palette, canvas and inspector plugin takes.
 *
 * THREE LAYERS, each owning what only it can know:
 *
 * - The HOST (ComposerHost.tsx) is the same for every Builder. It owns what both composers used to
 *   wire by hand: whose draft is held (the draft broadcast and its replay), the preview-surface claim,
 *   the header — title, save indicator, pills, Preview · Undo · Publish · Close draft — the publish
 *   request and its answer, Resume, the file focus and edit verdicts of the PreviewContent tabs, and
 *   the frame the slots sit in.
 * - The WORKBENCH (workbenches.ts) is keyed by the Builder's `spec.draftKind`: the editor state a
 *   palette, a canvas and an inspector SHARE about one kind of draft — a chart's selection and edges,
 *   a page's drag in the air. It is code because a draft kind's file model is code (draftKinds.ts).
 * - The SLOT PLUGINS (pluginRegistry.ts) are named by the Builder. Each takes `SlotProps` and draws
 *   its part of the workbench; a plugin states the draft kind it draws, and the host refuses a Builder
 *   that pairs it with another.
 */
import type { ComponentType, ReactNode, RefObject } from 'react'

import type { DraftKind } from '../../components/Autopilot/blueprintDraftStore'
import type { AutopilotPreviewPayload } from '../../components/Autopilot/previewBus'
import type { ComposerMode, DraftChangedDetail } from '../../components/Autopilot/previewDraftChanged'
import type { FileHighlight } from '../../components/Autopilot/previewSurface'
import type { Config } from '../../context/ConfigContext'
import type { Builder, BuilderSpec } from '../builderSpec'

/** The frames a canvas plugin sits in — see frames.ts. */
export type FrameName = 'panes' | 'split'

/** What the host knows, handed to the workbench on every render. */
export interface HostDraft {
  builder: Builder
  spec: BuilderSpec
  kind: DraftKind
  /** The install config's api block, when a ConfigContext is mounted (the composers mount bare in tests). */
  api: Config['api'] | undefined
  /** The last draft broadcast. */
  held: DraftChangedDetail
  mode: ComposerMode
  /** The held files when the draft is this Builder's own; an empty record otherwise — never another kind's. */
  files: Readonly<Record<string, string>>
  /** Reveal a file in the files pane — again, when it is asked for again. */
  openFile: (path: string | null) => void
  /** Clear the files pane's edit verdicts — a new payload was adopted. */
  resetVerdicts: () => void
  /** The side column, for a workbench that moves focus into it. */
  sideRef: RefObject<HTMLDivElement | null>
}

/**
 * What a workbench returns to the host. Everything the host draws that is not the same for every
 * draft kind is here; everything absent is the host's own.
 */
export interface Workbench<S = unknown> {
  kind: DraftKind
  /** The files pane's payload, or null — nothing of this Builder's is shown, and the empty state is. */
  shown: AutopilotPreviewPayload | null
  /** The draft's name and a mono meta line, for the in-page head (the `panes` frame). */
  title: { name: string; meta: string }
  /** A render preview: the request, and whether one is on the wire. Absent for a live (sandbox-apply) preview. */
  preview?: { pending: boolean; run: () => void }
  /** PreviewContent's per-builder props. */
  files: {
    caption?: string
    highlight?: FileHighlight | null
    sourceNotes?: string[]
  }
  /** Header notices between the draft's problems and the publish answer. */
  notices: ReactNode
  /** Nothing of this Builder's is held (or another kind's is): the empty state, with its start. */
  empty: ReactNode
  /** Mounted before the header, in every state. */
  before?: ReactNode
  /** Mounted after the body, while it is shown. */
  after?: ReactNode
  /** Around the body — one drag context over the palette and the canvas. */
  wrapBody?: (body: ReactNode) => ReactNode
  /** A resumed draft replaced the one held: forget what was kept about it. */
  onResumed: () => void
  /** The workbench's state, for its slot plugins. */
  slots: S
}

/** The props every palette, canvas and inspector plugin takes. */
export interface SlotProps {
  workbench: Workbench
}

/** A slot plugin: the component, and the draft kind whose workbench it draws. */
export interface SlotPlugin {
  kind: DraftKind
  Component: ComponentType<SlotProps>
}

/** A canvas plugin also names the frame it sits in. */
export interface CanvasPlugin extends SlotPlugin {
  frame: FrameName
}

/** A workbench registration, by draft kind. */
export interface WorkbenchPlugin {
  description: string
  useWorkbench: (host: HostDraft) => Workbench
  /** `?adopt=` adopts a legacy draft of this kind (useDraftResume). */
  allowAdopt: boolean
  /** The composer's subtitle: what a person authors here, in one sentence. */
  summary: string
}
