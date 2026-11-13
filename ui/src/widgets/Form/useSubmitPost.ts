import type { FormInstance } from 'antd'
import { useEffect, useMemo, useRef, useState } from 'react'

import { useFragmentExtras } from '../../context/PageRootContext'
import { useWidgetTransport } from '../../transport/widgetTransport'

import type { FieldCheckEnv } from './fieldCheck'
import type { ResultSpec } from './FormResult'
import { pickBodyExtras, sendPost } from './postOutcome'
import { mapSubmitOutcome, type ShownAlert, type SubmitPostSpec } from './submitPost'

/**
 * A Form's `submitPost` and what its `fieldChecks` need: the allow-listed post of the transport in
 * scope (token-less on both, transport/allowlistedPost.ts), the page's fragment extras a CR may send
 * in a body, and what an answer put on screen — a Result instead of the form, an inline Alert above
 * the buttons. While a submit is in flight `posting` is true (the form disabled, the button loading)
 * and a second one is ignored; unmounting aborts it. `values` are JSON-ready (dates as ISO strings).
 */
export const useSubmitPost = (form: FormInstance) => {
  const { post } = useWidgetTransport()
  const extras = useFragmentExtras()
  const [result, setResult] = useState<ResultSpec | null>(null)
  const [alert, setAlert] = useState<ShownAlert | null>(null)
  const [posting, setPosting] = useState(false)
  const inFlight = useRef<AbortController | null>(null)
  useEffect(() => () => { inFlight.current?.abort() }, [])
  const checkEnv = useMemo<FieldCheckEnv>(() => ({ extras, onResult: setResult, post }), [extras, post])

  const submit = async (spec: SubmitPostSpec, values: Record<string, unknown>) => {
    if (inFlight.current) { return }
    const controller = new AbortController()
    inFlight.current = controller
    setPosting(true)
    setAlert(null)
    // The page's extras win over a field of the same name: they are what the link carried.
    const body = { ...values, ...pickBodyExtras(spec.bodyExtras, extras) }
    const outcome = await sendPost(post, spec.path, body, { signal: controller.signal, timeoutMs: spec.timeoutMs })
    // Unmounted meanwhile: nothing to show, and no one to show it to.
    if (outcome.kind === 'aborted') { return }
    // Nothing else sets it while this submit holds it (a second submit returns at the guard above),
    // so releasing it after the await cannot overwrite another submit's controller.
    // eslint-disable-next-line require-atomic-updates
    inFlight.current = null
    setPosting(false)
    const effect = mapSubmitOutcome(spec, outcome)
    if (effect.kind === 'result') { setResult(effect.result) }
    if (effect.kind === 'alert') { setAlert(effect.alert) }
    if (effect.kind === 'fieldErrors') {
      // Only the fields this form has; a response naming none of them is told as an Alert.
      const registered = new Set(form.getFieldsError().map(({ name }) => name.join('.')))
      const known = effect.errors.filter(({ name }) => registered.has(name))
      if (known.length) {
        form.setFields(known.map(({ message, name }) => ({ errors: [message], name: name.split('.') })))
      } else {
        setAlert(effect.fallback)
      }
    }
  }

  return { alert, checkEnv, posting, result, submit }
}
