import type { IconProp } from '@fortawesome/fontawesome-svg-core'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { Button } from 'antd'
import { useMemo, useState } from 'react'
import { CopyToClipboard } from 'react-copy-to-clipboard-ts'
import { default as ReactMarkdown } from 'react-markdown'

import type { WidgetProps } from '../../types/Widget'

import styles from './Markdown.module.css'
import type { Markdown as WidgetType } from './Markdown.type'

export type MarkdownWidgetData = WidgetType['spec']['widgetData']

const Markdown = ({ uid, widgetData }: WidgetProps<MarkdownWidgetData>) => {
  const { allowCopy, allowDownload, downloadFileExtension = 'txt', markdown } = widgetData

  const [isCopied, setIsCopied] = useState(false)

  const hasActions = useMemo(() => allowCopy || allowDownload, [allowCopy, allowDownload])

  const handleDownload = () => {
    const blob = new Blob([markdown], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const file = document.createElement('a')
    file.href = url
    file.download = `file.${downloadFileExtension}`
    file.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className={styles.markdown}>
      {hasActions && (
        <div className={styles.actions}>
          {allowCopy && (
            <div className={styles.button}>
              {isCopied && 'Copied to clipboard'}

              <CopyToClipboard
                onCopy={() => {
                  setIsCopied(true)
                  setTimeout(() => setIsCopied(false), 2500)
                }}
                text={markdown}
              >
                <Button icon={<FontAwesomeIcon icon={['fas', 'copy'] as IconProp} />} size='large' />
              </CopyToClipboard>
            </div>
          )}

          {allowDownload && (
            <div className={styles.button}>
              <Button icon={<FontAwesomeIcon icon={['fas', 'download'] as IconProp} />} onClick={handleDownload} size='large' />
            </div>
          )}
        </div>
      )}

      {/* Non-antd: react-markdown — antd has no markdown renderer (see docs/widget-authoring.md). */}
      <ReactMarkdown
        components={{
          // In-page anchor links `[text](#id)` (e.g. a summary table-of-contents, issue #69) smooth-
          // scroll to the element with that id — intercepted so react-router doesn't treat the hash as
          // a route and so we get smooth behaviour + a synced URL hash. External/normal links open safely.
          a: ({ children, href }) => {
            if (href?.startsWith('#')) {
              return (
                <a
                  href={href}
                  onClick={(event) => {
                    const target = document.getElementById(href.slice(1))
                    if (target) {
                      event.preventDefault()
                      // `block: 'nearest'` + an explicit scroll on the actual scroll ancestor:
                      // scrollIntoView({behavior:'smooth'}) is a no-op inside this app's
                      // `ant-layout-content` scroller (a re-render cancels the animation before it
                      // starts), so we jump instantly, which is the expected behaviour for a ToC.
                      target.scrollIntoView({ behavior: 'auto', block: 'start' })
                      window.history.replaceState(null, '', href)
                    }
                  }}
                >
                  {children}
                </a>
              )
            }
            return <a href={href} rel='noopener noreferrer' target='_blank'>{children}</a>
          },
          pre: ({ children }) => (
            // Fenced code blocks WRAP instead of scrolling horizontally: in the narrow content
            // column (and the docked Autopilot rail) a JSON payload or a shell command on one long
            // line would hide behind a horizontal scrollbar. `pre-wrap` keeps the authored newlines
            // + indentation but soft-wraps long lines; `overflowWrap: anywhere` breaks a single
            // unbreakable token (a long ref/URL) so nothing ever needs a scrollbar to be read.
            <pre
              style={{
                background: 'rgba(127,127,127,0.12)',
                border: '1px solid var(--border-color)',
                borderLeft: '3px solid var(--primary-color)',
                borderRadius: '4px',
                fontFamily: 'var(--font-mono)',
                fontSize: '13px',
                margin: '8px 0',
                overflowWrap: 'anywhere',
                padding: '8px 16px',
                whiteSpace: 'pre-wrap',
              }}
            >
              {children}
            </pre>
          ),
        }}
        key={uid}
      >
        {markdown}
      </ReactMarkdown>
    </div>
  )
}

export default Markdown
