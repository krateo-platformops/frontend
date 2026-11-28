// @vitest-environment jsdom
/**
 * C26 as revised on 2026-11-25 (UX audit COL-2): a button that closes or backs out (Cancel, Close,
 * Dismiss) is the NEUTRAL default outline, the look of Reset, Discard and Reject beside it. It was an
 * amber outline, and amber means transitional or warning: the safest button on a form looked like a
 * caution. The role, its component and both checks stay (buttonRoles.test.ts, the `button-role` lint).
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { cleanup, render, screen } from '@testing-library/react'
import { Button } from 'antd'
import { afterEach, describe, expect, it } from 'vitest'

import DismissButton, { dismissButtonProps } from './DismissButton'

afterEach(cleanup)

const classesOf = (name: string) => [...screen.getByRole('button', { name }).classList].sort()

describe('the dismiss role draws the neutral outline', () => {
  it('DismissButton and dismissButtonProps draw exactly what a neutral outlined Reset draws', () => {
    render(<>
      <Button color='default' variant='outlined'>Reset</Button>
      <DismissButton>Cancel</DismissButton>
      <Button {...dismissButtonProps}>Close</Button>
    </>)
    expect(classesOf('Cancel')).toEqual(classesOf('Reset'))
    expect(classesOf('Close')).toEqual(classesOf('Reset'))
    expect(classesOf('Cancel')).toContain('ant-btn-color-default')
    expect(classesOf('Cancel')).toContain('ant-btn-variant-outlined')
  })

  it('the inline link form is antd\'s default-colour link, no class of its own', () => {
    render(<><Button color='default' variant='link'>Keep</Button><DismissButton type='link'>Dismiss</DismissButton></>)
    expect(classesOf('Dismiss')).toEqual(classesOf('Keep'))
  })

  it('the one native dismiss button (the Agentiko voice row\'s Cancel) paints no warning ink either', () => {
    const css = readFileSync(join(__dirname, '..', 'Agentiko', 'AgentikoRail.module.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
    const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter((match) => /\.apVoiceCancel\b/.test(match[1]))
    expect(rules.length).toBeGreaterThan(0)
    expect(rules.map((match) => match[2]).join('')).not.toMatch(/warning/)
  })
})
