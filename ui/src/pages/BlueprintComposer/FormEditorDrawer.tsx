/**
 * The form editor — mockup screen 10: values.schema.json on the left, the create form it generates
 * on the right. The inspector's form section, opened out.
 *
 * THE SCHEMA IS THE FORM, and the crdgen rule is refused WHILE AUTHORING, where it can be fixed,
 * rather than at Preview or — worse — at registration, where the CompositionDefinition wedges at
 * Ready=False (core-provider#46). Each problem's lines are marked in place, and under them is the
 * refusal in words, with "Fix it for me" where the fix is mechanical (schemaEdit.ts).
 *
 * TWO MODES, NOT A CODE EDITOR (decision D12): the schema is shown highlighted with its problem
 * lines marked; Edit swaps in a plain TextArea, and Apply writes it and lets the lint read it again.
 * A live-highlighting editor would be a non-antd dependency, which is a discussion of its own.
 * Long lines scroll sideways, as the mockup's `.code` does, rather than wrap: the highlighter's
 * wrapping lays each line out as a flex row, which splits its tokens into columns.
 *
 * AN EDIT OWNS THE SCHEMA until it is applied or cancelled. "Fix it for me" and "Add a field" write
 * the held text, not the TextArea — so while editing they are not offered, and Apply is pinned to
 * the bytes the edit started from: if the held schema changed underneath (the agent, Undo), Apply
 * writes nothing and says so, the same way the batch bus refuses a stale plan.
 *
 * EVERY WRITE RIDES THE FILE-EDIT BUS — a fix, a field added, a hand edit — as `values.schema.json`
 * of a blueprint. The provider writes it into the held draft and forgets the chart's arming, so
 * Publish is off until Preview renders the chart again; a refusal (the byte cap, the other kind's
 * draft) is shown where the edit was made, and nothing changes. Autopilot is never involved.
 *
 * A DRAWER OF ITS OWN, from the house parts: DrawerHeader for the title (C2), drawerCloseProps for
 * the close, and the page-content layer (C23) — nothing it holds is a gated action. Esc closes it,
 * and focus goes back to whatever opened it.
 */
// eslint-disable-next-line no-restricted-imports -- a DrawerHeader + drawerCloseProps + LAYER drawer, as #86 §0.10 asks
import { Alert, Button, Drawer, Input, Select, Space, type InputRef } from 'antd'
import { useEffect, useMemo, useRef, useState } from 'react'
import SyntaxHighlighter from 'react-syntax-highlighter'
import atomOneDark from 'react-syntax-highlighter/dist/esm/styles/hljs/atom-one-dark.js'
import lightfair from 'react-syntax-highlighter/dist/esm/styles/hljs/lightfair.js'

import { VALUES_SCHEMA_PATH } from '../../components/Autopilot/blueprintDraft'
import { emitFileEdit } from '../../components/Autopilot/previewFileEdit'
import { PreviewFormSection } from '../../components/Autopilot/previewFormSection'
import { DrawerHeader, drawerCloseProps } from '../../components/DrawerHeader/DrawerHeader'
import StatusPill from '../../components/StatusPill'
import { useThemeMode } from '../../context/ThemeModeContext'
import { LAYER } from '../../theme/layers'

import styles from './BlueprintComposer.module.css'
import { formPreviewGap } from './formPreview'
import { FORM_FIELD_TYPES, addFormField, fixPopulatedDefault, formSuppressions, schemaProblemsAt, type FormFieldType, type SchemaProblemAt } from './schemaEdit'

/** Write the schema through the provider. The answer, or null when it took (or nobody answered). */
const writeSchema = (content: string): string | null => {
  const outcome = emitFileEdit({ content, kind: 'blueprint', path: VALUES_SCHEMA_PATH })
  return outcome && !outcome.ok ? outcome.error : null
}

/**
 * The drawer's width: room for mockup 10's two panes — the schema, and a ~520px form beside it. antd
 * caps the drawer at 100vw, so on a narrower screen it is the screen. (antd's `large` is a fixed
 * 736px, which squeezed both panes until neither could be read.)
 */
