import { dump } from 'js-yaml'
import SyntaxHighlighter from 'react-syntax-highlighter'
import atomOneDark from 'react-syntax-highlighter/dist/esm/styles/hljs/atom-one-dark.js'
import lightfair from 'react-syntax-highlighter/dist/esm/styles/hljs/lightfair.js'

import { useDocumentThemeMode } from '../../theme/palette'

import styles from './YamlBlock.module.css'

/** Stable YAML for a value a person is asked to read — Kubernetes objects the way Kubernetes
 * writes them. Non-throwing on cyclic/odd values. */
export const toYaml = (value: unknown): string => {
  if (value === undefined) {
    return ''
  }
  try {
    return dump(value, { lineWidth: 120, noRefs: true })
  } catch {
    // A value the dumper can't serialise (cyclic ref, BigInt, …) has no meaningful text form.
    return '[unserialisable value]'
  }
}

/**
 * One look for "here is the structured value": syntax-highlighted YAML in a bordered,
 * scroll-bounded block, following the theme.
 *
 * It lived inside the write-confirm dialog. The form's Review step, one screen earlier, showed the
 * same values as compact JSON on one line — the person read `{"hosts":[{"host":…` and was then
 * shown the YAML only once they pressed Create. C24: the same thing is drawn by the same
 * component. `className` places it; the block itself is the same everywhere.
 */
const YamlBlock = ({ className, value }: { className?: string; value: unknown }) => {
  // The document's mode, not the ThemeMode context: a shared block must not need a provider to
  // render (the review step is rendered and tested on its own), and palette.ts is the one reading
  // of the mode everything that paints outside CSS already goes through.
  const mode = useDocumentThemeMode()
  const style = (mode === 'dark' ? atomOneDark : lightfair) as { [key: string]: React.CSSProperties }
  return (
    <div className={[styles.block, className].filter(Boolean).join(' ')}>
      <SyntaxHighlighter language='yaml' style={style} wrapLines wrapLongLines>{toYaml(value)}</SyntaxHighlighter>
    </div>
  )
}

export default YamlBlock
