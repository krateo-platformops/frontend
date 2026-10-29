import { CloseOutlined, MinusCircleOutlined, PlusOutlined } from '@ant-design/icons'
import { Button, Card, Input, Space } from 'antd'
import { useEffect, useState } from 'react'

import styles from './Form.module.css'
import { JsonValueInput } from './JsonValueInput'

type Entry = { key: string; value: string }
type Scalar = string | number | boolean

const isScalar = (value: unknown): value is Scalar =>
  typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'

/** A list every row of which is a flat object of scalars — what rows can edit without losing anything. */
export const isFlatObjectList = (value: unknown): value is Array<Record<string, Scalar>> =>
  Array.isArray(value) && value.every((row) =>
    !!row && typeof row === 'object' && !Array.isArray(row) && Object.values(row as object).every(isScalar))

const toEntries = (row: Record<string, Scalar>): Entry[] =>
  Object.entries(row).map(([key, value]) => ({ key, value: String(value) }))

/**
 * A typed value back from its text. The item declares no types, so `true`/`false` and a number
 * written in its canonical form (`300`, not `0300`) are sent as such — a toleration's
 * `tolerationSeconds` is a number — and everything else as the string typed. "Edit as JSON"
 * gives exact control when that guess is wrong.
 */
export const fromText = (text: string): Scalar => {
  if (text === 'true') { return true }
  if (text === 'false') { return false }
  const number = Number(text)
  return text.trim() !== '' && String(number) === text ? number : text
}

const toValue = (rows: Entry[][]): Array<Record<string, Scalar>> | undefined => {
  const objects = rows
    .map((entries) => entries.filter((entry) => entry.key.trim()))
    .filter((entries) => entries.length)
    .map((entries) => Object.fromEntries(entries.map((entry) => [entry.key.trim(), fromText(entry.value)])))
  return objects.length ? objects : undefined
}

/**
 * Editor for a list of objects whose items declare NO fields — `imagePullSecrets: [{ name }]`,
 * `tolerations` — that used to be a JSON textarea. Each item is a card of key/value rows, so
 * `[{"name": "regcred"}]` is written as one row instead of typed as JSON from memory. A list that
 * rows cannot hold (a nested object or list inside an item) opens as JSON, and "Edit as JSON" is
 * always one click away. The submitted value is the plain list either way.
 */
export const FreeObjectListInput = ({ id, label = 'Item', onChange, value }: {
  id?: string
  label?: string
  onChange?: (next: unknown) => void
  value?: unknown
}): React.ReactNode => {
  const [asJson, setAsJson] = useState(() => value !== undefined && value !== null && !isFlatObjectList(value))
  const [rows, setRows] = useState<Entry[][]>(() => (isFlatObjectList(value) ? value.map(toEntries) : []))

  // A form reset (a fresh create) clears the value from outside; the rows follow it.
  useEffect(() => {
    if (value === undefined && rows.some((entries) => entries.some((entry) => entry.key.trim()))) {
      setRows([])
    }
  }, [rows, value])

  const commit = (next: Entry[][]) => {
    setRows(next)
    onChange?.(toValue(next))
  }
  const editRow = (index: number, entries: Entry[]) => { commit(rows.map((each, at) => (at === index ? entries : each))) }

  const toggle = asJson
    ? (
      <Button disabled={value !== undefined && !isFlatObjectList(value)} onClick={() => { setRows(isFlatObjectList(value) ? value.map(toEntries) : []); setAsJson(false) }} size='small' type='link'>
        Edit as rows
      </Button>
    )
    : <Button onClick={() => { setAsJson(true) }} size='small' type='link'>Edit as JSON</Button>

  if (asJson) {
    return (
      <div className={styles.listRows}>
        <JsonValueInput id={id} onChange={onChange} value={value} />
        <div>{toggle}</div>
      </div>
    )
  }

  return (
    <div className={styles.listRows} id={id}>
      {rows.map((entries, index) => (
        <Card
          extra={<Button aria-label={`Remove ${label} ${index + 1}`} icon={<CloseOutlined />} onClick={() => { commit(rows.filter((_, at) => at !== index)) }} size='small' type='text' />}
          key={index}
          size='small'
          title={`${label} ${index + 1}`}
        >
          {entries.map((entry, at) => (
            <Space align='baseline' className={styles.mapRow} key={at}>
              <Space.Compact className={styles.mapRowFields}>
                <Input
                  aria-label={`${label} ${index + 1} key ${at + 1}`}
                  onChange={(event) => { editRow(index, entries.map((each, i) => (i === at ? { ...each, key: event.target.value } : each))) }}
                  placeholder='key'
                  value={entry.key}
                />
                <Input
                  aria-label={`${label} ${index + 1} value ${at + 1}`}
                  onChange={(event) => { editRow(index, entries.map((each, i) => (i === at ? { ...each, value: event.target.value } : each))) }}
                  placeholder='value'
                  value={entry.value}
                />
              </Space.Compact>
              <MinusCircleOutlined aria-label={`Remove ${label} ${index + 1} key ${at + 1}`} onClick={() => { editRow(index, entries.filter((_, i) => i !== at)) }} />
            </Space>
          ))}
          <Button icon={<PlusOutlined />} onClick={() => { setRows(rows.map((each, at) => (at === index ? [...each, { key: '', value: '' }] : each))) }} size='small' type='dashed'>
            Add key
          </Button>
        </Card>
      ))}
      <Button block icon={<PlusOutlined />} onClick={() => { setRows([...rows, [{ key: '', value: '' }]]) }} type='dashed'>
        Add {label}
      </Button>
      <div>{toggle}</div>
    </div>
  )
}
