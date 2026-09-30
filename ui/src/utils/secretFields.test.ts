import type { JSONSchema4 } from 'json-schema'
import { describe, expect, it } from 'vitest'

/* eslint-disable @stylistic/js/line-comment-position -- one-line reasons beside table rows */
import {
  isSecretSchemaNode,
  maskSecretMaterialForDisplay,
  maskSecretPaths,
  omitSecretPaths,
  SECRET_MASK,
  secretFieldPaths,
  stripSecretMaterial,
} from './secretFields'

describe('isSecretSchemaNode — the schema keys honoured', () => {
  it.each([
    [{ format: 'password', type: 'string' }, true],
    [{ type: 'string', writeOnly: true }, true],
    [{ format: 'password' }, true], // untyped
    [{ writeOnly: true }, true],
    [{ type: 'string' }, false],
    [{ format: 'email', type: 'string' }, false],
    [{ type: 'string', writeOnly: false }, false],
    [{ type: 'string', writeOnly: 'true' }, false],
    [{ format: 'password', type: 'object' }, false], // no single value to mask
    [{ type: 'integer', writeOnly: true }, false],
  ])('%j → %s', (node, expected) => {
    expect(isSecretSchemaNode(node as JSONSchema4)).toBe(expected)
  })
})

const SCHEMA: JSONSchema4 = {
  properties: {
    password: { format: 'password', type: 'string' },
    spec: {
      properties: { auth: { properties: { token: { type: 'string', writeOnly: true } }, type: 'object' }, size: { type: 'string' } },
      type: 'object',
    },
    username: { type: 'string' },
    users: { items: { properties: { name: { type: 'string' }, pin: { format: 'password', type: 'string' } }, type: 'object' }, type: 'array' },
  },
  type: 'object',
}
const PATHS = [['password'], ['spec', 'auth', 'token'], ['users', '*', 'pin']]

describe('secretFieldPaths', () => {
  it('finds top-level, nested and list-item secrets', () => {
    expect(secretFieldPaths(SCHEMA)).toEqual(PATHS)
  })
  it('is empty for no schema / no secrets', () => {
    expect(secretFieldPaths(undefined)).toEqual([])
    expect(secretFieldPaths({ properties: { a: { type: 'string' } }, type: 'object' })).toEqual([])
  })
})

const VALUES = {
  password: 'p',
  spec: { auth: { token: 't' }, size: 'm' },
  username: 'alice',
  users: [{ name: 'a', pin: '1' }, { name: 'b', pin: '2' }],
}

describe('omitSecretPaths / maskSecretPaths', () => {
  it('omits every secret and nothing else, without mutating the input', () => {
    const before = JSON.stringify(VALUES)
    expect(omitSecretPaths(VALUES, PATHS)).toEqual({
      spec: { auth: {}, size: 'm' },
      username: 'alice',
      users: [{ name: 'a' }, { name: 'b' }],
    })
    expect(JSON.stringify(VALUES)).toBe(before)
  })

  it('treats a lone object as a list item (a fan-out element)', () => {
    expect(omitSecretPaths({ users: { name: 'a', pin: '1' } }, PATHS)).toEqual({ users: { name: 'a' } })
  })

  it('masks non-empty secrets and leaves empty ones empty', () => {
    expect(maskSecretPaths({ ...VALUES, users: [{ name: 'a', pin: '' }] }, PATHS)).toEqual({
      password: SECRET_MASK,
      spec: { auth: { token: SECRET_MASK }, size: 'm' },
      username: 'alice',
      users: [{ name: 'a', pin: '' }],
    })
  })
})

describe('maskSecretMaterialForDisplay (the confirm dialog)', () => {
  it('masks a Secret body\'s data/stringData values, keeping the keys', () => {
    const secret = { apiVersion: 'v1', data: { token: 'dG9r' }, kind: 'Secret', metadata: { name: 'alice-password' }, stringData: { password: 'hunter2', username: 'alice' } }
    expect(maskSecretMaterialForDisplay(secret)).toEqual({
      apiVersion: 'v1',
      data: { token: SECRET_MASK },
      kind: 'Secret',
      metadata: { name: 'alice-password' },
      stringData: { password: SECRET_MASK, username: SECRET_MASK },
    })
    // the body that is actually sent is untouched
    expect(secret.stringData.password).toBe('hunter2')
  })

  it('masks values resolved from a secret field in any kind, by override path', () => {
    const body = { kind: 'Database', metadata: { name: 'db' }, spec: { auth: { password: 'hunter2' }, size: 'm' } }
    expect(maskSecretMaterialForDisplay(body, ['spec.auth.password'])).toEqual({
      kind: 'Database', metadata: { name: 'db' }, spec: { auth: { password: SECRET_MASK }, size: 'm' },
    })
    expect(body.spec.auth.password).toBe('hunter2')
  })

  it('returns a non-secret body as-is', () => {
    const body = { data: { a: 'b' }, kind: 'ConfigMap' }
    expect(maskSecretMaterialForDisplay(body)).toBe(body)
  })
})

describe('stripSecretMaterial', () => {
  it('drops data and stringData from a Secret', () => {
    expect(stripSecretMaterial({ data: { password: 'cA==' }, kind: 'Secret', metadata: { name: 's' }, stringData: { a: 'b' }, type: 'Opaque' }))
      .toEqual({ kind: 'Secret', metadata: { name: 's' }, type: 'Opaque' })
  })
  it('drops them from every Secret in a list', () => {
    expect(stripSecretMaterial({ items: [{ data: { a: 'b' }, kind: 'Secret' }, { data: { a: 'b' }, kind: 'ConfigMap' }], kind: 'SecretList' }))
      .toEqual({ items: [{ kind: 'Secret' }, { data: { a: 'b' }, kind: 'ConfigMap' }], kind: 'SecretList' })
  })
  it('leaves everything else alone', () => {
    const configMap = { data: { a: 'b' }, kind: 'ConfigMap' }
    expect(stripSecretMaterial(configMap)).toBe(configMap)
    expect(stripSecretMaterial(null)).toBeNull()
  })
})
