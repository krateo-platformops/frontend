import type { RefFailure, ResourcesRefs } from '../../types/Widget'

/**
 * A widget's refs, split the way its children are rendered:
 *   denied  `allowed: false`, no `error`: a permission denial, rendered as NOTHING (a denial reads as
 *           absence, X2), and the ids `navModel.isNavEntryAllowed` keys on
 *   failed  `allowed: false` WITH an `error` (snowplow >= 1.12.75): shown in its slot (FailedPart)
 * Both are left out of `allowed`, the list a container resolves children from.
 */
export const partitionRefs = (resourcesRefs?: ResourcesRefs): { deniedRefIds: string[]; failedRefs: Record<string, RefFailure> } => {
  const items = resourcesRefs?.items ?? []
  return {
    deniedRefIds: items.filter(({ allowed, error }) => !allowed && !error).map(({ id }) => id),
    failedRefs: Object.fromEntries(items.flatMap(({ allowed, error, id }) => (!allowed && error ? [[id, error]] : []))),
  }
}
