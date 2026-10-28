import type { WidgetAction } from '../../types/Widget'

/** A `rest` action, narrowed: the rest path is the one the payload-merge logic runs on. */
export type RestAction = WidgetAction & { type: 'rest' }

/** Minimal valid rest action; callers override payload / payloadToOverride. */
export const restAction = (over: Partial<RestAction> = {}): RestAction => ({
  headers: [],
  id: 'a1',
  resourceRefId: 'ref',
  type: 'rest',
  ...over,
})
