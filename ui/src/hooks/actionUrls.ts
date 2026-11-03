/**
 * The three pure URL helpers an action dispatch uses, lifted out of `useHandleActions.ts`.
 *
 * WHY THEY MOVED: the same reason `buildPayload` did — the dispatcher is capped at 500 lines
 * (`max-lines`, gated in CI with no baseline and no exceptions), and adding the X5 interaction span
 * to it spent the last of its headroom. These three take no part in the dispatch's state: they are
 * total functions over strings, and the only thing their presence in that file bought was one fewer
 * import. They are re-exported from `useHandleActions` so every existing importer — the fan-out and
 * ops fabrics, and three test suites — is untouched.
 *
 * Nothing about their behaviour changed in the move. They are copied verbatim, with their tests
 * (`useHandleActions.test.ts`, `writeTargetName.test.ts`, `resolveNavigationTarget.test.ts`) still
 * importing them through the dispatcher, which is what proves the re-export is wired.
 */

/**
 * Interpolates a route template using values from a nested payload object.
 * Placeholders in the route must follow the format `${path.to.value}`.
 * If any placeholder cannot be resolved or is not a primitive, the function returns null.
 *
 * Example:
 *   interpolateRedirectUrl({ user: { id: 123 } }, "/profile/${user.id}")
 *   → "/profile/123"
 *
 * @param payload - The object used to resolve placeholders (supports nested values)
 * @param route - The route string containing `${...}` placeholders to be replaced
 * @returns The interpolated route string or null if a placeholder could not be resolved
 */
export const interpolateRedirectUrl = (payload: Record<string, unknown>, route: string): string | null => {
  let allReplacementsSuccessful = true

  const interpolatedRoute = route.replace(/\$\{([^}]+)\}/g, (_, key: string) => {
    const parts = key.split('.')

    let value: unknown = payload
    for (const part of parts) {
      if (typeof value === 'object' && value !== null && Object.prototype.hasOwnProperty.call(value, part)) {
        value = (value as Record<string, unknown>)[part]
      } else {
        value = undefined
        break
      }
    }

    if (
      typeof value === 'string'
      || typeof value === 'number'
      || typeof value === 'boolean'
      || typeof value === 'bigint'
      || typeof value === 'symbol'
    ) {
      return String(value)
    }

    allReplacementsSuccessful = false
    return ''
  })

  return allReplacementsSuccessful ? interpolatedRoute : null
}

/**
 * Adds or replaces `name` and `namespace` query parameters in a given URL.
 * Existing `name` and `namespace` parameters (if any) are removed before appending the new values.
 *
 * Example:
 *   updateNameNamespace("/api?foo=bar&name=old", "my-app", "prod")
 *   → "/api?foo=bar&name=my-app&namespace=prod"
 *
 * @param path - The original URL (may already include query parameters)
 * @param name - The new `name` parameter to set
 * @param namespace - The new `namespace` parameter to set
 * @returns The updated URL with the new query parameters
 */
export const updateNameNamespace = (path: string, name?: string, namespace?: string) => {
  const [base, queryString = ''] = path.split('?')
  const qsParameters = queryString
    .split('&')
    .filter((el) => !el.startsWith('name=') && !el.startsWith('namespace='))
    .join('&')

  // A cluster-scoped target has no namespace, and snowplow distinguishes the two by the
  // param being ABSENT (#156) — so it is omitted rather than interpolated. Interpolating
  // an absent one sent `namespace=undefined`, which the apiserver read as a namespace of
  // that name: POST /apis/kyverno.io/v1/namespaces/undefined/clusterpolicies -> 404.
  const ns = namespace ? `&namespace=${namespace}` : ''

  return `${base}?${qsParameters ? `${qsParameters}&` : ''}name=${name}${ns}`
}

/**
 * Resolve a navigate target, MERGING query parameters when it shares the current
 * pathname. Independent filter controls (the compositions status / time-range chips)
 * each navigate with only their own param — e.g. `/compositions?status=failed` and
 * `/compositions?range=7d`. Without merging, every click would clobber the others'
 * params; with it, `status` and `range` accumulate on the same URL and compose. Targets
 * to a DIFFERENT pathname replace the query as before (a filter must not leak across
 * pages). `window.location` is read at call time so the merge always sees the latest URL.
 */
export const resolveNavigationTarget = (path: string): string => {
  const [targetPath, targetQuery = ''] = path.split('?')
  if (typeof window === 'undefined' || targetPath !== window.location.pathname || !targetQuery) {
    return path
  }

  const merged = new URLSearchParams(window.location.search)
  new URLSearchParams(targetQuery).forEach((value, key) => { merged.set(key, value) })
  const queryString = merged.toString()

  return queryString ? `${targetPath}?${queryString}` : targetPath
}
