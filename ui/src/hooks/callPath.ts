/**
 * callPath — the ONE builder for snowplow `/call` WRITE paths.
 *
 * snowplow serves every apiserver write (POST/PUT/PATCH/DELETE — the HTTP method is the
 * verb) ONLY on `/call`, with the target encoded as QUERY parameters. It has NO raw
 * `/apis/...` route: a raw apiserver path fetched against the snowplow base URL matches
 * no mux route and 404s (the live "provenance: AuditRecord not persisted (HTTP 404)"
 * failure this module fixes).
 *
 * The VERIFIED contract (snowplow internal/handlers/call.go `validateRequest`):
 *   - `apiVersion` — `<group>/<version>`, or the BARE version for the core group
 *     (util.ParseGVR → schema.ParseGroupVersion). This is exactly how snowplow's own
 *     resourcesrefs resolver encodes the widget-action paths the portal already fires:
 *     `gvr.GroupVersion().String()`.
 *   - `resource` — the resource PLURAL.
 *   - `namespace` AND `name` — util.ParseNamespacedName requires BOTH non-empty for
 *     EVERY verb, including a collection POST. `buildURIPath` then joins `name` into the
 *     apiserver URI only for GET/PUT/PATCH/DELETE — for POST the name is validated but
 *     IGNORED (the create hits the collection). The widget write path satisfies this by
 *     appending the payload's metadata.name (updateNameNamespace); a caller with no
 *     natural object name (create-with-generateName) gets the COLLECTION_POST_NAME
 *     placeholder below.
 */

/** The apiserver target of a `/call` write. Core group is the empty string. */
export interface CallWriteTarget {
  group: string
  version: string
  resource: string
  namespace: string
  /** Object name. Omit ONLY for a collection POST (create): the builder substitutes the
   * required-but-ignored COLLECTION_POST_NAME placeholder. */
  name?: string
}

/**
 * The `name` placeholder for a collection POST with no natural object name (e.g. a
 * create-with-generateName). snowplow REQUIRES a non-empty `name` query param on every
 * verb but IGNORES its value when building a POST's apiserver URI, so any token works;
 * `-` is never a legal DNS-1123 name (labels must start/end alphanumeric), so
 * `parseTargetFromPath` can safely map it back to "no name" in the W0-2 confirm.
 */
export const COLLECTION_POST_NAME = '-'

/**
 * Build the `/call?...` write path for a target — the ONLY shape snowplow serves writes
 * on. Values are URL-encoded (the `/` in a group/version apiVersion becomes `%2F`,
 * matching snowplow's own url.Values encoding of widget-action paths).
 */
export const buildCallWritePath = ({ group, name, namespace, resource, version }: CallWriteTarget): string => {
  const params = new URLSearchParams()
  params.set('apiVersion', group ? `${group}/${version}` : version)
  params.set('resource', resource)
  params.set('name', name || COLLECTION_POST_NAME)
  params.set('namespace', namespace)

  return `/call?${params.toString()}`
}

/**
 * The `name`/`namespace` a widget write must put on its `/call` path, given the payload
 * it is about to send.
 *
 * snowplow's `validateRequest` requires BOTH `name` and `namespace` to be non-empty on
 * EVERY verb, a collection POST included (see the contract at the top of this module).
 * The widget write paths took the object's name from `payload.metadata.name` and skipped
 * the rewrite entirely when it was absent:
 *
 *     const path = (name ?? namespace) ? updateNameNamespace(refPath, name, namespace) : refPath
 *
 * `??` only falls through on null/undefined, so an EMPTY-STRING name — what a server-side
 * `widgetDataTemplate` yields when its source field resolves to nothing, e.g.
 * `name: (.claimName // "")` — left `""`, which is falsy, so the ternary dropped `name`
 * AND `namespace` and sent the bare collection path. snowplow then answered
 * `400 missing 'name' query parameter`, which names the query parameter rather than the
 * empty field that caused it. Measured 2026-10-07 on the Platform Review "Open change
 * request" drawer, where it meant `builder: review` had never once produced a
 * BuilderPublish (frontend#475).
 *
 * A POST therefore falls back to COLLECTION_POST_NAME, exactly as `buildCallWritePath`
 * already does for the AuditRecord create. A name-addressed verb does NOT: for
 * PUT/PATCH/DELETE the name is joined into the apiserver URI, so substituting a
 * placeholder would aim the write at a resource called `-` instead of failing — those
 * keep the old behaviour and surface the apiserver's own error.
 */
export const writeTargetName = (verb: string | undefined, name: unknown): string | undefined => {
  const given = typeof name === 'string' && name.length > 0 ? name : undefined

  return given ?? (verb?.toUpperCase() === 'POST' ? COLLECTION_POST_NAME : undefined)
}
