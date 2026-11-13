import { Form as AntdForm } from 'antd'
import type { FormItemProps } from 'antd'
import type { Rule } from 'antd/es/form'
import type { JSONSchema4 } from 'json-schema'
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'

import type { AllowlistedPost } from '../../transport/allowlistedPost'

import type { FieldPath } from './fieldDependencies'
import { CHECK_KEY } from './fieldKeys'
import { resolveResult, type ResultSpec } from './FormResult'
import { firstMatch, interpolate, pickBodyExtras, type PostOutcome, type PostWhen, sendPost, valueAt } from './postOutcome'

/**
 * A field CHECKED against a same-origin endpoint while it is typed — a `fieldChecks` entry of
 * widgetData, written on the field's node by fieldConfig.ts:
 *
 * ```yaml
 * fieldChecks:
 *   - name: username
 *     path: /request-access/api/v1/username-checks   # through the transport's allow-listed post
 *     bodyExtras: { submission: s, token: t }         # page fragment keys, sent in the body
 *     answers:
 *       - { when: { status: [200], bodyField: status, equals: [available] }, validateStatus: success, message: "{value} is available." }
 *       - { when: { status: [429] }, validateStatus: warning, message: Wait a moment., retryAfterMessage: "Try again in {retryAfter}." }
 *     otherwise: { validateStatus: warning, message: "We couldn't check that name right now." }
 * ```
 *
 * WHEN. After typing pauses (`debounceMs`, 500 by default) and at once on blur. Not for an empty
 * value, nor one that fails the field's own rules, nor one that already has a definitive answer or
 * a check in flight. A new value ABORTS the check in flight, and an answer is applied only while it
 * is still for the field's current value, so a slow answer for an old value never lands. The client
 * timeout is `timeoutMs` (10 s by default); a timeout, like a network error, is `otherwise`.
 *
 * HOW IT SHOWS. As antd's own validation of the field: an `error` answer is a rule that fails (it
 * blocks submit), a `warning` one a `warningOnly` rule (it does not), a `success` one the success
 * status with its message as the help. While the check runs the rules wait on it, so antd shows its
 * validating spinner — and a submit meanwhile waits for that answer instead of starting another.
 * `success` and `error` answers are remembered for their value; a `warning` (a rate limit, a backend
 * that could not answer) is shown but checked again on the next blur.
 *
 * An answer with a `result` replaces the whole form with it (a link found to be dead).
 */
export interface CheckAnswerSpec {
  when?: PostWhen
  validateStatus?: 'success' | 'warning' | 'error'
  message?: string
  retryAfterMessage?: string
  ruleFrom?: string
  ruleMessages?: Record<string, string>
  result?: ResultSpec
}

export interface FieldCheckSpec {
  path: string
  bodyKey: string
  bodyExtras?: Record<string, string>
  debounceMs?: number
  timeoutMs?: number
  answers: CheckAnswerSpec[]
  otherwise?: CheckAnswerSpec
}

export const DEFAULT_DEBOUNCE_MS = 500

/** What a check can do to the field: a status and its message. */
export interface CheckAnswer {
  validateStatus: 'success' | 'warning' | 'error'
  message: string
}

export const DEFAULT_CHECK_ANSWER: CheckAnswer = { message: "We couldn't check this right now.", validateStatus: 'warning' }

/** What the Form hands its checked fields: the transport's post, the page's extras, and where a result goes. */
export interface FieldCheckEnv {
  post?: AllowlistedPost
  extras: Readonly<Record<string, string>>
  onResult: (result: ResultSpec) => void
}

export const FieldCheckContext = createContext<FieldCheckEnv>({ extras: {}, onResult: () => undefined })

export const getFieldCheckSpec = (node: JSONSchema4): FieldCheckSpec | undefined => {
  const raw: unknown = node[CHECK_KEY]
  return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as FieldCheckSpec : undefined
}

/** The message an answer entry shows: a rule's own, else the Retry-After variant, else its message. */
const answerMessage = (entry: CheckAnswerSpec, outcome: PostOutcome, value: string): string => {
  const answered = outcome.kind === 'answer' ? outcome : undefined
  const vars = { body: answered?.body, retryAfter: answered?.retryAfter, value }
  const rule = entry.ruleFrom && answered ? valueAt(answered.body, entry.ruleFrom) : undefined
  if (typeof rule === 'string' && entry.ruleMessages?.[rule]) { return interpolate(entry.ruleMessages[rule], vars) }
  if (answered?.retryAfter !== undefined && entry.retryAfterMessage) { return interpolate(entry.retryAfterMessage, vars) }
  return interpolate(entry.message ?? '', vars)
}

/**
 * What a check's outcome means for the field: an answer, a result for the whole form, or nothing
 * (aborted; a refused path, which is the chart's mistake and is reported in the console).
 */
export const mapCheckOutcome = (spec: FieldCheckSpec, outcome: PostOutcome, value: string): { answer: CheckAnswer } | { result: ResultSpec } | undefined => {
  if (outcome.kind === 'aborted') { return undefined }
  if (outcome.kind === 'refused') {
    console.error(`The check of this field cannot be sent: ${outcome.reason}`)
    return undefined
  }
  const entry = firstMatch(spec.answers, outcome) ?? spec.otherwise
  if (!entry) { return { answer: DEFAULT_CHECK_ANSWER } }
  const answered = outcome.kind === 'answer' ? outcome : undefined
  if (entry.result) { return { result: resolveResult(entry.result, { body: answered?.body, retryAfter: answered?.retryAfter, value }) } }
  return { answer: { message: answerMessage(entry, outcome, value), validateStatus: entry.validateStatus ?? 'warning' } }
}

