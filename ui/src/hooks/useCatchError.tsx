import { App, Result } from 'antd'
import { useCallback } from 'react'

import { isSessionResumePending, raiseSessionExpired } from '../utils/sessionResume'

export interface CatchError {
  name?: string
  data?: {
    message?: string
  }
  message?: string
  status?: number
  code?: number
}

const useCatchError = () => {
  const { notification } = App.useApp()

  const catchError = useCallback((error?: CatchError, type: 'result' | 'notification' = 'notification') => {
    // P16: this pair is the app-wide default for any unrecognised error — every data-fetching
    // widget, Auth and Login reach it — so it is the string users hit most. It used to apologise
    // ("Ops! Something didn't work" / "please try later"), which names nothing and asks the reader
    // to wait for a condition nobody described. Say what failed and what they can do instead.
    let message: string = error?.message || 'The request did not complete'
    let description: React.ReactNode = 'Try again. If it keeps happening, check your connection and permissions for this resource.'

    if ((error?.status === 401 || error?.code === 401)) {
      // Session honesty: a 401 no longer hard-redirects to /login (which wiped all page/rail
      // state). Raise the single in-place session-resume modal instead; suppress the toast —
      // the modal IS the messaging, and a burst of concurrent 401s must not toast-storm.
      description = error?.data?.message || 'Your session has expired.'
      void raiseSessionExpired()
      if (type === 'notification') {
        return
      }
    } else if (error?.status === 500 || error?.code === 500) {
      message = 'The server hit an unexpected error'
      description = error?.data?.message || 'The server encountered an unexpected condition.'
    } else if ((/^4\d{2}$/).test(String(error?.status)) || (/^4\d{2}$/).test(String(error?.code))) {
      if (error?.data?.message) {
        message = 'There was an error processing your request'
      }
      description = error?.data?.message || 'Please check your input or permissions.'
    }

    switch (type) {
      case 'result':
        return <Result status='error' subTitle={description} title={message} />
      case 'notification':
      default:
        // While a session-resume is pending, in-flight refetches keep failing against the
        // stale token — suppress the secondary error toasts so the resume modal isn't
        // buried under a storm; inline 'result' renders stay (they don't stack).
        if (isSessionResumePending()) {
          return
        }
        notification.error({
          description,
          duration: 4,
          key: 'unique',
          message,
        })
    }
  }, [notification])

  return { catchError }
}

export default useCatchError
