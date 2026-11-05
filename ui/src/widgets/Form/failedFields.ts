import { createContext, useContext, useEffect, useState } from 'react'

import type { FieldPath } from './fieldDependencies'

/**
 * The fields the last submit failed on, as absolute paths. A new array per failure, so a section or
 * panel holding one opens even if it was the one that failed last time.
 */
export const FailedFieldsContext = createContext<FieldPath[] | null>(null)

/**
 * The open panels of an "Advanced" disclosure, opened by a failed submit. Its fields stay mounted
 * while it is collapsed, so they can fail validation while the person sees nothing wrong.
 */
export const useAdvancedPanels = (scope: FieldPath, required: Set<unknown>) => {
  const failed = useContext(FailedFieldsContext)
  const [open, setOpen] = useState<string[]>([])
  useEffect(() => {
    const inside = failed?.some((path) => path.length > scope.length
      && scope.every((part, index) => path[index] === part)
      && !required.has(String(path[scope.length])))
    if (inside) { setOpen(['advanced']) }
  }, [failed])
  return [open, setOpen] as const
}

/**
 * Every section of a sectioned form stays mounted, so a field in a hidden one fails validation out
 * of sight. Show the section holding the first error, or the submit looks like it did nothing.
 */
export const useShowFailedSection = (groups: string[], show: (section: string) => void, general: string) => {
  const failed = useContext(FailedFieldsContext)
  useEffect(() => {
    const first = failed?.[0]?.[0]
    if (first !== undefined) { show(groups.includes(String(first)) ? String(first) : general) }
  }, [failed])
}
