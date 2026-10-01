/**
 * The draft-kind plugins — what the engine needs to know about a draft of one kind that the Builder
 * CR cannot say as data (T2, frontend#408).
 *
 * WHY A PLUGIN, KEYED BY `spec.draftKind`. Where a draft's NAME lives is code: a page names itself by
 * its `templates/flex.page-<slug>.yaml` root, a chart by its Chart.yaml. So is the wording that names
 * the artifact in a refusal or a banner ("a portal page", "a blueprint chart"): the v1alpha1 CRD has
 * no field for it, and inventing one here would put copy in the schema before the Controller Builder
 * has shown what it needs. The engine asks this table instead of switching on `'page'`/`'blueprint'`,
 * and a Builder picks its entry by its draftKind. Moving the nouns into the CR later is a CRD change
 * (ADR 0001, promotion step 4) that touches only this file's callers' lookups.
 *
 * DENY BY DEFAULT, like pluginRegistry: only an own key resolves.
 */
import { draftDisplayName } from '../components/Autopilot/blueprintDraft'
import { pageRootSlug } from '../components/Autopilot/pageDraft'
import { completeLockedSnapshot, lockedSnapshot, servedVersionUnknownProblems } from '../pages/ControllerComposer/controllerChart'

import { builderOf, findBuilderOf } from './builderRegistry'

export interface DraftKindNouns {
  /** The artifact with its article: "a portal page". */
  artifact: string
  /** The artifact in one word, as a banner says it: "page". */
  short: string
  /** Which composer: "the page composer". */
  composer: string
  /** What must have been previewed before a publish: "portal page". */
  previewed: string
  /** What to draft and preview first: "page-<slug>". */
  previewFirst: string
  /** Appended to a rename hint, or empty: " (a page set is named for its page slug)". */
  renameHint: string
}

export interface DraftKindPlugin {
  description: string
  /**
   * The name a held draft is FILED under (its draft record) — the name the builder shows. A rename is
   * a different record.
   */
  displayName: (files: Record<string, string>) => string
  /**
   * The slug a publish names the branch, the repository prefill and the claim for — null when the
   * files do not carry one.
   */
  publishSlug: (files: Record<string, string>) => string | null
  nouns: DraftKindNouns
  /**
   * The fields a PUBLISHED draft of this kind may no longer change (CEL-immutable once installed),
   * snapshotted when a publish lands and kept on its record. Absent: nothing is locked by a publish.
   */
  lockedSnapshot?: (files: Record<string, string>) => Record<string, Record<string, unknown>>
  /**
   * A record's lock, completed from the files it holds when it predates a field this build locks (a
   * controller published before its served version was locked). `trusted`: the files are still the
   * tree that rendered, so they say what was published. Absent: the lock is used as stored.
   */
  completeLocked?: (locked: Record<string, Record<string, unknown>>, files: Record<string, string>, trusted: boolean) => Record<string, Record<string, unknown>>
  /**
   * Why a draft of this kind, lint-clean and previewed, still cannot be published under its lock (a
   * controller whose published served version is unknown). Absent: nothing beyond the lint.
   */
  publishProblems?: (files: Record<string, string>, locked: Record<string, Record<string, unknown>> | null) => string[]
}

/*
 * Each entry reaches its helpers through an arrow, never by value: blueprintDraftStore imports this
 * module, and a helper module that (transitively) imports the store would otherwise be read here
 * before it finished evaluating.
 */
