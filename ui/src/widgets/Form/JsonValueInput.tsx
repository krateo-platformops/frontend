import { Input } from 'antd'
import { useState } from 'react'

/**
 * Editor for a free-form object/array node (a `type: object` map without `properties`,
 * e.g. `x-kubernetes-preserve-unknown-fields` like a `tags`/`labels` map, or a non-string
 * array). antd injects `value`/`onChange`: the value stays a real object/array — edited as
 * JSON — so it is submitted correctly and never rendered as the string "[object Object]".
 */
export const JsonValueInput = ({ id, onChange, value }: { id?: string; onChange?: (next: unknown) => void; value?: unknown }): React.ReactNode => {
  const [text, setText] = useState<string>(() => (value === undefined || value === null ? '' : JSON.stringify(value, null, 2)))
  const [invalid, setInvalid] = useState(false)

  const handleChange = (event: React.ChangeEvent<HTMLTextAreaElement>) => {
    const next = event.target.value
    setText(next)
    if (next.trim() === '') {
      setInvalid(false)
      onChange?.(undefined)
      return
    }
    try {
      const parsed: unknown = JSON.parse(next)
      setInvalid(false)
      onChange?.(parsed)
    } catch {
      setInvalid(true)
    }
  }

  return (
    <Input.TextArea
      autoSize={{ maxRows: 12, minRows: 2 }}
      id={id}
      onChange={handleChange}
      placeholder='{ } — JSON (key/value map)'
      status={invalid ? 'error' : undefined}
      style={{ fontFamily: 'var(--font-mono, monospace)' }}
      value={text}
    />
  )
}
