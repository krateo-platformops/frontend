// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it } from 'vitest'

import { ThemeModeProvider } from '../../context/ThemeModeContext'
import type { BlastRadius, BlastRadiusSet } from '../../hooks/blastRadius.types'
import { BLAST_RADIUS_CONFIRM_Z_INDEX, buildConfirmModalProps } from '../../hooks/confirmModalProps'
import type { RestActionConfirmation } from '../../types/Widget'

import { WHAT_WILL_BE_SENT } from './ActionConfirmation'
import BlastRadiusConfirm from './BlastRadiusConfirm'

/**
 * A rest action's `confirmation` gives the ONE write gate the page's words. These pin the two
 * halves of the contract: with it, the dialog shows its title, message, Alert and OK label and
 * folds the technical facts under a collapsed "What will be sent"; without it, the dialog is
 * exactly what it was before the field existed.
 */

const noop = () => undefined

const deleteRadius: BlastRadius = {
  cluster: 'local',
  count: 1,
  diff: { before: { apiVersion: 'core.krateo.io/v1alpha1', kind: 'CompositionDefinition', metadata: { name: 'my-blueprint', namespace: 'krateo-system' } }, kind: 'delete' },
  gvr: { group: 'core.krateo.io', resource: 'compositiondefinitions', version: 'v1alpha1' },
  name: 'my-blueprint',
  namespace: 'krateo-system',
  verb: 'DELETE',
}

const setRadius: BlastRadiusSet = {
  count: 2,
  kind: 'set',
  ops: [
    { gvr: { group: 'apps', resource: 'deployments', version: 'v1' }, irreversible: false, namespace: 'demo', verb: 'POST' },
    { gvr: { group: 'apps', resource: 'deployments', version: 'v1' }, irreversible: false, namespace: 'demo', verb: 'POST' },
  ],
}

const uninstall: RestActionConfirmation = {
  alert: {
    items: [{ href: '/compositions/team-a/my-app', label: 'my-app', tag: 'Paused' }, { label: 'other-app' }],
    message: '2 compositions were created from it.',
    type: 'warning',
  },
  message: 'This removes the blueprint my-blueprint from the Platform.',
  okLabel: 'Uninstall',
  title: 'Uninstall my-blueprint?',
}

// The header's accessible name also carries the expand icon's label ("right"), so match the words.
const sentDisclosure = new RegExp(WHAT_WILL_BE_SENT)

const renderContent = (content: ReactNode) => render(<ThemeModeProvider>{content}</ThemeModeProvider>)

