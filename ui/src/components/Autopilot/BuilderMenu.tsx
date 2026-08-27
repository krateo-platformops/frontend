/**
 * UI-NATIVE BUILDER MENU (item C) — the single header launcher for the UI-native builders.
 *
 * #138 shipped a lone KogBuilderTrigger icon button in the app-shell header. This slice adds two more
 * UI-native builders (Import blueprint, Import portal page); rather than crowd the header with three
 * separate icon buttons, they share ONE "New / Import" dropdown (keeps the header chrome uncluttered,
 * per the task's launcher-menu suggestion). Each item opens its own self-contained modal; only the
 * open modal is mounted (state owned here). All three reach the SAME publish machinery + blast-radius
 * confirm — nothing lands live; a human merges the PR.
 */

import type { IconProp } from '@fortawesome/fontawesome-svg-core'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { Button, Dropdown, Tooltip } from 'antd'
import type { MenuProps } from 'antd'
import { useState } from 'react'

import { BlueprintBuilderForm } from './BlueprintBuilderForm'
import { KogBuilderForm } from './KogBuilderForm'
import { PageBuilderForm } from './PageBuilderForm'

/** Which builder modal (if any) is open. */
type OpenBuilder = 'blueprint' | 'kog' | 'page' | null

/**
 * The header launcher. A plain icon button opens a dropdown of the three UI-native builders; picking
 * one opens its modal. Lives in the app-shell header chrome (like CommandPalette / AutopilotToggle),
 * so a UI-native authoring/import path is reachable from anywhere WITHOUT Autopilot.
 */
export const BuilderMenu = () => {
  const [open, setOpen] = useState<OpenBuilder>(null)

  const items: MenuProps['items'] = [
    { icon: <FontAwesomeIcon icon={['fas', 'plug-circle-plus'] as IconProp} />, key: 'kog', label: 'New RestDefinition (API mapping)' },
    { icon: <FontAwesomeIcon icon={['fas', 'cube'] as IconProp} />, key: 'blueprint', label: 'Import blueprint (Helm chart)' },
    { icon: <FontAwesomeIcon icon={['fas', 'file-lines'] as IconProp} />, key: 'page', label: 'Import portal page' },
  ]

  return (
    <>
      <Dropdown menu={{ items, onClick: ({ key }) => setOpen(key as OpenBuilder) }} trigger={['click']}>
        <Tooltip title='New / import (RestDefinition, blueprint, page)'>
          <Button
            aria-label='New or import (RestDefinition, blueprint, page)'
            icon={<FontAwesomeIcon icon={['fas', 'circle-plus'] as IconProp} />}
            type='text'
          />
        </Tooltip>
      </Dropdown>
      {open === 'kog' ? <KogBuilderForm onClose={() => setOpen(null)} open /> : null}
      {open === 'blueprint' ? <BlueprintBuilderForm onClose={() => setOpen(null)} open /> : null}
      {open === 'page' ? <PageBuilderForm onClose={() => setOpen(null)} open /> : null}
    </>
  )
}

export default BuilderMenu
