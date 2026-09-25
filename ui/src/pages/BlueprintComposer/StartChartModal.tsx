/**
 * "Start a chart" — mockup screen 2. Name the chart; the Kind follows.
 *
 * THE ONE FACT NOBODY GUESSES IS SHOWN AS IT IS TYPED. core-provider derives the generated Kind,
 * the API version every claim carries, and (with the install's owner) where the chart is
 * registered — all from the name and the version. They are a contract once published, so the
 * derivation is visible before Start rather than discovered after the first install. The rules are
 * `startChart`'s and `chartIdentity`'s, not restated here: a name this modal accepts is a name the
 * draft lint accepts on every later write.
 *
 * WHERE THE OWNER COMES FROM. The blueprint builder's publish target is install config
 * (`AUTOPILOT_BLUEPRINT_BUILDER_REPO`, `owner/repo`), resolved by the same `resolveBuilderTarget`
 * the publish form prefills from. With no owner configured the "Registered as" row is OMITTED —
 * an OCI location with an empty owner is not a location, and a guessed org is the defect the
 * builder-targets module exists to prevent.
 *
 * THE ANSWER IS THE PROVIDER'S. Start emits the files on the chart-start bus and the provider holds
 * them — or refuses, and says why. A refusal (a draft is already open, the tree is over the cap)
 * stays in this modal, where the person can act on it; anything else means the chart is held, and
 * the composer takes over.
 *
 * A REFUSAL IS HEARD, NOT ONLY SEEN. Each field names the text under it as its description and says
 * when it is invalid, and a refused Start moves focus to the first refused field — so a screen reader
 * announces the field and why, where red text alone announced nothing. (The Form.Items carry no
 * `name`, so antd wires none of this; it is done here.)
 *
 * ADVICE IS NOT A REFUSAL. A name that deploys everywhere but may not fit an install running CDC
 * metrics (chartIdentity's header) is warned about under the field, and Start still works.
 */
import { Alert, Form, Input, Modal, type InputRef } from 'antd'
import { useEffect, useId, useRef, useState } from 'react'

import type { DraftRenderResultDetail } from '../../components/Autopilot/previewDraftRender'

import styles from './BlueprintComposer.module.css'
import { claimApiVersion, compositionKind, ociChartLocation, startChart, startChartWarnings, validateStartChart, type StartChartInput } from './startChart'

export const DEFAULT_VERSION = '0.1.0'