describe('buildConfirmModalProps — with the action\'s confirmation', () => {
  afterEach(cleanup)

  it('titles the dialog and labels the OK button with the action\'s words, keeping danger, width and zIndex', () => {
    const props = buildConfirmModalProps(deleteRadius, noop, noop, uninstall)
    expect(props.title).toBe('Uninstall my-blueprint?')
    expect(props.okText).toBe('Uninstall')
    // A DELETE stays danger, with or without the action's words.
    expect(props.okButtonProps).toEqual({ danger: true })
    expect(props.width).toBe(560)
    expect(props.zIndex).toBe(BLAST_RADIUS_CONFIRM_Z_INDEX)
    expect(props.cancelText).toBe('Cancel')
  })

  it('shows the message and the Alert with its items, and folds the facts under a collapsed "What will be sent"', () => {
    renderContent(buildConfirmModalProps(deleteRadius, noop, noop, uninstall).content)

    expect(screen.getByText('This removes the blueprint my-blueprint from the Platform.')).toBeTruthy()

    const alert = screen.getByRole('alert')
    // antd Alert of the warning type: the amber one.
    expect(alert.className).toContain('ant-alert-warning')
    expect(within(alert).getByText('2 compositions were created from it.')).toBeTruthy()
    const link = within(alert).getByRole('link', { name: 'my-app' })
    expect(link.getAttribute('href')).toBe('/compositions/team-a/my-app')
    // A link inside a pending decision opens elsewhere, so the dialog is not left over another page.
    expect(link.getAttribute('target')).toBe('_blank')
    expect(within(alert).getByText('Paused')).toBeTruthy()
    expect(within(alert).getByText('other-app')).toBeTruthy()

    // The facts are one click away, not on screen.
    const disclosure = screen.getByRole('button', { name: sentDisclosure })
    expect(disclosure.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByTestId('blast-radius-confirm')).toBeNull()

    fireEvent.click(disclosure)
    const facts = screen.getByTestId('blast-radius-confirm')
    expect(within(facts).getByText('DELETE')).toBeTruthy()
    expect(within(facts).getByText('compositiondefinitions.core.krateo.io/v1alpha1')).toBeTruthy()
  })

  it('leaves the Alert out when the confirmation has none', () => {
    const { alert: _alert, ...plain } = uninstall
    renderContent(buildConfirmModalProps(deleteRadius, noop, noop, plain).content)
    expect(screen.getByText('This removes the blueprint my-blueprint from the Platform.')).toBeTruthy()
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.getByRole('button', { name: sentDisclosure })).toBeTruthy()
  })

  it('folds a write-set\'s op list the same way, under the action\'s title and label', () => {
    const props = buildConfirmModalProps(setRadius, noop, noop, { message: 'Two deployments are created.', okLabel: 'Create both', title: 'Create the deployments?' })
    expect(props.title).toBe('Create the deployments?')
    expect(props.okText).toBe('Create both')
    expect(props.okButtonProps).toBeUndefined()
    renderContent(props.content)
    expect(screen.queryByTestId('blast-radius-confirm')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: sentDisclosure }))
    expect(screen.getAllByTestId('blast-radius-set-op')).toHaveLength(2)
  })

  it('has no "What will be sent" on a read-only opt-in, where nothing is sent', () => {
    const props = buildConfirmModalProps(undefined, noop, noop, { message: 'You leave this page.', okLabel: 'Continue', title: 'Open the report?' })
    expect(props.title).toBe('Open the report?')
    expect(props.okText).toBe('Continue')
    renderContent(props.content)
    expect(screen.getByText('You leave this page.')).toBeTruthy()
    expect(screen.queryByRole('button', { name: sentDisclosure })).toBeNull()
  })
})

describe('buildConfirmModalProps — without a confirmation, the dialog is unchanged', () => {
  afterEach(cleanup)

  it('keeps the gate\'s own title, button and body for a DELETE, with the facts on screen', () => {
    const props = buildConfirmModalProps(deleteRadius, noop, noop)
    expect(props.title).toBe('Confirm write')
    expect(props.okText).toBe('Confirm delete')
    expect(props.okButtonProps).toEqual({ danger: true })
    expect(props.width).toBe(560)
    // The body is the facts themselves, not the action's wrapper.
    expect((props.content as { type?: unknown }).type).toBe(BlastRadiusConfirm)

    renderContent(props.content)
    expect(screen.getByTestId('blast-radius-confirm')).toBeTruthy()
    expect(screen.queryByTestId('action-confirmation')).toBeNull()
    expect(screen.queryByText(WHAT_WILL_BE_SENT)).toBeNull()
  })

  it('an explicit undefined confirmation builds the same props as none', () => {
    const before = buildConfirmModalProps(deleteRadius, noop, noop)
    const after = buildConfirmModalProps(deleteRadius, noop, noop, undefined)
    expect(after.title).toBe(before.title)
    expect(after.okText).toBe(before.okText)
    expect(after.okButtonProps).toEqual(before.okButtonProps)
    expect((after.content as { type?: unknown }).type).toBe(BlastRadiusConfirm)
  })

  it('keeps the plain "Are you sure?" read-only prompt with no body', () => {
    const props = buildConfirmModalProps(undefined, noop, noop)
    expect(props.title).toBe('Are you sure?')
    expect(props.okText).toBe('Confirm')
    expect(props.content).toBeUndefined()
  })
})
