import { useConfigContext } from '../context/ConfigContext'

import { getAccessToken } from './getAccessToken'

/**
 * A `${ … }` wrapper that is not a wrapper at all. Thrown rather than returned, because the value
 * this function used to return in its place was THE EXPRESSION'S OWN SOURCE TEXT — which a caller
 * then wrote into a request body. `useHandleActions` catches it and shows the person a notification;
 * nothing is dispatched, because the throw happens while the payload is still being built.
 */
export class JqExpressionError extends Error {
  constructor(expression: string) {
    super(`Not a \${…} expression: ${JSON.stringify(expression.length > 120 ? `${expression.slice(0, 120)}…` : expression)}`)
    this.name = 'JqExpressionError'
  }
}

/**
 * Resolves a single jq expression wrapped in ${} against `values`, via snowplow's `/jq` endpoint.
 * Everything in `values` is sent to the server — the caller decides what that is (a form's secret
 * fields never are; see utils/secretJq.ts).
 * Example: '${"repo name: " + .json.spec.git.toRepo.name + ", event reason: " + .event.reason + ", response kind: " + .response.kind}'
 */
export const resolveJqExpression = async (url: string, expression: string, values: Record<string, unknown>): Promise<unknown> => {
  // TRIMMED, matching secretJq's `expressionBody`. The two checks disagreed, and this was the
  // untrimmed one: a chart writing `value: >` gets a folded block with a TRAILING NEWLINE, so a
  // perfectly good `${ … }` arrives as "${ … }\n", fails `endsWith('}')`, and used to be returned
  // verbatim with only a console.warn — poisoning the payload with jq source and failing at
  // admission with "expected map, got ${ .json as $f…" (portal#226). `>-` in the chart avoids it;
  // tolerating the whitespace here means a chart author cannot cause it at all.
  const trimmed = expression.trim()
  if (!trimmed.startsWith('${') || !trimmed.endsWith('}')) {
    throw new JqExpressionError(expression)
  }

  // Remove ${ and }
  const jqExpression = trimmed.slice(2, -1)

  try {
    const res = await fetch(url, {
      body: JSON.stringify({ data: values, query: jqExpression }),
      headers: {
        Authorization: `Bearer ${getAccessToken()}`,
        'Content-Type': 'application/json',
      },
      method: 'POST',
    })

    if (!res.ok) {
      throw new Error(`API request failed: ${res.status} ${res.statusText}`)
    }

    // `unknown`, not `string`: /jq returns whatever the expression evaluated to, and a whole-object
    // result is a FEATURE several charts depend on (a `payloadToOverride` with `name: spec` sets a
    // map). This used to be cast `as string` while returning objects at runtime — a type that lied
    // about a shipped behaviour.
    return await res.json()
  } catch (error) {
    console.error(`Failed to resolve jq expression: ${jqExpression}`, error)
    return ''
  }
}

/**
 * A DISPLAY template must yield text. `resolveJqExpression` returns whatever the expression
 * evaluated to, so the toast/notification/navigate paths narrow here rather than at eight call
 * sites — and a non-string is JSON-stringified rather than passed through `String()`, which would
 * render an object as "[object Object]" in front of a person.
 *
 * Payload overrides deliberately do NOT go through this: there a map is the point.
 */
export const jqText = (resolved: unknown): string => {
  if (typeof resolved === 'string') { return resolved }
  if (resolved === null || resolved === undefined) { return '' }
  if (typeof resolved === 'number' || typeof resolved === 'boolean' || typeof resolved === 'bigint') { return String(resolved) }
  return JSON.stringify(resolved) ?? ''
}

export function useResolveJqExpression() {
  const { config } = useConfigContext()
  const url = `${config!.api.SNOWPLOW_API_BASE_URL}/jq`

  return (expression: string, values: Record<string, unknown>) => resolveJqExpression(url, expression, values)
}
