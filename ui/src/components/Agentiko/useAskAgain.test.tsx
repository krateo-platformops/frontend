// @vitest-environment jsdom
/**
 * "Stop and ask again": the re-ask goes out only once the provider has committed the stop, through
 * the `send` of THAT render — the one that no longer sees the old turn as streaming.
 */
import { act, cleanup, renderHook } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, describe, expect, it } from 'vitest'

import { questionBefore, useAskAgain } from './useAskAgain'

afterEach(cleanup)

/** A stand-in provider with the real constraint: `send` refuses while streaming. */
const useFakeProvider = (sent: string[]) => {
  const [streaming, setStreaming] = useState(true)
  const send = (text: string) => {
    if (streaming) {
      throw new Error('send while streaming')
    }
    sent.push(text)
  }
  const stop = () => setStreaming(false)
  return { askAgain: useAskAgain({ send, stop, streaming }), streaming }
}

describe('useAskAgain', () => {
  it('stops, then sends the same question once the stop has landed', () => {
    const sent: string[] = []
    const { result } = renderHook(() => useFakeProvider(sent))
    act(() => { result.current.askAgain('is it healthy?') })
    expect(result.current.streaming).toBe(false)
    expect(sent).toEqual(['is it healthy?'])
  })

  it('sends once, not on every later render', () => {
    const sent: string[] = []
    const { rerender, result } = renderHook(() => useFakeProvider(sent))
    act(() => { result.current.askAgain('q') })
    rerender()
    rerender()
    expect(sent).toEqual(['q'])
  })

  it('finds the question a turn answers', () => {
    const messages = [{ role: 'user', text: 'first' }, { role: 'assistant', text: '' }, { role: 'user', text: 'second' }, { role: 'assistant', text: '' }]
    expect(questionBefore(messages, 3)).toBe('second')
    expect(questionBefore(messages, 1)).toBe('first')
    expect(questionBefore(messages, 0)).toBeUndefined()
  })
})