const DRAFT_KINDS = {
  blueprint: {
    description: 'a Helm chart, named by its Chart.yaml',
    displayName: (files) => draftDisplayName(files),
    nouns: {
      artifact: 'a blueprint chart',
      composer: 'blueprint',
      previewFirst: 'chart',
      previewed: 'blueprint',
      renameHint: '',
      short: 'chart',
    },
    publishSlug: (files) => draftDisplayName(files),
  },
  /*
   * The Controller Builder's draft (T3, frontend#409): a chart of RestDefinitions and their OAS
   * ConfigMaps, seeded from builder-scaffold (frontend#405, "A controller is a chart") — so it is
   * named by its Chart.yaml exactly as a blueprint is, and its record is
   * `draft-controller-<owner>-<chart name>`.
   */
  controller: {
    // A RestDefinition's kind, group, identifiers, configuration and status fields are CEL-immutable,
    // and the version its Kinds are served under is the published document's info.version.
    completeLocked: (locked, files, trusted) => completeLockedSnapshot(locked, files, trusted),
    description: 'a controller chart — RestDefinitions and their OpenAPI documents — named by its Chart.yaml',
    displayName: (files) => draftDisplayName(files),
    lockedSnapshot: (files) => lockedSnapshot(files),
    nouns: {
      artifact: 'a controller',
      composer: 'controller',
      previewFirst: 'controller',
      previewed: 'controller',
      renameHint: '',
      short: 'controller',
    },
    publishProblems: (files, locked) => servedVersionUnknownProblems(files, locked),
    publishSlug: (files) => draftDisplayName(files),
  },
  page: {
    description: 'a portal page set, named by its templates/flex.page-<slug>.yaml root',
    displayName: (files) => pageRootSlug(files) ?? 'draft',
    nouns: {
      artifact: 'a portal page',
      composer: 'page',
      previewFirst: 'page-<slug>',
      previewed: 'portal page',
      renameHint: ' (a page set is named for its page slug)',
      short: 'page',
    },
    publishSlug: (files) => pageRootSlug(files),
  },
} satisfies Record<string, DraftKindPlugin>

/**
 * The draft kinds this build has a plugin for — the type every held draft's `kind` is. A value of
 * this type is not yet a kind that may be HELD: that needs a Builder declaring it too (`isDraftKind`).
 */
export type DraftKindName = keyof typeof DRAFT_KINDS

/** The draft kinds this frontend has a plugin for. */
export const draftKindNames = (): string[] => Object.keys(DRAFT_KINDS).sort()

/**
 * The plugin for a Builder's draftKind, or undefined when this build has none (a Builder written for a
 * newer frontend). Never throws.
 */
export const findDraftKindPlugin = (draftKind: string | null | undefined): DraftKindPlugin | undefined =>
  (typeof draftKind === 'string' && Object.prototype.hasOwnProperty.call(DRAFT_KINDS, draftKind)
    ? (DRAFT_KINDS as Record<string, DraftKindPlugin>)[draftKind]
    : undefined)

/**
 * THE DENY-BY-DEFAULT CHECK for a draft kind that arrived as data — a record read back, a bus
 * detail, a store write: true only when this build has a draft-kind plugin for it AND exactly one
 * loaded Builder declares it as its `spec.draftKind`. A kind with a plugin but no Builder (the
 * Builder was not loaded) is as unheld as one nobody has heard of: nothing could preview, lint,
 * publish or resume it.
 */
export const isDraftKind = (kind: unknown): kind is DraftKindName =>
  typeof kind === 'string' && findDraftKindPlugin(kind) !== undefined && findBuilderOf(kind) !== undefined

/**
 * The plugin for a draft kind this build's DraftKind type names. Throws only for a kind with no entry,
 * which draftKinds.test.ts refuses for every fixture's draftKind.
 */
export const draftKindPlugin = (draftKind: string): DraftKindPlugin => {
  const plugin = findDraftKindPlugin(draftKind)
  if (!plugin) {
    throw new Error(`This frontend has no draft-kind plugin named "${draftKind}"; it ships: ${draftKindNames().join(', ')}.`)
  }
  return plugin
}

/**
 * The plugin a HELD draft's Builder names: the Builder that declares the draft's kind, then the
 * draft-kind plugin its `spec.draftKind` names. What every engine module asks.
 */
export const draftKindOf = (heldKind: string): DraftKindPlugin => draftKindPlugin(builderOf(heldKind).draftKind)
