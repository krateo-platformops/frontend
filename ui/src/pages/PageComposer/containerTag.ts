/**
 * The at-rest tag a canvas frame shows for what a container will take — or null for no tag.
 *
 * IT SAID "cards only" ON A PAGE THAT HELD A PAGEHEADER AND A CARD. The tag printed
 * `allowedResources` followed by "only" for any non-empty list, and that list is not always a rule.
 * `placeChild` appends each child's plural because the CRD needs it listed, so a container the
 * composer created (annotated DERIVED_ALLOWED_ANNOTATION) GROWS its list as things land in it — and
 * a page root seeded with its header lists nothing for it, so the first Card dropped in made the
 * list `[cards]` and the frame announce "cards only" beside the PageHeader it also held. Nor was it
 * a constraint: `canAccept` ignores a derived list and takes anything. The tag was false both ways.
 *
 * So the tag is shown only where "only" is TRUE, and says what it is true of:
 *   - a DERIVED list is the composer's own bookkeeping — no tag; the frame's children already show
 *     what it holds, and the container accepts anything;
 *   - an absent or empty list is "the author has not said" — no tag;
 *   - an author's non-empty list is a rule `canAccept` enforces on every drop, and a rule about what
 *     may be ADDED, not a description of what is there (a hand-written list can sit beside children
 *     outside it). Hence "accepts … only", never "… only".
 */
import type { TreeNode } from './objectTree'

export const containerTag = (node: Pick<TreeNode, 'allowedDerived' | 'allowedResources'>): string | null => {
  if (node.allowedDerived || !node.allowedResources?.length) {
    return null
  }
  return `accepts ${node.allowedResources.join(', ')} only`
}
