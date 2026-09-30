/* eslint-disable no-template-curly-in-string -- the ${…} jq-override DSL is the subject under test */
import { describe, expect, it } from 'vitest'

import {
  evaluateLocalExpression,
  parseLocalExpression,
  planOverride,
  readsWholeForm,
  referencedSecretFields,
  SecretExpressionError,
} from './secretJq'

/* eslint-disable @stylistic/js/line-comment-position -- one-line reasons beside table rows */
const VALUES = {
  __secret_key__: 'password',
  __secret_value__: 'pw-value',
  password: 's3cr3t!',
  spec: { auth: { token: 'tok-123' }, size: 'm' },
  username: 'alice',
}

describe('local evaluator — accepted shapes', () => {
  it.each([
    ['${.json.password}', 's3cr3t!'],
    ['${ .json.password }', 's3cr3t!'],
    ['  ${   .json.username   }  ', 'alice'],
    ['${ .json.spec.auth.token }', 'tok-123'],
    ['${ .json.missing }', null],
    ['${ .json.missing.deeper }', null],
    ['${ { username: .json.username, password: .json.password } }', { password: 's3cr3t!', username: 'alice' }],
    ['${{username:.json.username,password:.json.password}}', { password: 's3cr3t!', username: 'alice' }],
    ['${ { "user name": .json.username, "pw": .json.password } }', { pw: 's3cr3t!', 'user name': 'alice' }],
    ['${ { token: .json.spec.auth.token } }', { token: 'tok-123' }],
    ['${ {} }', {}],
    // the portal's user-create stringData: key from a non-secret field, value from the secret
    ['${ {(.json.__secret_key__): .json.__secret_value__} }', { password: 'pw-value' }],
    ['${ { ( .json.__secret_key__ ) : .json.__secret_value__, username: .json.username } }', { password: 'pw-value', username: 'alice' }],
  ])('%s → %j', (expression, expected) => {
    const parsed = parseLocalExpression(expression)
    expect(parsed).not.toBeNull()
    expect(evaluateLocalExpression(parsed!, VALUES)).toEqual(expected)
  })
})

describe('local evaluator — denied shapes (anything else is not parsed)', () => {
  it.each([
    ['.json.password'], // not a ${} expression at all
    ['${ .json }'], // the whole form
    ['${ . }'],
    ['${ .json.password + "x" }'],
    ['${ .json.password | @base64 }'],
    ['${ .json["password"] }'],
    ['${ .json."password" }'],
    ['${ .json.password? }'],
    ['${ .json.password // "default" }'],
    ['${ .json .password }'],
    ['${ .json.users[0].password }'],
    ['${ .json.password, .json.username }'],
    ['${ { password } }'], // jq shorthand
    ['${ { (.json.k + "x"): .json.password } }'], // computed key that is not a plain path
    ['${ { (.json.k)?: .json.password } }'],
    ['${ { .json.k: .json.password } }'], // unparenthesised path key
    ['${ { (.json): .json.password } }'],
    ['${ { a: .json.password, b: "literal" } }'], // a literal value
    ['${ { a: .json.password, } }'], // trailing comma
    ['${ { "a,b": .json.password } }'], // comma in a quoted key
    ['${ { a: { b: .json.password } } }'], // nested object
    ['${ [ .json.password ] }'],
    ['${ "\\(.json.password)" }'], // string interpolation
    ['${ .other.password }'], // not the form
    ['${ .json.pass-word }'],
    ['$ { .json.password }'],
  ])('%s', (expression) => {
    expect(parseLocalExpression(expression)).toBeNull()
  })

  it('indexing a non-object is an error, as it is in jq', () => {
    const parsed = parseLocalExpression('${ .json.username.first }')!
    expect(() => evaluateLocalExpression(parsed, VALUES)).toThrow(/cannot index string/)
  })

  it('a computed key must resolve to a string, as in jq', () => {
    const missing = parseLocalExpression('${ { (.json.nope): .json.password } }')!
    expect(() => evaluateLocalExpression(missing, VALUES)).toThrow(/object keys must be strings/)
    const nonString = parseLocalExpression('${ { (.json.spec): .json.password } }')!
    expect(() => evaluateLocalExpression(nonString, VALUES)).toThrow(/object keys must be strings/)
  })
})

