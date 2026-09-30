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

import { builderOf } from './builderRegistry'

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
}

const DRAFT_KINDS = {
  blueprint: {
    description: 'a Helm chart, named by its Chart.yaml',
    displayName: draftDisplayName,
    nouns: {
      artifact: 'a blueprint chart',
      composer: 'blueprint',
      previewFirst: 'chart',
      previewed: 'blueprint',
      renameHint: '',
      short: 'chart',
    },
    publishSlug: draftDisplayName,
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
    publishSlug: pageRootSlug,
  },
} satisfies Record<string, DraftKindPlugin>

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