interface InFlight {
  value: string
  promise: Promise<CheckAnswer | undefined>
  controller: AbortController
}

/** The check of one field: when to send, what came back, and the rules that show it. */
const useFieldCheck = (spec: FieldCheckSpec, path: FieldPath) => {
  const form = AntdForm.useFormInstance()
  const env = useContext(FieldCheckContext)
  const envRef = useRef(env)
  envRef.current = env
  const answers = useRef(new Map<string, CheckAnswer>())
  const transient = useRef<{ value: string; answer: CheckAnswer } | null>(null)
  const inFlight = useRef<InFlight | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const mounted = useRef(true)
  // The answer on show, for the success help (antd draws the error and warning messages itself).
  const [shown, setShown] = useState<{ value: string; answer: CheckAnswer } | null>(null)
  const value: unknown = AntdForm.useWatch(path, form)

  const answerFor = useCallback(async (current: unknown): Promise<CheckAnswer | undefined> => {
    if (typeof current !== 'string') { return undefined }
    const pending = inFlight.current
    if (pending && pending.value === current) { return pending.promise }
    if (transient.current?.value === current) { return transient.current.answer }
    return answers.current.get(current)
  }, [])

  const run = useCallback(async (candidate: string) => {
    if (timer.current) {
      clearTimeout(timer.current)
      timer.current = null
    }
    if (!mounted.current || candidate === '' || form.getFieldValue(path) !== candidate) { return }
    if (answers.current.has(candidate) || inFlight.current?.value === candidate) { return }
    // The field's own rules first: a value they refuse is not worth a request.
    const locallyValid = await form.validateFields([path]).then(() => true, () => false)
    if (!locallyValid || !mounted.current || form.getFieldValue(path) !== candidate || inFlight.current?.value === candidate) { return }
    inFlight.current?.controller.abort()
    const controller = new AbortController()
    const { extras, post } = envRef.current
    const body = { [spec.bodyKey]: candidate, ...pickBodyExtras(spec.bodyExtras, extras) }
    const promise = sendPost(post, spec.path, body, { signal: controller.signal, timeoutMs: spec.timeoutMs }).then((outcome) => {
      const isCurrent = inFlight.current?.controller === controller
      if (isCurrent) { inFlight.current = null }
      const mapped = mapCheckOutcome(spec, outcome, candidate)
      // Superseded or gone: nothing of this answer is applied.
      if (!isCurrent || !mounted.current || !mapped) { return undefined }
      if ('result' in mapped) {
        envRef.current.onResult(mapped.result)
        return undefined
      }
      if (mapped.answer.validateStatus === 'warning') {
        transient.current = { answer: mapped.answer, value: candidate }
      } else {
        answers.current.set(candidate, mapped.answer)
      }
      if (form.getFieldValue(path) === candidate) { setShown({ answer: mapped.answer, value: candidate }) }
      return mapped.answer
    })
    inFlight.current = { controller, promise, value: candidate }
    transient.current = null
    // Validate again now that the rules have a check to wait on: antd shows its spinner, then the answer.
    void form.validateFields([path]).catch(() => undefined)
  }, [form, path, spec])

  // A new value: whatever was in flight for another value is cancelled, and the pause starts over.
  useEffect(() => {
    if (timer.current) {
      clearTimeout(timer.current)
      timer.current = null
    }
    if (inFlight.current && inFlight.current.value !== value) {
      inFlight.current.controller.abort()
      inFlight.current = null
    }
    if (typeof value !== 'string' || value === '' || answers.current.has(value)) { return }
    const candidate = value
    timer.current = setTimeout(() => { void run(candidate) }, spec.debounceMs ?? DEFAULT_DEBOUNCE_MS)
  }, [run, spec.debounceMs, value])

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      if (timer.current) { clearTimeout(timer.current) }
      inFlight.current?.controller.abort()
    }
  }, [])

  const onBlur = useCallback(() => {
    const current: unknown = form.getFieldValue(path)
    if (typeof current !== 'string' || current === '') { return }
    if (transient.current?.value === current) { transient.current = null }
    void run(current)
  }, [form, path, run])

  const rules = useMemo<Rule[]>(() => [
    {
      validator: async (_rule, current: unknown) => {
        const answer = await answerFor(current)
        if (answer?.validateStatus === 'error') { throw new Error(answer.message) }
      },
    },
    {
      validator: async (_rule, current: unknown) => {
        const answer = await answerFor(current)
        if (answer?.validateStatus === 'warning') { throw new Error(answer.message) }
      },
      warningOnly: true,
    },
  ], [answerFor])

  const success = shown && shown.value === value && shown.answer.validateStatus === 'success' ? shown.answer : undefined
  return { onBlur, rules, success }
}

/**
 * A schema field with a `fieldChecks` entry: its Form.Item, with the check's rules after its own,
 * antd's feedback icons on, and the success message as its help while it holds.
 */
export const CheckedFieldItem = ({ item, path, spec }: { item: FormItemProps; path: FieldPath; spec: FieldCheckSpec }): React.ReactNode => {
  const { onBlur, rules, success } = useFieldCheck(spec, path)
  const allRules = useMemo(() => [...(item.rules ?? []), ...rules], [item.rules, rules])
  return (
    <div onBlur={onBlur}>
      <AntdForm.Item
        {...item}
        hasFeedback
        help={success ? success.message : item.help}
        rules={allRules}
        validateStatus={success ? 'success' : item.validateStatus}
      />
    </div>
  )
}
