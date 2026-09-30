/**
 * WHOSE DRAFT IS HELD, from the side of a composer hosting a Builder of `draftKind`.
 *
 * The broadcast's `kind` says: a draft of this Builder's kind is drawn (`own`), a draft of any other
 * kind is parked behind the empty state, never read. A broadcast with NO `kind` is a legacy emitter,
 * which only ever held LEGACY_PAYLOAD_DRAFT_KIND drafts — so its files are that kind's (a null kind is
 * no legacy emitter: nothing is held). This is composerModeOf's rule with the legacy kind said by the
 * protocol rather than per composer: the Page Composer drew a kind-less draft, the Blueprint Composer
 * parked it, and both still do.
 */
import type { DraftKind } from '../../components/Autopilot/blueprintDraftStore'
import { LEGACY_PAYLOAD_DRAFT_KIND } from '../../components/Autopilot/previewBus'
import type { ComposerMode, DraftChangedDetail } from '../../components/Autopilot/previewDraftChanged'

export const heldModeOf = ({ files, kind }: Pick<DraftChangedDetail, 'files' | 'kind'>, draftKind: DraftKind): ComposerMode => {
  const legacy = Object.keys(files).length ? LEGACY_PAYLOAD_DRAFT_KIND : null
  const heldKind = kind === undefined ? legacy : kind
  if (!heldKind) {
    return 'empty'
  }
  return heldKind === draftKind ? 'own' : 'parked'
}