const DRAWER_SIZE = 1180

const ProblemBox = ({ editing, onFix, problem }: { editing: boolean; onFix: (problem: SchemaProblemAt) => void; problem: SchemaProblemAt }) => (
  <div className={styles.schemaRefusal} data-problem-box={problem.path}>
    {problem.field ? <strong>{problem.field}</strong> : null}
    {problem.field ? problem.message.slice(problem.field.length) : problem.message}
    {problem.fixable && !editing ? (
      <>
        {' '}
        <Button className={styles.inlineAction} onClick={() => onFix(problem)} size='small' type='link'>Fix it for me</Button>
      </>
    ) : null}
  </div>
)

export interface FormEditorDrawerProps {
  open: boolean
  onClose: () => void
  /** The held values.schema.json, verbatim — undefined when the chart has none. */
  schemaText: string | undefined
  /** The field type "Add a field" starts on — set when a Form fields row opened the drawer. */
  addType: FormFieldType | null
  /** Bumped on every open from a Form fields row, so the same type asked for again still focuses. */
  addNonce: number
}

export const FormEditorDrawer = ({ addNonce, addType, onClose, open, schemaText }: FormEditorDrawerProps) => {
  const { mode } = useThemeMode()
  const text = schemaText ?? ''
  const problems = useMemo(() => (schemaText === undefined ? [] : schemaProblemsAt(schemaText)), [schemaText])
  const suppressed = useMemo(() => (schemaText === undefined ? [] : formSuppressions(schemaText)), [schemaText])
  const marked = useMemo(() => {
    const lines = new Set<number>()
    for (const problem of problems) {
      for (let line = problem.startLine; line <= problem.endLine; line += 1) { lines.add(line) }
    }
    return lines
  }, [problems])
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(text)
  // The held text the edit started from — what Apply is pinned to.
  const [base, setBase] = useState(text)
  const [refused, setRefused] = useState<string | null>(null)
  const [fieldName, setFieldName] = useState('')
  const [fieldType, setFieldType] = useState<FormFieldType>('string')
  const [fieldRefusal, setFieldRefusal] = useState<string | null>(null)
  const nameInput = useRef<InputRef | null>(null)
  const opener = useRef<HTMLElement | null>(null)

  // Who opened it — focus goes back there on close (antd's Drawer does not do it for us). Each
  // opening starts from the held schema, not from an edit or a refusal left over from the last one.
  useEffect(() => {
    if (open) {
      opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
      setRefused(null)
      setEditing(false)
      setFieldRefusal(null)
    }
  }, [open])

  // Opened from a Form fields row: that type, and the name input ready for typing.
  useEffect(() => {
    if (!open || !addType) { return undefined }
    setFieldType(addType)
    setFieldRefusal(null)
    const frame = requestAnimationFrame(() => nameInput.current?.focus())
    return () => cancelAnimationFrame(frame)
  }, [addNonce, addType, open])

  const fix = (problem: SchemaProblemAt) => {
    const result = fixPopulatedDefault(text, problem.path)
    setRefused(result.ok ? writeSchema(result.text) : result.reason)
  }

  const beginEdit = () => {
    setDraft(text)
    setBase(text)
    setRefused(null)
    setEditing(true)
  }

  const apply = () => {
    if (text !== base) {
      setRefused(`${VALUES_SCHEMA_PATH} changed while you were editing it — nothing was written. Cancel, then Edit again to start from the held text.`)
      return
    }
    try {
      JSON.parse(draft)
    } catch (error) {
      setRefused(`${VALUES_SCHEMA_PATH} is not valid JSON — ${error instanceof Error ? error.message : String(error)}`)
      return
    }
    const error = writeSchema(draft)
    setRefused(error)
    if (!error) { setEditing(false) }
  }

  const addField = () => {
    const result = addFormField(text, { name: fieldName, type: fieldType })
    if (!result.ok) {
      setFieldRefusal(result.reason)
      return
    }
    setFieldRefusal(null)
    const error = writeSchema(result.text)
    setRefused(error)
    if (!error) { setFieldName('') }
  }

  const count = problems.length
  const gap = formPreviewGap(schemaText)
  return (
    <Drawer
      afterOpenChange={(visible) => { if (!visible) { opener.current?.focus() } }}
      closable={drawerCloseProps.closable}
      destroyOnHidden
      extra={count ? <StatusPill color='error' label={`${count} problem${count === 1 ? '' : 's'} · publish blocked`} /> : null}
      onClose={onClose}
      open={open}
      size={DRAWER_SIZE}
      title={<DrawerHeader title='The create form' />}
      zIndex={LAYER.DRAWER}
    >
      <div className={styles.formEditor}>
        <section aria-label={VALUES_SCHEMA_PATH} className={styles.pane}>
          <div className={styles.paneHead}>
            <span className={styles.schemaPath}>{VALUES_SCHEMA_PATH}</span>
            <span className={styles.countPill}>the create-form contract</span>
            <span className={styles.spacer} />
            {editing ? <span className={styles.eyebrow}>editing</span> : (
              <Button onClick={beginEdit} size='small' type='link'>Edit</Button>
            )}
          </div>
          <div className={styles.section}>
            {refused ? <Alert description={refused} showIcon title='This edit was not applied' type='error' /> : null}
            {editing ? (
              <>
                <Input.TextArea
                  aria-label={`Edit ${VALUES_SCHEMA_PATH}`}
                  autoSize={{ maxRows: 28, minRows: 8 }}
                  className={styles.schemaText}
                  onChange={(event) => setDraft(event.target.value)}
                  spellCheck={false}
                  value={draft}
                />
                <Space>
                  <Button disabled={draft === base} onClick={apply} type='primary'>Apply</Button>
                  <Button onClick={() => { setEditing(false); setRefused(null) }}>Cancel</Button>
                </Space>
              </>
            ) : (
              <div className={styles.schemaCode}>
                <SyntaxHighlighter
                  language='json'
                  lineProps={(line: number) => (marked.has(line)
                    ? { className: styles.problemLine, 'data-problem': 'true' } as React.HTMLProps<HTMLElement>
                    : {})}
                  showLineNumbers
                  style={(mode === 'dark' ? atomOneDark : lightfair) as { [key: string]: React.CSSProperties }}
                  wrapLines
                >
                  {text}
                </SyntaxHighlighter>
              </div>
            )}
            {problems.map((problem) => <ProblemBox editing={editing} key={`${problem.code}:${problem.path}`} onFix={fix} problem={problem} />)}
            {editing ? (
              <p className={styles.fieldText}>Add a field, and any fix, come back once this edit is applied or cancelled — they write the held schema, not this text.</p>
            ) : (
              <div aria-label='Add a field' className={styles.addField} role='group'>
                <span className={styles.eyebrow}>Add a field</span>
                <div className={styles.addFieldRow}>
                  <Input
                    aria-label='Field name'
                    onChange={(event) => { setFieldName(event.target.value); setFieldRefusal(null) }}
                    onPressEnter={addField}
                    placeholder='e.g. region'
                    ref={nameInput}
                    size='small'
                    value={fieldName}
                  />
                  <Select
                    aria-label='Field type'
                    onChange={setFieldType}
                    options={FORM_FIELD_TYPES.map((field) => ({ label: field.label, value: field.type }))}
                    size='small'
                    value={fieldType}
                  />
                  <Button disabled={!fieldName.trim()} onClick={addField} size='small'>Add field</Button>
                </div>
                {fieldRefusal ? <p className={styles.refusalText} role='alert'>{fieldRefusal}</p> : null}
              </div>
            )}
          </div>
        </section>
        <section aria-label='Create form preview' className={styles.pane}>
          <div className={styles.section}>
            {gap ? <p className={styles.dashedNote}>{gap}</p> : <PreviewFormSection formSchema={text} suppressed={suppressed} />}
          </div>
        </section>
      </div>
    </Drawer>
  )
}

export default FormEditorDrawer
