import { Form as AntdForm } from 'antd'
import type { JSONSchema4 } from 'json-schema'

import type { FieldPath } from './fieldDependencies'
import { VISIBLE_WHEN_KEY } from './fieldKeys'
import { isVisible } from './visibleWhen'

/**
 * The keys of `properties` a `displayingDependencies` entry hides for the current values. A selector
 * watch, so the fields re-render only when that set changes, not on every keystroke.
 */
export const useHiddenKeys = (properties: Record<string, JSONSchema4> | undefined, scope: FieldPath): string[] => {
  const form = AntdForm.useFormInstance()
  const conditional = Object.entries(properties ?? {}).filter(([, node]) => node[VISIBLE_WHEN_KEY] !== undefined)
  const hidden = AntdForm.useWatch(
    (values: unknown) => conditional.filter(([, node]) => !isVisible(node, values, scope)).map(([key]) => key),
    { form, preserve: true },
  ) as string[] | undefined
  return hidden ?? []
}
