/**
 * Secret fields of a COMPOSABLE Form (`items` — child form-control widgets rather than a schema).
 *
 * A schema-driven Form knows its secret fields from the schema (utils/secretFields.ts). A
 * composable Form does not: its fields are separate widgets (an Input with `type: 'password'`),
 * fetched and rendered on their own. Each such child registers its field here, so the Form treats
 * it exactly like a schema secret — never drafted, masked in review, never sent to /jq.
 */
import { createContext, useContext, useEffect } from 'react'

import type { SecretPath } from '../../utils/secretFields'

export interface SecretFieldsRegistry {
  /** Register a secret field path; returns the unregister function. */
  register: (path: SecretPath) => () => void
}

export const SecretFieldsContext = createContext<SecretFieldsRegistry | null>(null)

/** Register `path` as secret with the enclosing Form for as long as the caller is mounted. */
export const useRegisterSecretField = (path: SecretPath | undefined): void => {
  const registry = useContext(SecretFieldsContext)
  const key = path ? JSON.stringify(path) : ''
  useEffect(() => {
    if (!registry || !key) {
      return undefined
    }
    return registry.register(JSON.parse(key) as SecretPath)
  }, [registry, key])
}
