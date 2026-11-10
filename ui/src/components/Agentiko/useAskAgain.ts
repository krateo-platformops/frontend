/**
 * "Stop and ask again" for a stalled turn, from the provider's own `stop` and `send`.
 *
 * The two cannot be called back to back: `send` refuses while a turn is streaming, and the `send` a
 * click handler holds still sees the turn that `stop` just ended as streaming — `stop` only
 * schedules `streaming: false`. So the question is held until the provider has actually committed
 * the stop (`streaming` false), and the CURRENT `send` sends it then. No timer, no second transport
 * path: the re-ask is an ordinary user turn.
 */
import { useCallback, useEffect, useState } from 'react'

export const useAskAgain = ({ send, stop, streaming }: {
  send: (text: string) => void
  stop: () => void
  streaming: boolean
}): ((question: string) => void) => {
  const [queued, setQueued] = useState<string>()
  useEffect(() => {
    if (queued === undefined || streaming) {
      return
    }
    setQueued(undefined)
    send(queued)
  }, [queued, send, streaming])
  return useCallback((question: string) => {
    stop()
    setQueued(question)
  }, [stop])
}

/** The question a turn answers: the nearest user message before it. */
export const questionBefore = (messages: { role: string; text: string }[], index: number): string | undefined => {
  for (let at = index - 1; at >= 0; at -= 1) {
    if (messages[at].role === 'user') {
      return messages[at].text
    }
  }
  return undefined
}
