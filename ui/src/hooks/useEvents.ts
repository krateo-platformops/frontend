import { useEffect, useRef } from 'react'

type Callback<T> = (payload: T) => void

type EventMap = {
  [eventName: string]: unknown
}

export function useEvents<Events extends EventMap>() {
  const listeners = useRef<{
    [K in keyof Events]?: Callback<Events[K]>[];
  }>({})

  const on = <K extends keyof Events>(event: K, callback: Callback<Events[K]>) => {
    if (!listeners.current[event]) {
      listeners.current[event] = []
    }
    listeners.current[event]!.push(callback)
  }

  const off = <K extends keyof Events>(event: K, callback: Callback<Events[K]>) => {
    listeners.current[event] = listeners.current[event]?.filter(_cb => _cb !== callback)
  }

  const emit = <K extends keyof Events>(event: K, payload: Events[K]) => {
    listeners.current[event]?.forEach(callback => callback(payload))
  }

  const clear = () => {
    listeners.current = {}
  }

  useEffect(() => clear, [])

  return { clear, emit, off, on }
}
