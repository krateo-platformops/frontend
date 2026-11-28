import { Button, type ButtonProps } from 'antd'

/**
 * C26 — BUTTON ROLES. A button says what it does to the work in front of you:
 *
 *   - DISMISS: it closes or backs out — Cancel, Close, Close draft, Keep editing. Nothing stored is
 *     deleted. The neutral default outline, the look of Reset, Discard and Reject: never primary,
 *     never amber (amber is for real warnings). This component, or `dismissButtonProps` where antd
 *     builds the button itself (a Popconfirm's or a Modal's `cancelButtonProps`). Amber until
 *     2026-11-25: the safest button on a form looked like a caution (UX audit COL-2).
 *   - DESTROY: it deletes content — Discard a draft, Remove, Delete. Red: antd's own `danger`.
 *   - Everything else keeps its place in the primary / secondary hierarchy (P6).
 *
 * src/test/buttonRoles.test.ts holds the app to it; the composition lint's `button-role` rule holds
 * the chart's Button CRs (`intent: dismiss`, `danger: true`).
 */
export const dismissButtonProps: ButtonProps = { color: 'default', variant: 'outlined' }

type Props = Omit<ButtonProps, 'danger' | 'type' | 'variant'> & {
  /** `link` for a Cancel or Dismiss set inline in text (an inspector's form, a notice): the same neutral ink, no border. */
  type?: 'link'
}

const DismissButton = ({ type, ...props }: Props) => (
  <Button
    {...props}
    // Not `type`: antd maps `type='link'` to its link colour, and a dismissal is not a link.
    color='default'
    variant={type === 'link' ? 'link' : 'outlined'}
  />
)

export default DismissButton
