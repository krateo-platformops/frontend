import { Button, Form, Input } from 'antd'

import type { AuthModeType, LoginFormType } from '../Login.types'

import styles from './LoginForm.module.css'

type LoginType = {
  method: AuthModeType
  onSubmit: (data: LoginFormType) => void
  isLoading: boolean
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

const LoginForm = ({ isLoading, method, onSubmit }: LoginType) => {
  return (
    <section className={styles.form}>
      <Form
        autoComplete='off'
        disabled={isLoading}
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
          <Input size='large' />
        </Form.Item>

        <Form.Item
          label='Password'
          name='password'
          rules={[{ message: 'Insert a password', required: true }]}
        >
          <Input.Password size='large' />
        </Form.Item>

        <Form.Item>
          { method.kind === 'basic'
            ? (
              <Button className={styles.button} htmlType='submit' size='large' type='primary'>
                Sign In
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
                {method.graphics?.displayName || 'LDAP Sign In'}
              </Button>
            )
          }
        </Form.Item>
      </Form>
    </section>
  )
}

export default LoginForm
