import type { InputRef } from 'antd'
import { Alert, Button, Form, Input } from 'antd'
import { useEffect, useRef } from 'react'

import type { AuthModeType, LoginFormAlert, LoginFormType } from '../Login.types'

import styles from './LoginForm.module.css'

type LoginType = {
  method: AuthModeType
  onSubmit: (data: LoginFormType) => void
  isLoading: boolean
  /** A failed sign-in through THIS form, shown above its button. */
  alert?: LoginFormAlert
}

/*
 * The form's antd `name`, which antd prefixes to every field id (`<name>_username`) and so to every
 * label's `for`. It was the literal 'basic' on every form, so with two credential strategies stacked
 * (basic and an LDAPConfig, or two LDAPConfigs) the inputs shared ids and the second form's labels
 * pointed at the first form's inputs: clicking "Password" focused the wrong field, and assistive tech
 * announced the wrong association.
 *
 * Derived from the /strategies entry, so it is unique on the page and stable across renders: `kind`
 * tells basic from ldap, and `name` — the LDAPConfig's, absent for basic — tells two LDAPConfigs
 * apart. `_` joins them because a Kubernetes object name cannot contain one, so no two entries can
 * meet on the same string.
 */
const loginFormNameOf = ({ kind, name }: AuthModeType): string => (
  name ? `login_${kind}_${name}` : `login_${kind}`
)

const LoginForm = ({ alert, isLoading, method, onSubmit }: LoginType) => {
  const [form] = Form.useForm<LoginFormType>()
  const passwordRef = useRef<InputRef>(null)
  const handledAttempt = useRef<number | null>(null)

  /*
   * authn refused the credentials: keep the username, clear the password and put the cursor in it,
   * so the next try is one retype rather than two. Waits for the form to be enabled again — the
   * failure is recorded while the sign-in call is still pending, and a disabled input cannot take
   * focus — and handles each attempt once, so re-renders do not wipe what the person types next.
   */
  useEffect(() => {
    if (!alert?.retype || isLoading || handledAttempt.current === alert.attempt) { return }
    handledAttempt.current = alert.attempt
    form.setFieldValue('password', '')
    passwordRef.current?.focus()
  }, [alert, form, isLoading])

  return (
    <section className={styles.form}>
      <Form
        disabled={isLoading}
        form={form}
        layout='vertical'
        name={loginFormNameOf(method)}
        onFinish={onSubmit}
        requiredMark={false}
      >
        <Form.Item
          label='Username'
          name='username'
          rules={[{ message: 'Insert a username', required: true }]}
        >
          {/* `username` / `current-password` let a password manager fill the pair, and let the
              browser offer to save it. The form used to set autoComplete='off', which most
              managers ignore anyway and which only made the page harder to use. */}
          <Input autoComplete='username' size='large' />
        </Form.Item>

        <Form.Item
          label='Password'
          name='password'
          rules={[{ message: 'Insert a password', required: true }]}
        >
          <Input.Password autoComplete='current-password' ref={passwordRef} size='large' />
        </Form.Item>

        {alert && (
          <Alert
            className={styles.alert}
            description={(
              <>
                {alert.text}
                {alert.reason !== null && <> <code className={styles.reason}>{alert.reason}</code></>}
              </>
            )}
            message={alert.title}
            showIcon
            type='error'
          />
        )}

        <Form.Item>
          { method.kind === 'basic'
            ? (
              <Button className={styles.button} htmlType='submit' size='large' type='primary'>
                Sign in
              </Button>
            ) : (
              <Button
                className={styles.button}
                htmlType='submit'
                size='large'
                style={
                  method.graphics?.backgroundColor && method.graphics?.textColor
                    ? { backgroundColor: method.graphics.backgroundColor, color: method.graphics.textColor }
                    : undefined
                }
              >
                {method.graphics?.displayName || 'LDAP sign in'}
              </Button>
            )
          }
        </Form.Item>
      </Form>
    </section>
  )
}

export default LoginForm
