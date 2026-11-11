export type LoginFormType = {
  username: string
  password: string
}

export type FormType = 'basic' | 'ldap'

export type AuthResponseType = {
  accessToken: string
  user: {
    displayName: string
    username: string
    avatarURL: string
  } | null
  groups: string[]
  data: {
    apiVersion: string
    clusters: {
      cluster: {
        'certificate-authority-data': string
        server: string
      }
      name: string
    }[]
    contexts: {
      context: {
        cluster: string
        user: string
      }
      name: string
    }[]
    'current-context': string
    kind: string
    users: {
      user: {
        'client-certificate-data': string
        'client-key-data': string
      }
      name: string
    }[]
  } | null
}

export type AuthModeType = {
  extensions?: {
    authCodeURL: string
    redirectURL: string
  }
  name: string
  kind: string
  path: string
  graphics?: {
    icon: string
    displayName: string
    textColor: string
    backgroundColor: string
  }
}

export type AuthRequestType = {
  name: string
  code: string
  url: string
  /**
   * The PKCE verifier for this flow, when the authorization request carried a challenge. Absent for
   * a flow that sent none — it must then NOT be sent, because a verifier without a challenge is
   * itself refused (RFC 7636 §4.6).
   */
  codeVerifier?: string
}

/**
 * A failed credential sign-in, shown inline in the form that was submitted: an antd error Alert
 * above its button. It replaces the toast the page used to raise, which sat in a corner away from
 * the fields it was about and was gone before a screen reader user had found it.
 */
export type LoginFormAlert = {
  /** The /strategies entry whose form was submitted. Only that form shows the alert. */
  method: AuthModeType
  /** Bumped on every failure, so a second identical failure still clears and refocuses. */
  attempt: number
  title: string
  text: string
  /** authn's cause, shown small for support. Null when there is none. */
  reason: string | null
  /** authn refused the credentials: clear the password and put the cursor back in it. */
  retype: boolean
}
