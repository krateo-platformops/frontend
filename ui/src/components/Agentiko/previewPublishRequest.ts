/**
 * "Publish this draft" — a person clicking Publish, on the path the agent's verb already takes.
 *
 * WHY A BUS RATHER THAN A PROP. The composer is a ROUTE; the publish machinery — the destination
 * form, the preview gate, the blast-radius dispatcher — lives in `AgentikoProvider`, which wraps
 * the routed outlet but exposes none of it. Same seam, same reason, as the edit/add/start buses:
 * the surface asks, the provider decides. Nothing about the gate moves closer to the caller.
 *
 * WHY THE OUTCOME COMES BACK ON AN EVENT. A publish ends in a modal the person confirms and then a
 * dispatch; the surface that asked needs to know what happened without owning any of it. So the
 * request carries a correlation id and the provider answers with the same one — the composer shows
 * its own result rather than sending the author to the chat rail to find out.
 *
 * AND THE MOMENT IT WAS CONFIRMED, on a third event with the same id. Between the press and the
 * write sit two human gates the provider owns — the destination form ("Where should this page be
 * committed?") and the blast-radius confirm — and the surface's X5 span (`krateo.page.publish`)
 * must start at the second one's Confirm, not at the press: the gates are a person's dwell, not
 * the platform's latency. Only the provider sees that Confirm, so it says when it happened. A
 * publish cancelled at either gate, or refused before them, emits no confirmation — only a result.
 */

export const AGENTIKO_PUBLISH_REQUEST_EVENT = 'agentikoPublishRequest'
export const AGENTIKO_PUBLISH_CONFIRMED_EVENT = 'agentikoPublishConfirmed'
export const AGENTIKO_PUBLISH_RESULT_EVENT = 'agentikoPublishResult'

export interface PublishRequestDetail {
  /** Correlates the result. The caller generates it and ignores answers that are not its own. */
  id: string
  /** `publishPage`, `publishBlueprint` or `publishRestDef` — the same verbs the model emits. */
  verb: 'publishPage' | 'publishBlueprint' | 'publishRestDef'
}

export interface PublishResultDetail {
  id: string
  /** Null when the publish was dispatched; otherwise why it was refused or cancelled. */
  denial: string | null
  /** The SCM change-request URL, when the publish produced one. */
  deepLink: string | null
}

export const emitPublishRequest = (detail: PublishRequestDetail): void => {
  window.dispatchEvent(new CustomEvent<PublishRequestDetail>(AGENTIKO_PUBLISH_REQUEST_EVENT, { detail }))
}

export const onPublishRequest = (handler: (detail: PublishRequestDetail) => void): (() => void) => {
  const listener = (event: Event): void => {
    const { detail } = event as CustomEvent<PublishRequestDetail>
    if (detail && typeof detail.id === 'string' && detail.verb) {
      handler(detail)
    }
  }
  window.addEventListener(AGENTIKO_PUBLISH_REQUEST_EVENT, listener)
  return () => window.removeEventListener(AGENTIKO_PUBLISH_REQUEST_EVENT, listener)
}

/** The person confirmed the publish's write: the blast-radius confirm was answered, nothing is sent yet. */
export interface PublishConfirmedDetail {
  /** The request's id, as on its result. */
  id: string
}

export const emitPublishConfirmed = (detail: PublishConfirmedDetail): void => {
  window.dispatchEvent(new CustomEvent<PublishConfirmedDetail>(AGENTIKO_PUBLISH_CONFIRMED_EVENT, { detail }))
}

export const onPublishConfirmed = (handler: (detail: PublishConfirmedDetail) => void): (() => void) => {
  const listener = (event: Event): void => {
    const { detail } = event as CustomEvent<PublishConfirmedDetail>
    if (detail && typeof detail.id === 'string') {
      handler(detail)
    }
  }
  window.addEventListener(AGENTIKO_PUBLISH_CONFIRMED_EVENT, listener)
  return () => window.removeEventListener(AGENTIKO_PUBLISH_CONFIRMED_EVENT, listener)
}

export const emitPublishResult = (detail: PublishResultDetail): void => {
  window.dispatchEvent(new CustomEvent<PublishResultDetail>(AGENTIKO_PUBLISH_RESULT_EVENT, { detail }))
}

export const onPublishResult = (handler: (detail: PublishResultDetail) => void): (() => void) => {
  const listener = (event: Event): void => {
    const { detail } = event as CustomEvent<PublishResultDetail>
    if (detail && typeof detail.id === 'string') {
      handler(detail)
    }
  }
  window.addEventListener(AGENTIKO_PUBLISH_RESULT_EVENT, listener)
  return () => window.removeEventListener(AGENTIKO_PUBLISH_RESULT_EVENT, listener)
}
