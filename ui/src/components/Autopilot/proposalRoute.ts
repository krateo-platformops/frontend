/**
 * Which of the provider's paths an agent proposal takes — lifted out of AutopilotProvider.finalize so
 * the dispatch can be tested without mounting the provider.
 *
 * - `prefillForm`: provider state, never dispatched.
 * - `publish`: publishDraft — ONLY a publish verb (PUBLISH_VERBS) whose publisher is known. A
 *   Builder's `verbs.allowed` also lists its compose, chart and preview verbs; those must reach
 *   `apply`, never the publish form.
 * - `applyResourceSet`: the host-gated write set.
 * - `apply`: every other verb, through the action bridge (previews, compose, chart verbs, …).
 */
import { publisherOfVerb } from './publishDraft'

export type ProposalRoute = 'prefillForm' | 'publish' | 'applyResourceSet' | 'apply'

export const routeProposal = (verb: string): ProposalRoute => {
  if (verb === 'prefillForm') {
    return 'prefillForm'
  }
  if (publisherOfVerb(verb)) {
    return 'publish'
  }
  return verb === 'applyResourceSet' ? 'applyResourceSet' : 'apply'
}
