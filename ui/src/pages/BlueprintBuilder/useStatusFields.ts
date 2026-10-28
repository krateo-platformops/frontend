/**
 * A node's status schema, read as the person — the Ready when picker's input (screen 6).
 *
 * Through the composer's per-mount CRD cache (useCrdSchema), so a target read for placing is not
 * read again for its readiness, and a denial is said once. Keyed by the CRD's name: a picker that
 * moves to another node answers for that node, and an answer that lands for one it has left is
 * dropped. A native kind reads nothing — its readiness is the kind's own.
 */
import { useEffect, useMemo, useState } from 'react'

import type { ResourceNode } from './architecture'
import type { PaletteRead } from './blueprintPalette'
import { extractCrdStatusFields } from './crdStatusFields'
import { crdOf, crdReadSentence, type StatusRead } from './readinessOptions'
import type { CrdRead } from './useCrdSchema'

export const useStatusFields = (
  node: Pick<ResourceNode, 'apiVersion' | 'class' | 'kind'> | null,
  palette: PaletteRead | null,
  read: (name: string) => Promise<CrdRead>,
): StatusRead => {
  const crd = useMemo(() => (node ? crdOf(node, palette) : null), [node, palette])
  const name = crd && 'name' in crd ? crd.name : null
  const version = crd && 'name' in crd ? crd.version : undefined
  const [answer, setAnswer] = useState<{ name: string; read: StatusRead } | null>(null)

  useEffect(() => {
    if (name === null) { return undefined }
    let live = true
    void read(name).then((result) => {
      if (!live) { return }
      if ('error' in result) {
        setAnswer({ name, read: { sentence: crdReadSentence(name, result.error), state: 'unavailable' } })
        return
      }
      const fields = extractCrdStatusFields(result.crd, version)
      setAnswer({ name, read: fields ? { fields, state: 'ok' } : { fields: { conditions: false, fields: [] }, state: 'ok' } })
    })
    return () => { live = false }
  }, [name, read, version])

  if (!crd) { return { state: 'none' } }
  if ('pending' in crd) { return { state: 'loading' } }
  if ('missing' in crd) { return { sentence: crd.missing, state: 'unavailable' } }
  return answer?.name === crd.name ? answer.read : { state: 'loading' }
}
