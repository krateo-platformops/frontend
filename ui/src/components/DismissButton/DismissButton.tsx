import { Button, type ButtonProps } from 'antd'

import styles from './DismissButton.module.css'

/**
 * C26 — BUTTON ROLES. A button says what it does to the work in front of you:
 *
 *   - DISMISS: it closes or backs out — Cancel, Close, Close draft, Keep editing. Nothing stored is
 *     deleted. Amber, outlined: this component, or `dismissButtonProps` where antd builds the
 *     button itself (a Popconfirm's or a Modal's `cancelButtonProps`).
 *   - DESTROY: it deletes content — Discard a draft, Remove, Delete. Red: antd's own `danger`.
 *   - Everything else keeps its place in the primary / secondary hierarchy (P6).
 *
 * src/test/buttonRoles.test.ts holds the app to it; the composition lint's `button-role` rule holds
 * the chart's Button CRs (`intent: dismiss`, `danger: true`).
 */
export const dismissButtonProps: ButtonProps = { className: styles.dismiss, color: 'default', variant: 'outlined' }

type Props = Omit<ButtonProps, 'danger' | 'type' | 'variant'> & {
  /** `link` for a Cancel or Dismiss set inline in text (an inspector's form, a notice): the same amber, no border. */
  type?: 'link'
}

const DismissButton = ({ className, type, ...props }: Props) => (
  <Button
    {...props}
    className={className ? `${styles.dismiss} ${className}` : styles.dismiss}
    // Not `type`: antd maps `type='link'` to its link colour, which the stylesheet does not re-point.
    color='default'
    variant={type === 'link' ? 'link' : 'outlined'}
  />
)

export default DismissButton
