/**
 * "Publish this draft" — a person clicking Publish, on the path the agent's verb already takes.
 *
 * WHY A BUS RATHER THAN A PROP. The composer is a ROUTE; the publish machinery — the destination
 * form, the preview gate, the blast-radius dispatcher — lives in `AutopilotProvider`, which wraps
 * the routed outlet but exposes none of it. Same seam, same reason, as the edit/add/start buses:
 * the surface asks, the provider decides. Nothing about the gate moves closer to the caller.
 *
 * WHY THE OUTCOME COMES BACK ON AN EVENT. A publish ends in a modal the person confirms and then a
 * dispatch; the surface that asked needs to know what happened without owning any of it. So the
 * request carries a correlation id and the provider answers with the same one — the composer shows
 * its own result rather than sending the author to the chat rail to find out.
 */

export const AUTOPILOT_PUBLISH_REQUEST_EVENT = 'autopilotPublishRequest'
export const AUTOPILOT_PUBLISH_RESULT_EVENT = 'autopilotPublishResult'

export interface PublishRequestDetail {
  /** Correlates the result. The caller generates it and ignores answers that are not its own. */
  id: string
  /** `publishPage` or `publishBlueprint` — the same verbs the model emits. */
  verb: 'publishPage' | 'publishBlueprint'
}

export interface PublishResultDetail {
  id: string
  /** Null when the publish was dispatched; otherwise why it was refused or cancelled. */
  denial: string | null
  /** The SCM change-request URL, when the publish produced one. */
  deepLink: string | null
}

export const emitPublishRequest = (detail: PublishRequestDetail): void => {
  window.dispatchEvent(new CustomEvent<PublishRequestDetail>(AUTOPILOT_PUBLISH_REQUEST_EVENT, { detail }))
}

export const onPublishRequest = (handler: (detail: PublishRequestDetail) => void): (() => void) => {
  const listener = (event: Event): void => {
    const { detail } = event as CustomEvent<PublishRequestDetail>
    if (detail && typeof detail.id === 'string' && detail.verb) {
      handler(detail)
    }
  }
  window.addEventListener(AUTOPILOT_PUBLISH_REQUEST_EVENT, listener)
  return () => window.removeEventListener(AUTOPILOT_PUBLISH_REQUEST_EVENT, listener)
}

export const emitPublishResult = (detail: PublishResultDetail): void => {
  window.dispatchEvent(new CustomEvent<PublishResultDetail>(AUTOPILOT_PUBLISH_RESULT_EVENT, { detail }))
}

export const onPublishResult = (handler: (detail: PublishResultDetail) => void): (() => void) => {
  const listener = (event: Event): void => {
    const { detail } = event as CustomEvent<PublishResultDetail>
    if (detail && typeof detail.id === 'string') {
      handler(detail)
    }
  }
  window.addEventListener(AUTOPILOT_PUBLISH_RESULT_EVENT, listener)
  return () => window.removeEventListener(AUTOPILOT_PUBLISH_RESULT_EVENT, listener)
}
