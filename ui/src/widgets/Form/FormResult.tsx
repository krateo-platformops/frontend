import type { IconProp } from '@fortawesome/fontawesome-svg-core'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { Button, Result, Typography } from 'antd'
import { useNavigate } from 'react-router'

import { safeHref } from './checkboxField'
import styles from './Form.module.css'
import { interpolate, type InterpolationVars } from './postOutcome'

/**
 * A `result` of a Form's `submitPost` response or `fieldChecks` answer: an antd Result that
 * REPLACES the form, its action bar included — a request filed, a link that is dead.
 *
 * `extra` holds its actions: a `button` (antd primary Button) or a `link` (a plain link, after an
 * optional `text`, e.g. "Already have an account?" + "Sign in"). An href must be http(s), mailto or
 * a path on the portal (#716's `safeHref`); any other drops that action. A path navigates inside
 * the app.
 */
export interface ResultSpec {
  status: 'success' | 'info' | 'warning' | 'error'
  title: string
  subtitle?: string
  icon?: string
  extra?: Array<{ kind: 'button' | 'link'; label: string; href: string; text?: string }>
}

/** The result with every CR string interpolated — plain text, ready to render. */
export const resolveResult = (spec: ResultSpec, vars: InterpolationVars): ResultSpec => ({
  ...spec,
  extra: spec.extra?.map((action) => ({ ...action, label: interpolate(action.label, vars), text: action.text === undefined ? undefined : interpolate(action.text, vars) })),
  subtitle: spec.subtitle === undefined ? undefined : interpolate(spec.subtitle, vars),
  title: interpolate(spec.title, vars),
})

const RESULT_STATUSES = new Set(['success', 'info', 'warning', 'error'])

export const FormResult = ({ result }: { result: ResultSpec }): React.ReactNode => {
  const navigate = useNavigate()
  const go = (href: string) => (event: React.MouseEvent) => {
    if (!href.startsWith('/')) { return }
    event.preventDefault()
    void navigate(href)
  }
  const actions = (result.extra ?? []).flatMap((action, index) => {
    const href = safeHref(action.href)
    if (!href) { return [] }
    if (action.kind === 'button') {
      return [<Button href={href} key={index} onClick={go(href)} type='primary'>{action.label}</Button>]
    }
    return [(
      <Typography.Paragraph className={styles.resultLink} key={index}>
        {action.text ? `${action.text} ` : null}
        <Typography.Link href={href} onClick={go(href)}>{action.label}</Typography.Link>
      </Typography.Paragraph>
    )]
  })
  return (
    <div className={styles.result}>
      <Result
        extra={actions.length ? actions : undefined}
        icon={result.icon ? <FontAwesomeIcon icon={result.icon as IconProp} /> : undefined}
        status={RESULT_STATUSES.has(result.status) ? result.status : 'info'}
        subTitle={result.subtitle}
        title={result.title}
      />
    </div>
  )
}
