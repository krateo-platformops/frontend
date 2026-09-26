import type { IconProp } from '@fortawesome/fontawesome-svg-core'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { Button, Empty, Result } from 'antd'
import { dump } from 'js-yaml'
import { useMemo, useState } from 'react'
import { CopyToClipboard } from 'react-copy-to-clipboard-ts'
import SyntaxHighlighter from 'react-syntax-highlighter'
import atomOneDark from 'react-syntax-highlighter/dist/esm/styles/hljs/atom-one-dark.js'
import lightfair from 'react-syntax-highlighter/dist/esm/styles/hljs/lightfair.js'

import { useThemeMode } from '../../context/ThemeModeContext'
import type { WidgetProps } from '../../types/Widget'

import styles from './YamlViewer.module.css'
import type { YamlViewer as WidgetType } from './YamlViewer.type'

export type YamlViewerWidgetData = WidgetType['spec']['widgetData']

const YamlViewer = ({ uid, widgetData }: WidgetProps<YamlViewerWidgetData>) => {
  const { json } = widgetData
  const { mode } = useThemeMode()

  const [isCopied, setIsCopied] = useState(false)

  const { error, isEmpty, yamlString } = useMemo(() => {
    if (!json?.trim()) { return { error: null, isEmpty: true, yamlString: '' } }

    try {
      const parsedJson = JSON.parse(json) as unknown
      return { error: null, yamlString: dump(parsedJson) }
    } catch (error) {
      return {
        error: `Error while parsing JSON data: ${error as string}`,
        isEmpty: false,
        yamlString: '',
      }
    }
  }, [json])

  if (isEmpty) {
    return (
      <div className={styles.container}>
        <Empty description='No data to display' image={Empty.PRESENTED_IMAGE_SIMPLE} />
      </div>
    )
  }

  if (error) {
    return (
      <div className={styles.container}>
        <Result status='error' subTitle={error} title={'Error'} />
      </div>
    )
  }

  return (
    <div className={styles.container} key={uid}>
      <div className={styles.codeViewer}>
        <div className={styles.button}>
          {isCopied && 'Copied to clipboard'}

          <CopyToClipboard
            onCopy={() => {
              setIsCopied(true)
              setTimeout(() => setIsCopied(false), 2500)
            }}
            text={yamlString}
          >
            <Button icon={<FontAwesomeIcon icon={['fas', 'copy'] as IconProp} />} size='large' />
          </CopyToClipboard>
        </div>

        {/* Non-antd: react-syntax-highlighter — antd has no code/syntax component (see docs/widget-authoring.md). */}
        {/* lineProps: a block line keeps its spaces when it wraps — see BLOCK_LINE in Autopilot/previewSurface.tsx. */}
        <SyntaxHighlighter
          language='yaml'
          lineProps={{ style: { display: 'block' } }}
          showLineNumbers
          style={(mode === 'dark' ? atomOneDark : lightfair) as { [key: string]: React.CSSProperties }}
          wrapLines
          wrapLongLines
        >
          {yamlString}
        </SyntaxHighlighter>
      </div>
    </div>
  )
}

export default YamlViewer
