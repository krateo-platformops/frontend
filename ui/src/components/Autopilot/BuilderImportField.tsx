/**
 * UI-NATIVE BUILDER IMPORT (item C) — the shared file-import control for the blueprint + page
 * import/publish forms. antd `Upload` (multi-file, `beforeUpload` returns false → the files are read
 * ENTIRELY client-side, NEVER POSTed) reads each file into the `{path: content}` held-draft map;
 * a paste fallback adds a single file by explicit path. The held tree is surfaced as a removable
 * list. The parent form owns the map (lifted state) — this control only mutates it.
 *
 * The "files held client-side, published verbatim" guarantee lives here: nothing this control does
 * touches the network; the map it produces is handed straight to the publish machinery.
 */

import type { IconProp } from '@fortawesome/fontawesome-svg-core'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { Button, Input, List, Space, Typography, Upload } from 'antd'
import type { UploadFile } from 'antd'
import { useState } from 'react'

import { importFileKey, readFileText } from './builderImport'

const { Dragger } = Upload
const { Text } = Typography

export interface BuilderImportFieldProps {
  /** The current held tree (path → verbatim content). Owned by the parent form. */
  files: Record<string, string>
  /** Replace the held tree (add/remove a file). */
  onChange: (files: Record<string, string>) => void
  /** Placeholder guidance for the paste path input (e.g. `templates/deployment.yaml`). */
  pastePathPlaceholder?: string
}

/**
 * The import control. Two ingestion paths, both writing the SAME `{path: content}` map:
 *   - Upload/drag — multi-file (or a whole folder); each file is read client-side (readFileText) and
 *     keyed by its chart/page-relative path (importFileKey). `beforeUpload` returns false so antd
 *     never uploads — the read is the only side effect.
 *   - Paste — a path + a body, for the single-file or copy-paste case.
 * The held files render as a removable list so the user sees EXACTLY what will be published.
 */
export const BuilderImportField = ({ files, onChange, pastePathPlaceholder }: BuilderImportFieldProps) => {
  const [pastePath, setPastePath] = useState('')
  const [pasteBody, setPasteBody] = useState('')

  const setFile = (path: string, content: string) => onChange({ ...files, [path]: content })

  const removeFile = (path: string) => {
    const next = Object.fromEntries(Object.entries(files).filter(([key]) => key !== path))
    onChange(next)
  }

  // beforeUpload returns false → antd holds the File but never uploads it; we read it client-side.
  const beforeUpload = (file: UploadFile) => {
    const raw = (file as unknown as { originFileObj?: File }).originFileObj ?? (file as unknown as File)
    void readFileText(raw).then((content) => setFile(importFileKey(raw), content)).catch(() => undefined)
    return false
  }

  const addPaste = () => {
    const path = pastePath.trim()
    if (!path) {
      return
    }
    setFile(path, pasteBody)
    setPastePath('')
    setPasteBody('')
  }

  const paths = Object.keys(files)

  return (
    <Space orientation='vertical' style={{ width: '100%' }}>
      <Dragger beforeUpload={beforeUpload} directory={false} multiple showUploadList={false}>
        <p className='ant-upload-drag-icon'><FontAwesomeIcon icon={['fas', 'file-arrow-up'] as IconProp} /></p>
        <p className='ant-upload-text'>Click or drag the artifact&apos;s files here</p>
        <p className='ant-upload-hint'>Read in your browser and published verbatim — never uploaded to a server. Pick multiple files at once.</p>
      </Dragger>

      <Space.Compact block>
        <Input onChange={(event) => setPastePath(event.target.value)} placeholder={pastePathPlaceholder ?? 'path/to/file.yaml'} style={{ width: '40%' }} value={pastePath} />
        <Input.TextArea autoSize={{ maxRows: 8, minRows: 1 }} onChange={(event) => setPasteBody(event.target.value)} placeholder='…or paste a file body here' value={pasteBody} />
        <Button disabled={!pastePath.trim()} onClick={addPaste}>Add file</Button>
      </Space.Compact>

      {paths.length > 0
        ? (
          <List
            bordered
            data-testid='builder-import-files'
            dataSource={paths}
            renderItem={(path) => (
              <List.Item
                actions={[<Button aria-label={`remove ${path}`} danger icon={<FontAwesomeIcon icon={['fas', 'trash'] as IconProp} />} key='rm' onClick={() => removeFile(path)} size='small' type='text' />]}
              >
                <Text code>{path}</Text>
                <Text type='secondary'> · {new Blob([files[path]]).size} B</Text>
              </List.Item>
            )}
            size='small'
          />
        )
        : <Text type='secondary'>No files imported yet.</Text>}
    </Space>
  )
}

export default BuilderImportField
