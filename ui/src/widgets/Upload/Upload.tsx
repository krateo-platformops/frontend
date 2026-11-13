import type { IconProp } from '@fortawesome/fontawesome-svg-core'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { useQueryClient } from '@tanstack/react-query'
import { Button, Upload as AntdUpload, type UploadProps } from 'antd'
import useApp from 'antd/es/app/useApp'

import { useConfigContext } from '../../context/ConfigContext'
import { SIGN_IN_TO_ACT, useWidgetTransport } from '../../transport/widgetTransport'
import type { WidgetProps } from '../../types/Widget'
import { getResourceRef } from '../../utils/utils'

import type { Upload as WidgetType } from './Upload.type'

export type UploadWidgetData = WidgetType['spec']['widgetData']

const Upload = ({ resourcesRefs, uid, widgetData }: WidgetProps<UploadWidgetData>) => {
  const { accept, directory, errorMessage, label, listType, maxCount, multiple, resourceRefId, successMessage } = widgetData
  // antd Upload `name`, with back-compat for the legacy `fieldName`.
  const name = widgetData.name ?? (widgetData as { fieldName?: string }).fieldName

  const { config } = useConfigContext()
  const { notification } = useApp()
  const queryClient = useQueryClient()
  // An upload is a write, so it needs the signed-in session; a public page has none (the anonymous
  // transport), and the upload is refused before any request is opened.
  const { session, writes } = useWidgetTransport()

  const resourceRef = getResourceRef(resourceRefId, resourcesRefs)

  const customRequest: UploadProps['customRequest'] = ({ file, onError, onProgress, onSuccess }) => {
    if (!writes || !session) {
      const error = new Error(SIGN_IN_TO_ACT)
      notification.info({ description: SIGN_IN_TO_ACT, message: 'Sign in to do this', placement: 'bottomLeft' })
      onError?.(error)
      return
    }

    if (!resourceRef?.path) {
      const error = new Error(`Upload target not found (resourceRefId: ${resourceRefId})`)
      notification.error({ description: error.message, message: 'Upload failed', placement: 'bottomLeft' })
      onError?.(error)
      return
    }

    const url = `${config!.api.SNOWPLOW_API_BASE_URL}${resourceRef.path}`
    const formData = new FormData()
    formData.append(name || 'file', file as Blob)

    const xhr = new XMLHttpRequest()
    xhr.open(resourceRef.verb || 'POST', url)
    xhr.setRequestHeader('Authorization', `Bearer ${session.getAccessToken()}`)

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) {
        onProgress?.({ percent: (event.loaded / event.total) * 100 })
      }
    }

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        onSuccess?.(xhr.response)
        notification.success({ message: successMessage || 'Upload complete', placement: 'bottomLeft' })
        // Refresh widget data only (key ['widgets', ...]); don't blow away the SSE events cache.
        void queryClient.invalidateQueries({ queryKey: ['widgets'] })
      } else {
        const error = new Error(`Upload failed: ${xhr.status} ${xhr.statusText}`)
        onError?.(error)
        notification.error({ description: error.message, message: errorMessage || 'Upload failed', placement: 'bottomLeft' })
      }
    }

    xhr.onerror = () => {
      const error = new Error('Upload failed: network error')
      onError?.(error)
      notification.error({ description: error.message, message: errorMessage || 'Upload failed', placement: 'bottomLeft' })
    }

    xhr.send(formData)
  }

  const isCard = listType === 'picture-card' || listType === 'picture-circle'

  return (
    <AntdUpload
      accept={accept}
      customRequest={customRequest}
      directory={directory}
      key={uid}
      listType={listType}
      maxCount={maxCount}
      multiple={multiple}
    >
      {isCard ? (label || 'Upload') : <Button icon={<FontAwesomeIcon icon={['fas', 'upload'] as IconProp} />}>{label || 'Upload'}</Button>}
    </AntdUpload>
  )
}

export default Upload
