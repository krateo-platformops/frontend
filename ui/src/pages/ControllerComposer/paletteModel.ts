/**
 * T7 — the controller palette as the pane draws it: the imported spec's operations, grouped by
 * resource group (the first path segment, so /pet, /pet/{petId} and /pet/findByStatus read as one
 * `pet` group). Pure.
 *
 * THE FILTER matches a path, a method, an operationId or a summary. A group whose NAME matches
 * shows all its operations (the resource is what was asked for); otherwise only the ones that match.
 *
 * ORDER is the document's order within a group — a spec author already put the collection before
 * the item — and the groups are alphabetical.
 */
import type { OasOperation } from './oasImport'

export interface ControllerPaletteGroup {
  group: string
  /** Every operation in the group — what its pill counts. */
  total: number
  /** The operations the filter keeps. */
  operations: OasOperation[]
}

export interface ControllerPaletteModel {
  groups: ControllerPaletteGroup[]
  /** Every operation in the document. */
  operations: number
  /** The filter, trimmed — empty when there is none. */
  filter: string
  /** A filter is set and no operation matches it. */
  nothingMatches: boolean
}

const matches = (operation: OasOperation, needle: string): boolean =>
  [operation.path, operation.method, operation.operationId ?? '', operation.summary ?? '']
    .some((text) => text.toLowerCase().includes(needle))

/** Group operations by resource group, filtered. */
export const buildControllerPalette = (operations: readonly OasOperation[], filter = ''): ControllerPaletteModel => {
  const needle = filter.trim().toLowerCase()
  const byGroup = new Map<string, OasOperation[]>()
  for (const operation of operations) {
    byGroup.set(operation.group, [...(byGroup.get(operation.group) ?? []), operation])
  }
  const groups: ControllerPaletteGroup[] = [...byGroup.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([group, members]) => ({
      group,
      operations: !needle || group.toLowerCase().includes(needle) ? members : members.filter((operation) => matches(operation, needle)),
      total: members.length,
    }))
    .filter((group) => !needle || group.operations.length > 0)
  return {
    filter: filter.trim(),
    groups,
    nothingMatches: needle.length > 0 && groups.length === 0,
    operations: operations.length,
  }
}

/** The operations of one resource group (what "map this group as a Kind" starts from). */
export const operationsInGroup = (operations: readonly OasOperation[], group: string): OasOperation[] =>
  operations.filter((operation) => operation.group === group)