describe('referencedSecretFields / readsWholeForm', () => {
  const paths = [['password'], ['spec', 'auth', 'token']]
  it.each([
    ['${ .json.password }', ['password']],
    ['${ .json["password"] }', ['password']],
    ['${ .json."password" }', ['password']],
    ['${ .json | .password }', ['password']],
    ['${ .json.spec.auth.token }', ['spec.auth.token']],
    ['${ .json.password + .json.spec.auth.token }', ['password', 'spec.auth.token']],
    // mentions that are NOT a reference: a string literal, a longer name
    ['${ .json.username + "-password" }', []],
    ['${ { name: (.json.username + "-password"), key: "password" } }', []],
    ['${ .json.passwordHint }', []],
  ])('%s → %j', (expression, expected) => {
    expect(referencedSecretFields(expression, paths).map((path) => path.join('.'))).toEqual(expected)
  })

  it.each([
    ['${ .json }', true],
    ['${ .json | keys }', true],
    ['${ .json | tojson }', true],
    ['${ .json[] }', true],
    ['${ { spec: .json } }', true],
    ['${ .json.username }', false],
    ['${ .json["username"] }', false],
    ['${ .jsonish }', false],
  ])('readsWholeForm(%s) = %s', (expression, expected) => {
    expect(readsWholeForm(expression)).toBe(expected)
  })
})

describe('planOverride', () => {
  const secret = [['password']]

  it('a form with NO secret fields: /jq with the full values, exactly as before', () => {
    expect(planOverride('x', '${ .json | keys }', VALUES, [])).toEqual({ data: { json: VALUES }, mode: 'jq' })
  })

  it('an expression that does not touch a secret: /jq, with the secret removed', () => {
    const plan = planOverride('metadata.name', '${ .json.username + "-password" }', VALUES, secret)
    const { password: _password, ...withoutSecret } = VALUES
    expect(plan).toEqual({ data: { json: withoutSecret }, mode: 'jq' })
    expect(JSON.stringify(plan)).not.toContain('s3cr3t!')
  })

  it('a simple secret path: resolved locally', () => {
    expect(planOverride('stringData', '${ { username: .json.username, password: .json.password } }', VALUES, secret))
      .toEqual({ mode: 'local', touchesSecret: true, value: { password: 's3cr3t!', username: 'alice' } })
  })

  it('a secret in any other shape: refused, naming the field and the override', () => {
    expect(() => planOverride('stringData.password', '${ .json.password | @base64 }', VALUES, secret))
      .toThrow(SecretExpressionError)
    try {
      planOverride('stringData.password', '${ .json.password | @base64 }', VALUES, secret)
    } catch (error) {
      expect((error as SecretExpressionError).fields).toEqual(['password'])
      expect((error as Error).message).toContain('"password"')
      expect((error as Error).message).toContain('"stringData.password"')
      expect((error as Error).message).not.toContain('s3cr3t!')
    }
  })

  it('reading the whole form while it holds a secret: refused', () => {
    expect(() => planOverride('spec', '${ .json }', VALUES, secret)).toThrow(/reads the whole form/)
  })

  it('a local evaluation error is a refusal too', () => {
    expect(() => planOverride('x', '${ .json.password.inner }', VALUES, secret)).toThrow(SecretExpressionError)
  })

  it('the portal stringData shape: a non-secret computed key, a secret value — resolved locally', () => {
    const plan = planOverride('stringData', '${ {(.json.__secret_key__): .json.__secret_value__} }', VALUES, [['__secret_value__']])
    expect(plan).toEqual({ mode: 'local', touchesSecret: true, value: { password: 'pw-value' } })
  })

  it('a secret field is never allowed as a computed key', () => {
    expect(() => planOverride('stringData', '${ {(.json.password): .json.__secret_value__} }', VALUES, [['password'], ['__secret_value__']]))
      .toThrow(/as an object key, the secret field "password"/)
  })

  it('names a list-item secret readably', () => {
    expect(() => planOverride('x', '${ .json.users | map(.password) }', { users: [] }, [['users', '*', 'password']]))
      .toThrow('"users[].password"')
  })
})
