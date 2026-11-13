import type { IconProp } from '@fortawesome/fontawesome-svg-core'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { Button, Space } from 'antd'
import { useNavigate } from 'react-router'

import { dismissButtonProps } from '../../components/DismissButton'
import { carryScopeParams } from '../../utils/navigation'

import styles from './Form.module.css'
import type { Form as WidgetType } from './Form.type'

interface FormExtraProps {
  buttonConfig?: WidgetType['spec']['widgetData']['buttonConfig']
  disabled?: boolean | undefined
  form?: string | undefined
  loading?: boolean
  // When set, a "Save draft" button is shown between Cancel and the primary; it is a
  // plain (htmlType='button') button so it does NOT trigger form validation — clicking
  // it persists the current field values as-is. Only wired for the inline (non-drawer)
  // render; the drawer omits it.
  onDraft?: (() => void | Promise<void>) | undefined
  // Disables ONLY the primary (submit) button while leaving Cancel/Reset usable — used by
  // `submitDisabledWhenPristine` so an unchanged form (e.g. a version picker still on the
  // current version) can't submit a no-op.
  submitDisabled?: boolean | undefined
  // Overrides the primary (submit) button label — used by review-before-submit so the
  // Configure step's button reads "Review →" while the final Review-step button keeps
  // the real create label.
  submitLabel?: string | undefined
}

/**
 * The Form's action bar: Save draft pinned LEFT, Cancel/Reset + primary grouped RIGHT (mockup
 * `.actionbar` split). With no draft action (e.g. the drawer render) the left slot is an empty
 * spacer, so the right group stays right-aligned.
 *
 * Two opt-ins of `buttonConfig`, each absent by default (Form.presentationUnchanged.test.tsx):
 * `secondary.hidden` drops the Reset/Cancel button, and `primary.block` makes the primary span the
 * bar, any other button stacked above it; `primary.size` is the primary's antd `size`.
 */
export const FormExtra = ({ buttonConfig, disabled = false, form, loading, onDraft, submitDisabled = false, submitLabel }: FormExtraProps): React.ReactNode => {
  const navigate = useNavigate()
  // When `secondary.navigateTo` is set the secondary button is a Cancel that
  // navigates (SPA) instead of resetting the form. It leaves without deleting anything, so it
  // takes the DISMISS role (C26): amber. A Reset stays neutral — it clears unsaved input on the
  // spot, it neither leaves nor deletes anything stored.
  const secondaryNav = buttonConfig?.secondary?.navigateTo
  const primaryConfig = buttonConfig?.primary
  const draft = onDraft
    ? (
      <Button
        disabled={disabled}
        htmlType='button'
        icon={buttonConfig?.draft?.icon ? <FontAwesomeIcon icon={buttonConfig?.draft?.icon as IconProp} /> : undefined}
        onClick={() => { void onDraft() }}
        type='default'
      >
        {buttonConfig?.draft?.label || 'Save draft'}
      </Button>
    )
    : null
  const secondary = buttonConfig?.secondary?.hidden
    ? null
    : (
      <Button
        {...(secondaryNav ? dismissButtonProps : {})}
        disabled={disabled}
        form={form}
        htmlType={secondaryNav ? 'button' : 'reset'}
        icon={buttonConfig?.secondary?.icon ? <FontAwesomeIcon icon={buttonConfig?.secondary?.icon as IconProp} /> : undefined}
        onClick={secondaryNav ? () => { void navigate(carryScopeParams(secondaryNav)) } : undefined}
        type='default'
      >
        {buttonConfig?.secondary?.label || 'Reset'}
      </Button>
    )
  const primary = (
    <Button
      block={primaryConfig?.block || undefined}
      disabled={submitDisabled}
      form={form}
      htmlType='submit'
      icon={primaryConfig?.icon ? <FontAwesomeIcon icon={primaryConfig.icon as IconProp} /> : undefined}
      loading={loading}
      size={primaryConfig?.size}
      type='primary'
    >
      {submitLabel ?? (primaryConfig?.label || 'Submit')}
    </Button>
  )

  if (primaryConfig?.block) {
    return <div className={styles.actionColumn}>{draft}{secondary}{primary}</div>
  }
  return (
    <div className={styles.actionRow}>
      {draft ?? <span />}
      <Space>
        {secondary}
        {primary}
      </Space>
    </div>
  )
}
