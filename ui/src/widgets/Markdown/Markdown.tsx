import type { IconProp } from '@fortawesome/fontawesome-svg-core'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { Button } from 'antd'
import { isValidElement, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { CopyToClipboard } from 'react-copy-to-clipboard-ts'
import { default as ReactMarkdown } from 'react-markdown'

import type { WidgetProps } from '../../types/Widget'

import styles from './Markdown.module.css'
import type { Markdown as WidgetType } from './Markdown.type'

export type MarkdownWidgetData = WidgetType['spec']['widgetData']

// The text a fenced code block actually contains. react-markdown hands `pre` a React tree (a <code>
// element whose children are strings, sometimes split across nodes by the highlighter), so the raw
// source is not available as a prop and has to be walked out of the children.
const textFromNode = (node: ReactNode): string => {
  if (node === null || node === undefined || typeof node === 'boolean') { return '' }
  if (typeof node === 'string' || typeof node === 'number') { return String(node) }
  if (Array.isArray(node)) { return node.map(textFromNode).join('') }
  if (isValidElement(node)) { return textFromNode((node.props as { children?: ReactNode }).children) }
  return ''
}

// A fenced code block with its OWN copy button.
//
// WHY THIS EXISTS. `allowCopy` puts one button at the top of the whole widget and copies the entire
// markdown — every heading, every sentence, every code block at once. On a remediation step that
// produced something no one can use: the copied text was the prose, the JSON payload AND two shell
// commands, so it could not be pasted into a terminal, which is the only reason anyone pressed it
// (reported on /incidents/krateo-system/report-provenance-test). A command is the thing people copy,
// so the button belongs on the command.
//
// Every markdown in the portal gets this, not just remediation steps — agent prompts, the gateway
// registration steps, the seven-hop walk all carry commands and manifests in fenced blocks.
const CodeBlock = ({ children }: { children?: ReactNode }) => {
  const [isCopied, setIsCopied] = useState(false)
  const text = useMemo(() => textFromNode(children), [children])

  return (
    <div className={styles.codeBlock}>
      <pre
        style={{
          // The one value in this block that was not a token, beside `--border-color` and
          // `--primary-color` on the next two lines. A 12% grey is theme-neutral by accident, not
          // by design: it renders the same fill on both grounds. `--lightgray-color` is the subtle
          // surface tier and moves with the mode (#F5F5F5 light, #1C1C1C dark).
          background: 'var(--lightgray-color)',
          border: '1px solid var(--border-color)',
          borderLeft: '3px solid var(--primary-color)',
          borderRadius: '4px',
          fontFamily: 'var(--font-mono)',
          fontSize: '13px',
          margin: '8px 0',
          overflowWrap: 'anywhere',
          // Room for the button so a long command never runs underneath it.
          paddingRight: '44px',
          whiteSpace: 'pre-wrap',
        }}
      >
        {children}
      </pre>

      {/* Only when there is something to copy: an empty fence gets no button rather than a dead one. */}
      {text.trim() !== '' && (
        <CopyToClipboard
          onCopy={() => {
            setIsCopied(true)
            setTimeout(() => setIsCopied(false), 2500)
          }}
          text={text}
        >
          <Button
            aria-label={isCopied ? 'Copied to clipboard' : 'Copy this block'}
            className={styles.codeBlockCopy}
            icon={<FontAwesomeIcon icon={['fas', isCopied ? 'check' : 'copy'] as IconProp} />}
            size='small'
            title={isCopied ? 'Copied to clipboard' : 'Copy this block'}
          />
        </CopyToClipboard>
      )}
    </div>
  )
}

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
          // Fenced code blocks WRAP instead of scrolling horizontally: in the narrow content
          // column (and the docked Autopilot rail) a JSON payload or a shell command on one long
          // line would hide behind a horizontal scrollbar. `pre-wrap` keeps the authored newlines
          // + indentation but soft-wraps long lines; `overflowWrap: anywhere` breaks a single
          // unbreakable token (a long ref/URL) so nothing ever needs a scrollbar to be read.
          // CodeBlock adds the per-block copy button — see its own note.
          pre: ({ children }) => <CodeBlock>{children}</CodeBlock>,
        }}
        key={uid}
      >
        {markdown}
      </ReactMarkdown>
    </div>
  )
}

export default Markdown