export const StartChartModal = ({ onCancel, onStart, open, owner, pending, refusal }: {
  onCancel: () => void
  onStart: (files: Record<string, string>) => void
  open: boolean
  /** The blueprint builder target's owner from install config, or '' when none is configured. */
  owner: string
  /** A start is on the wire; its answer has not come back. */
  pending: boolean
  /** The provider's refusal of the last start, if it refused. */
  refusal: DraftRenderResultDetail | null
}) => {
  const [input, setInput] = useState<StartChartInput>({ description: '', name: '', version: DEFAULT_VERSION })
  // Problems show for a field once it holds something, or everywhere once Start was pressed — not
  // on an empty form that nobody has typed into yet.
  const [submitted, setSubmitted] = useState(false)
  // Labels bound to their inputs, so each field is found — and announced — by its name; and the text
  // under each field bound as its description, so it is announced with it.
  const ids = { description: useId(), name: useId(), nameHelp: useId(), version: useId(), versionHelp: useId() }
  const fields = { name: useRef<InputRef>(null), version: useRef<InputRef>(null) }
  // Each refused Start, counted: focus moves AFTER the render that shows the reasons, so the field
  // is announced with the reason, not with the help it replaced.
  const [refusedStarts, setRefusedStarts] = useState(0)

  const problems = validateStartChart(input)
  const problemFor = (field: keyof StartChartInput): string | undefined => {
    const shown = submitted || input[field].trim() !== ''
    return shown ? problems.find((problem) => problem.field === field)?.message : undefined
  }
  const set = (field: keyof StartChartInput) => (event: React.ChangeEvent<HTMLInputElement>) =>
    setInput((current) => ({ ...current, [field]: event.target.value }))

  const submit = () => {
    setSubmitted(true)
    const result = startChart(input)
    if (result.ok) {
      onStart(result.files)
      return
    }
    setRefusedStarts((count) => count + 1)
  }

  useEffect(() => {
    if (!refusedStarts) {
      return
    }
    const first = validateStartChart(input)[0]?.field
    if (first === 'name' || first === 'version') {
      fields[first].current?.focus()
    }
    // Only a new refused Start moves focus — not every keystroke after it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refusedStarts])

  const name = input.name.trim()
  const location = name ? ociChartLocation(owner, name) : null
  const nameProblem = problemFor('name')
  const versionProblem = problemFor('version')
  const nameWarning = !nameProblem && name ? startChartWarnings(input).find((warning) => warning.field === 'name')?.message : undefined
  let nameStatus: 'error' | 'warning' | undefined
  if (nameProblem) {
    nameStatus = 'error'
  } else if (nameWarning) {
    nameStatus = 'warning'
  }

  return (
    <Modal
      cancelText='Cancel'
      confirmLoading={pending}
      okText='Start'
      onCancel={onCancel}
      onOk={submit}
      open={open}
      title={(
        <div className={styles.modalHeading}>
          <span className={styles.eyebrow}>Start a chart</span>
          <span className={styles.modalTitle}>Name the chart; the Kind follows</span>
        </div>
      )}
      width={560}
    >
      <Form layout='vertical'>
        <Form.Item
          help={(
            <span id={ids.nameHelp}>
              {nameProblem ?? nameWarning ?? `Lower-case, dashes. It becomes the repository name${owner ? ` under ${owner}` : ''} and the OCI chart name.`}
            </span>
          )}
          htmlFor={ids.name}
          label='Chart name'
          required
          validateStatus={nameStatus}
        >
          <Input
            aria-describedby={ids.nameHelp}
            aria-invalid={nameProblem ? true : undefined}
            aria-required
            className={styles.mono}
            id={ids.name}
            onChange={set('name')}
            onPressEnter={submit}
            placeholder='builder-publish'
            ref={fields.name}
            value={input.name}
          />
        </Form.Item>
        <div className={styles.fieldRow}>
          <Form.Item
            help={versionProblem ? <span id={ids.versionHelp}>{versionProblem}</span> : undefined}
            htmlFor={ids.version}
            label='Version'
            required
            validateStatus={versionProblem ? 'error' : undefined}
          >
            <Input
              aria-describedby={versionProblem ? ids.versionHelp : undefined}
              aria-invalid={versionProblem ? true : undefined}
              aria-required
              className={styles.mono}
              id={ids.version}
              onChange={set('version')}
              onPressEnter={submit}
              ref={fields.version}
              value={input.version}
            />
          </Form.Item>
          <Form.Item htmlFor={ids.description} label='Description'>
            <Input id={ids.description} onChange={set('description')} onPressEnter={submit} placeholder='What a consumer gets when they install it' value={input.description} />
          </Form.Item>
        </div>
      </Form>
      <div className={styles.derivedList}>
        <span className={styles.eyebrow}>Derived — read before you commit to the name</span>
        <div className={styles.derived}>
          <span className={styles.derivedLabel}>Generated Kind</span>
          <span className={styles.derivedValue} data-testid='derived-kind'>{name ? compositionKind(name) : '—'}</span>
        </div>
        <div className={styles.derived}>
          <span className={styles.derivedLabel}>apiVersion of every claim</span>
          <span className={styles.derivedValue} data-testid='derived-api-version'>{input.version.trim() ? claimApiVersion(input.version) : '—'}</span>
        </div>
        {owner ? (
          <div className={styles.derived}>
            <span className={styles.derivedLabel}>Registered as</span>
            <span className={styles.derivedValue} data-testid='derived-oci'>{location ?? '—'}</span>
          </div>
        ) : null}
      </div>
      {refusal ? (
        <Alert
          description={refusal.problems?.length ? <ul>{refusal.problems.map((line) => <li key={line}>{line}</li>)}</ul> : undefined}
          showIcon
          title={refusal.message ?? 'The chart was not started.'}
          type='error'
        />
      ) : (
        <p className={styles.infoNote}>
          The draft is held in this browser until you publish. Nothing reaches the cluster before the change request.
        </p>
      )}
    </Modal>
  )
}

export default StartChartModal
