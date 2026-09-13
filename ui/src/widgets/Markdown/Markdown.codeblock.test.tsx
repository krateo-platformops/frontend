// @vitest-environment jsdom
/**
 * Per-code-block copy on the Markdown widget.
 *
 * `allowCopy` renders ONE button that copies the entire markdown — prose, headings and every fenced
 * block at once. On a remediation step that produced something unusable: the copy carried the
 * explanation, a JSON payload AND two shell commands, so it could not be pasted into a terminal,
 * which is the only reason the button gets pressed
 * (reported on /incidents/krateo-system/report-provenance-test).
 *
 * These tests pin the fix: a copy control per fenced block, copying THAT block and nothing else.
 */

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import Markdown from './Markdown'

const copied: string[] = []

// react-copy-to-clipboard-ts wraps its child and calls the clipboard on click; jsdom has no
// clipboard, so the wrapper is stubbed to record what it was handed. That string IS the assertion:
// the defect was never "no button", it was "the button copies the wrong text".
vi.mock('react-copy-to-clipboard-ts', () => ({
  CopyToClipboard: ({ children, text }: { children: React.ReactNode, text: string }) => (
    <span data-copytext={text} onClick={() => copied.push(text)}>{children}</span>
  ),
}))

const TWO_BLOCKS = [
  '**REMEDIATE**',
  '',
  'Clicking **Review & apply** will send a **PATCH** to `alerts/provenance-test`.',
  '',
  'Run it in your terminal:',
  '',
  '```bash',
  'kubectl patch alerts provenance-test --type merge -p \'{"metadata":{"finalizers":[]}}\' -n krateo-system',
  '```',
  '',
  '**Verify:** Alert provenance-test is deleted from the cluster',
  '',
  '```bash',
  'kubectl get alert provenance-test -n krateo-system',
  '```',
].join('\n')

const renderMd = (markdown: string, allowCopy = false) =>
  render(<Markdown resourcesRefs={{ items: [] }} uid='t' widgetData={{ allowCopy, markdown }} />)

afterEach(() => {
  copied.length = 0
  cleanup()
})

describe('Markdown fenced code blocks', () => {
  it('gives every fenced block its own copy control', () => {
    renderMd(TWO_BLOCKS)
    expect(screen.getAllByTitle('Copy this block')).toHaveLength(2)
  })

  it('copies only that block — not the prose, and not the other block', () => {
    const { container } = renderMd(TWO_BLOCKS)
    const texts = Array.from(container.querySelectorAll('[data-copytext]'))
      .map((n) => n.getAttribute('data-copytext') ?? '')

    expect(texts[0]).toContain('kubectl patch alerts provenance-test')
    expect(texts[1]).toContain('kubectl get alert provenance-test')

    // The whole point: neither copy carries the surrounding prose or the sibling command.
    for (const t of texts) {
      expect(t).not.toContain('REMEDIATE')
      expect(t).not.toContain('Review & apply')
    }
    expect(texts[0]).not.toContain('kubectl get alert')
    expect(texts[1]).not.toContain('kubectl patch')
  })

  it('adds no control to an empty fence', () => {
    renderMd(['```bash', '', '```'].join('\n'))
    expect(screen.queryAllByTitle('Copy this block')).toHaveLength(0)
  })

  it('leaves the widget-level allowCopy button alone', () => {
    // The two affordances coexist: allowCopy still copies the whole document for the cases that
    // want it (a manifest, a whole prompt). The per-block button is additive, not a replacement.
    const { container } = renderMd(TWO_BLOCKS, true)
    const texts = Array.from(container.querySelectorAll('[data-copytext]'))
      .map((n) => n.getAttribute('data-copytext') ?? '')
    expect(texts.some((t) => t.includes('REMEDIATE'))).toBe(true)
    expect(screen.getAllByTitle('Copy this block')).toHaveLength(2)
  })
})
