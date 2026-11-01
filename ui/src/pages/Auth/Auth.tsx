import type { IconProp } from '@fortawesome/fontawesome-svg-core'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { useMutation, useQuery } from '@tanstack/react-query'
import { Result, Space, Spin, Typography } from 'antd'
import { useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'

import { useConfigContext } from '../../context/ConfigContext'
import useCatchError from '../../hooks/useCatchError'
import { invalidateAccessTokenCache } from '../../utils/getAccessToken'
import { resolveNextPath, SESSION_RESUME_NEXT_KEY } from '../../utils/nextPath'
import type { AuthModeType, AuthRequestType, AuthResponseType } from '../Login/Login.types'
import { takeSocialLoginState } from '../Login/SocialLogin/SocialLogin'

const Auth = () => {
  const navigate = useNavigate()
  const { catchError } = useCatchError()

  const [searchParams] = useSearchParams()
  const [showError, setShowError] = useState<boolean>(false)

  const code = searchParams.get('code')
  const state = searchParams.get('state')
  const kind = searchParams.get('kind')

  const { config } = useConfigContext()

  const authUrl = `${config!.api.AUTHN_API_BASE_URL}/strategies`

  const {
    data: methods,
    error: isMethodsError,
    isSuccess: isMethodSuccess,
  } = useQuery({
    queryFn: async () => {
      const res = await fetch(authUrl)
      return await res.json() as AuthModeType[]
    },
    queryKey: ['methods', authUrl],
  })

  const {
    isError: isSocialAuthError,
    mutateAsync: socialsAuthentication,
  } = useMutation({
    mutationFn: async (body: {
      name: string
      code: string
      url: string
    }) => {
      const response = await fetch(`${config!.api.AUTHN_API_BASE_URL}${body.url}?name=${body.name}`, {
        headers: {
          'X-Auth-Code': body.code,
        },
        method: 'GET',
      })

      const parsedResponse = await response.json() as AuthResponseType

      if (response.ok) {
        return parsedResponse
      }
      catchError({
        message: `Login error (${response.status}: ${response.statusText})`,
        status: response.status,
      }, 'notification')
    },
  })

  useEffect(() => {
    const socialAuth = async (code: string, methodData: AuthModeType) => {
      const request: AuthRequestType = {
        code,
        name: methodData.name,
        url: methodData.path,
      }
      const userData = await socialsAuthentication(request)

      if (userData) {
        localStorage.setItem('K_user', JSON.stringify(userData))
        // Uphold the invariant that a K_user write drops the module-level token cache so the next
        // fetch reads the fresh token (mirrors SessionResumeModal / getAccessToken's contract).
        invalidateAccessTokenCache()
        // If this OIDC round-trip was a mid-session re-auth (the SessionResume modal stashed the
        // pre-expiry route), land the user back where they were; otherwise home. Consume-once +
        // open-redirect-sanitized.
        const stashedNext = localStorage.getItem(SESSION_RESUME_NEXT_KEY)
        localStorage.removeItem(SESSION_RESUME_NEXT_KEY)
        void navigate(resolveNextPath(stashedNext))
      }
    }

    if (!isSocialAuthError && isMethodSuccess) {
      const methodData = methods
        ?.find((el) => (el.kind === kind) && el.extensions?.redirectURL && (el.extensions.redirectURL.indexOf(window.location.protocol) > -1))

      // Validate the returned state iff WE SENT ONE, which is exactly when SocialLogin recorded it.
      // This used to key off `authCodeURL.indexOf('&state=')` — a substring search of authn's URL —
      // which answers a different question: whether authn's URL mentioned state, not whether the
      // portal issued one. Those came apart in both directions. authn now always sends a state, so
      // the search always matched and the unvalidated branch was dead; and had authn stopped sending
      // one, the search would have stopped matching even though SocialLogin still sent its own,
      // skipping the check on a flow that had one to check.
      // Takes the state AND consumes it (#583) — see takeSocialLoginState. One login, one state.
      const sentState = takeSocialLoginState()
      if (sentState !== null) {
        if (state === sentState && code && methodData) {
          void socialAuth(code, methodData)
        }
      } else if (code && methodData) {
        void socialAuth(code, methodData)
      }
    }

    if (isMethodsError || isSocialAuthError) {
      setShowError(true)
    }
  }, [code, methods, isSocialAuthError, isMethodsError, isMethodSuccess, navigate, socialsAuthentication, state, kind])

  return (
    showError
      ? (
        <Result
          extra={<Link to='/login'>Return to the Login page</Link>}
          status='warning'
          subTitle='There seems to be an authentication problem using this method'
          title='Authentication error'
        />
      )
      : (
        <Space
          direction='vertical'
          size='large'
          style={{ alignItems: 'center', height: '100vh', justifyContent: 'center', width: '100%' }}
        >
          <Spin indicator={<FontAwesomeIcon icon={['fas', 'spinner'] as IconProp} spin />} size='large' />
          <Typography.Text>Authentication in progress...</Typography.Text>
        </Space>
      )
  )
}

export default Auth
