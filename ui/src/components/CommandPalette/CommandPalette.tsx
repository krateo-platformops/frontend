import type { IconProp } from '@fortawesome/fontawesome-svg-core'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { Input, Modal } from 'antd'
import type { InputRef } from 'antd'
import type { KeyboardEvent as ReactKeyboardEvent } from 'react'
import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router'

import styles from './CommandPalette.module.css'
import type { SearchHit } from './useSearchTypeahead'
import { useSearchTypeahead } from './useSearchTypeahead'

// ⌘ on Mac, Ctrl elsewhere — for the visible hint only; the handler accepts both.
const isMac = typeof navigator !== 'undefined' && /mac/i.test(navigator.userAgent)
const shortcutHint = isMac ? '⌘K' : 'Ctrl K'

/**
 * Global search as a ⌘K command palette. The header shows a compact trigger;
 * ⌘K (Ctrl+K off-Mac) or a click opens an overlay with an autofocused input.
 *
 * Typing shows INLINE typeahead results (UX audit #22): the same `global-search`
 * data the /search page renders, debounced + cached per term (see
 * useSearchTypeahead). ↑/↓ move the selection; Enter ON a selection (or a click)
 * SPA-navigates to that hit's own link. Plain Enter — no selection — keeps the
 * original behavior and routes to the data-driven `/search?q=…` page, which is
 * also the silent fallback whenever the typeahead fetch fails or finds nothing.
 * Lives in the engine (client state), not as a widget, like the rest of
 * HeaderChrome.
 */
const CommandPalette = () => {
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [term, setTerm] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(-1)
  const inputRef = useRef<InputRef>(null)
  const { hits, isEmpty, isFetching } = useSearchTypeahead(open ? term : '')

  // Global ⌘K / Ctrl+K toggles the palette from anywhere; preventDefault stops
  // the browser's own address-bar quick-search binding from stealing the combo.
  useEffect(() => {
    // `KeyboardEvent` here is the DOM global, NOT React's synthetic one — this listener is
    // registered on `window`, so React's type is the wrong shape and the overload never matched.
    // React's is imported aliased as ReactKeyboardEvent for the handlers that genuinely take it.
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setOpen((prev) => !prev)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  const close = () => {
    setOpen(false)
    setTerm('')
    setSelectedIndex(-1)
  }

  const goToHit = (hit: SearchHit) => {
    // A hit without a link (defensive: the RA always emits one) falls back to the
    // full results page, same as a plain-Enter submit.
    const query = term.trim()
    if (hit.link) {
      void navigate(hit.link)
    } else if (query) {
      void navigate(`/search?q=${encodeURIComponent(query)}`)
    }
    close()
  }

  const submit = () => {
    // Enter ON a keyboard-selected result opens that result; plain Enter keeps the
    // original full-page search behavior (also the typeahead-failure fallback).
    const selected = selectedIndex >= 0 ? hits[selectedIndex] : undefined
    if (selected) {
      goToHit(selected)
      return
    }
    const query = term.trim()
    if (query) { void navigate(`/search?q=${encodeURIComponent(query)}`) }
    close()
  }

  const onInputKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (hits.length === 0) { return }
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setSelectedIndex((prev) => (prev + 1) % hits.length)
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setSelectedIndex((prev) => (prev <= 0 ? hits.length - 1 : prev - 1))
    }
  }

  return (
    <>
      <button aria-label={`Search (${shortcutHint})`} className={styles.trigger} onClick={() => setOpen(true)} type='button'>
        <FontAwesomeIcon className={styles.triggerIcon} icon={['fas', 'magnifying-glass'] as IconProp}/>
        <span className={styles.triggerLabel}>Search resources, blueprints…</span>
        <kbd className={styles.kbd}>{shortcutHint}</kbd>
      </button>

      <Modal
        afterOpenChange={(isOpen) => { if (isOpen) { inputRef.current?.focus() } }}
        className={styles.modal}
        closable={false}
        footer={null}
        onCancel={close}
        open={open}
        width={560}
      >
        <Input
          allowClear
          onChange={(event) => {
            setTerm(event.target.value)
            setSelectedIndex(-1)
          }}
          onKeyDown={onInputKeyDown}
          onPressEnter={submit}
          placeholder='Search resources, blueprints…'
          prefix={<FontAwesomeIcon className={styles.modalIcon} icon={['fas', 'magnifying-glass'] as IconProp}/>}
          ref={inputRef}
          size='large'
          value={term}
        />
        {hits.length > 0 && (
          <div aria-label='Search results' className={styles.results} role='listbox'>
            {hits.map((hit, index) => (
              <button
                aria-selected={index === selectedIndex}
                className={index === selectedIndex ? `${styles.resultRow} ${styles.resultActive}` : styles.resultRow}
                key={`${hit.link ?? hit.title}-${index}`}
                onClick={() => goToHit(hit)}
                onMouseEnter={() => setSelectedIndex(index)}
                role='option'
                type='button'
              >
                <span className={styles.resultText}>
                  <span className={styles.resultTitle}>{hit.title}</span>
                  {hit.subtitle && <span className={styles.resultSubtitle}>{hit.subtitle}</span>}
                </span>
                {hit.type && <span className={styles.resultType}>{hit.type}</span>}
              </button>
            ))}
          </div>
        )}
        {isEmpty && <div className={styles.noMatches}>No quick matches — press Enter for the full search</div>}
        <div className={styles.hintRow}>
          <span><kbd className={styles.kbdInline}>Enter</kbd> to search</span>
          {hits.length > 0 && <span><kbd className={styles.kbdInline}>↑↓</kbd> to select</span>}
          <span><kbd className={styles.kbdInline}>Esc</kbd> to close</span>
          {isFetching && <span className={styles.searching}>Searching…</span>}
        </div>
      </Modal>
    </>
  )
}

export default CommandPalette
