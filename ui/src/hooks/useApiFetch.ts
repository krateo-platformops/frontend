import type { AxiosRequestConfig, Method, AxiosError } from 'axios'
import axios from 'axios'
import { useState, useEffect, useCallback } from 'react'

type FetchState<T> = {
  data: T | null
  isLoading: boolean
  isSuccess: boolean
  isError: boolean
  error: string | null
  execute: (overrideData?: T) => unknown
}

type UseApiFetchParams = {
  method?: Method
  endpoint: string
  config?: AxiosRequestConfig
  autoFetch?: boolean
}

function useApiFetch<T>({
  autoFetch = true,
  config,
  endpoint,
  method = 'GET',
}: UseApiFetchParams): FetchState<T> {
  const [data, setData] = useState<T | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [isSuccess, setIsSuccess] = useState(false)
  const [isError, setIsError] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const execute = useCallback(
    async (overrideData?: T) => {
      setIsLoading(true)
      setIsSuccess(false)
      setIsError(false)
      setError(null)

      try {
        const payload: unknown = overrideData || (config && config.data) || undefined
        const response = await axios<T>({
          method,
          url: endpoint,
          ...(config || {}),
          data: payload,
        })

        setData(response.data)
        setIsSuccess(true)
      } catch (err) {
        const axiosError = err as AxiosError
        setIsError(true)
        setError(axiosError.message || 'Unknown error occurred')
      } finally {
        setIsLoading(false)
      }
    },
    [endpoint, method, config]
  )

  useEffect(() => {
    if (autoFetch) {
      void execute()
    }
  }, [execute, autoFetch])

  return { data, error, execute, isError, isLoading, isSuccess }
}

export default useApiFetch
