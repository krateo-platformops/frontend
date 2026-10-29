import { useQuery } from '@tanstack/react-query'
import { createContext, useContext } from 'react'

import { useConfigContext } from '../../context/ConfigContext'
import type { ResourcesRefs } from '../../types/Widget'
import { getAccessToken } from '../../utils/getAccessToken'

import { type FieldOption, type OptionRegistry, parseFieldOptions } from './fieldOptions'

/**
 * The resolved `resourcesRefs` of the Form a schema field belongs to, so a field with
 * `x-krateo-options` can find the RESTAction its `ref` names — and whether snowplow allowed it.
 */
export interface FormRefs {
  resourcesRefs?: ResourcesRefs
  /** refs the user may not call (the WidgetRenderer's reading of `allowed: false`) */
  deniedRefIds?: string[]
  /** what the option fields showed: labels for the Review, closed lists for validation */
  options?: OptionRegistry
}

export const FormRefsContext = createContext<FormRefs>({})

export type FieldOptionsState =
  /** the ref is not among the Form's resourcesRefs — an authoring error */
  | 'missing'
  /** snowplow resolved the ref with `allowed: false` for this user */
  | 'denied'
  | 'loading'
  /** the call failed, or answered with something that is not a list */
  | 'error'
  | 'ready'

export interface FieldOptionsResult {
  state: FieldOptionsState
  options: FieldOption[]
  /** re-run a failed load */
  retry: () => void
}

/**
 * How long an options call may take. A source that is down can leave snowplow waiting on it far
 * longer; past this the field reports a failed load — and, with `fallback: "manual"`, takes a
 * typed value — instead of saying "Loading…" indefinitely.
 */
export const FIELD_OPTIONS_TIMEOUT_MS = 15_000

/**
 * GET the RESTAction path snowplow resolved for the ref, with `extras` merged over any the path
 * already carries. Same auth contract as the widget queries: the user's Bearer token.
 */
export const fetchFieldOptions = async (baseUrl: string, path: string, extras: Record<string, unknown> | undefined): Promise<FieldOption[]> => {
  const url = new URL(`${baseUrl}${path}`)
  if (extras && Object.keys(extras).length) {
    let base: Record<string, unknown> = {}
    try {
      const current: unknown = JSON.parse(url.searchParams.get('extras') ?? '{}')
      if (current && typeof current === 'object' && !Array.isArray(current)) { base = current as Record<string, unknown> }
    } catch {
      // a malformed server-side extras is replaced, not merged
    }
    url.searchParams.set('extras', JSON.stringify({ ...base, ...extras }))
  }
  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${getAccessToken()}` },
    signal: AbortSignal.timeout(FIELD_OPTIONS_TIMEOUT_MS),
  })
  if (!res.ok) {
    throw new Error(`Field options fetch failed: ${res.status}`)
  }
  const options = parseFieldOptions(await res.json())
  if (!options) {
    throw new Error('Field options: the RESTAction status is not a list')
  }
  return options
}

/**
 * Options for one field. A failure stays on the field (its state), never a toast: a form with
 * several option fields would otherwise raise one notification per field, per keystroke.
 */
export const useFieldOptions = (ref: string, extras?: Record<string, unknown>, enabled = true): FieldOptionsResult => {
  const { deniedRefIds, resourcesRefs } = useContext(FormRefsContext)
  const { config } = useConfigContext()
  const baseUrl = config?.api.SNOWPLOW_API_BASE_URL ?? ''

  const resourceRef = resourcesRefs?.items?.find((item) => item.id === ref)
  const denied = !!resourceRef && (resourceRef.allowed === false || !!deniedRefIds?.includes(ref))
  const path = resourceRef && !denied ? resourceRef.path : ''

  const { data, isError, isPending, refetch } = useQuery({
    enabled: enabled && !!path && !!baseUrl,
    gcTime: 5 * 60 * 1000,
    queryFn: () => fetchFieldOptions(baseUrl, path, extras),
    queryKey: ['form-field-options', baseUrl, path, extras ?? null],
    retry: false,
    staleTime: 30 * 1000,
  })

  const retry = () => { void refetch() }
  if (!resourceRef) { return { options: [], retry, state: 'missing' } }
  if (denied) { return { options: [], retry, state: 'denied' } }
  if (isError) { return { options: [], retry, state: 'error' } }
  if (isPending || !data) { return { options: [], retry, state: 'loading' } }
  return { options: data, retry, state: 'ready' }
}
