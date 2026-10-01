/**
 * Credentials in a URL (frontend#429 review) — the base URL a controller calls and the URL its
 * OpenAPI document is read from. Pure.
 */
/** Query parameter names that carry a credential: an API key, a token, a secret, a password, a signature. */
const CREDENTIAL_PARAM = /key|token|secret|passw(?:or)?d|signature/i

/**
 * Why a URL may not be used because it CARRIES A CREDENTIAL, or null. A base URL is written into
 * Chart.yaml and every `servers` entry of a chart that is committed to a repository and shown to
 * Autopilot; a spec URL is fetched and named in a chip. A credential in either — `user:pass@` or a
 * key/token/secret/password/signature query parameter — would be published with it. The sentence
 * names the parameter, never its value. Credentials belong in the Kind's Configuration Secret.
 */
export const urlCredentialProblem = (raw: string): string | null => {
  let url: URL
  try {
    url = new URL(raw.trim())
  } catch {
    return null
  }
  if (url.username || url.password) {
    return 'The URL carries a user name or password (user:pass@) — it would be written into the chart and published with it. Remove it; the controller authenticates through its Configuration\'s Secret.'
  }
  const names = [...new Set([...url.searchParams.keys()].filter((name) => CREDENTIAL_PARAM.test(name)))]
  return names.length
    ? `The URL's query carries a credential-like parameter (${names.join(', ')}) — it would be written into the chart and published with it. Remove it; the controller authenticates through its Configuration's Secret.`
    : null
}

/** A URL as a sentence may show it: itself, or a stand-in when it carries a credential. */
export const shownUrl = (raw: unknown): string => {
  const text = String(raw)
  return urlCredentialProblem(text) ? '(a URL carrying a credential, not shown)' : text
}
