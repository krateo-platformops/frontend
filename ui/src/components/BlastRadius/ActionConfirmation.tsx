/**
 * ActionConfirmation — the write confirmation's body when the rest action carries its own words
 * (`confirmation` on a widget's actions.rest item, actions.schema.json).
 *
 * It is NOT a second dialog. The engine has one gate for every write (confirmModalProps.ts); a
 * page that built its own Modal for "Uninstall X?" would still meet that gate after it, so the
 * person would confirm twice, the second time in field names and YAML. Instead the action hands
 * the gate its words: this body shows the message and an optional Alert, and folds the gate's own
 * facts (BlastRadiusConfirm: verb, resource, cluster, namespace, the YAML it will send) under a
 * collapsed "What will be sent" — still one click away, never gone.
 *
 * Without a radius (a read-only action that opts into requireConfirmation) there is nothing that
 * will be sent, so there is no disclosure.
 */
import { Alert, Collapse, Tag } from 'antd'

import type { BlastRadius, BlastRadiusSet } from '../../hooks/blastRadius.types'
import type { RestActionConfirmation } from '../../types/Widget'

import styles from './ActionConfirmation.module.css'
import BlastRadiusConfirm from './BlastRadiusConfirm'

/** The disclosure's label: what the folded facts are, in the person's words. */
export const WHAT_WILL_BE_SENT = 'What will be sent'

type AlertItem = NonNullable<NonNullable<RestActionConfirmation['alert']>['items']>[number]

/**
 * One object the Alert names. A link opens in a NEW tab even for a page of this app: the link is
 * inside a pending decision, and a same-tab navigation would leave the dialog standing over a
 * different page, where confirming would still run this write.
 */
const AlertItemRow = ({ item }: { item: AlertItem }) => (
  <li className={styles.item}>
    {item.href ? <a href={item.href} rel='noopener noreferrer' target='_blank'>{item.label}</a> : <span>{item.label}</span>}
    {item.tag ? <Tag>{item.tag}</Tag> : null}
  </li>
)

export interface ActionConfirmationProps {
  confirmation: RestActionConfirmation
  radius?: BlastRadius | BlastRadiusSet
}

const ActionConfirmation = ({ confirmation, radius }: ActionConfirmationProps) => {
  const { alert, message } = confirmation
  const items = alert?.items ?? []

  return (
    <div className={styles.root} data-testid='action-confirmation'>
      {message ? <p className={styles.message}>{message}</p> : null}
      {alert ? (
        <Alert
          data-testid='action-confirmation-alert'
          description={items.length > 0 ? (
            <ul className={styles.items}>
              {items.map((item, index) => <AlertItemRow item={item} key={`${item.label}-${index}`} />)}
            </ul>
          ) : undefined}
          showIcon
          title={alert.message}
          type={alert.type}
        />
      ) : null}
      {radius ? (
        <Collapse
          ghost
          items={[{ children: <BlastRadiusConfirm radius={radius} />, key: 'sent', label: WHAT_WILL_BE_SENT }]}
          size='small'
        />
      ) : null}
    </div>
  )
}

export default ActionConfirmation
