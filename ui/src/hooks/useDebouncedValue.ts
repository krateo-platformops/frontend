import { useEffect, useState } from 'react'

/** Debounced mirror of `value` (trailing edge; an EMPTY value propagates immediately
 * so clearing the input clears the results without waiting out the delay). */
export const useDebouncedValue = (value: string, delayMs: number): string => {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    if (!value) {
      setDebounced(value)
      return undefined
    }
    const timer = setTimeout(() => setDebounced(value), delayMs)
    return () => clearTimeout(timer)
  }, [value, delayMs])
  return debounced
}
