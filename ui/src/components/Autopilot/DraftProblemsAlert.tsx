/**
 * Why the held draft cannot be published — shown where the draft is being looked at.
 *
 * A hand edit that makes a draft lint-dirty (a populated object default in values.schema.json,
 * a deleted Chart.yaml) is accepted into the held tree — the person's bytes are kept — and the
 * publish gate is disarmed for it. Without this the edit looked accepted and the next Publish
 * failed with "preview first", which is the wrong reason: previewing again would not help until
 * the file is fixed. The problems ride the held-draft broadcast; this renders them.
 *
 * Asks for a replay on mount, so a surface opened AFTER the draft went dirty still says why.
 */
import { Alert } from 'antd'
import { useEffect, useState } from 'react'

import { onDraftChanged, requestDraftReplay } from './previewDraftChanged'

export const DraftProblemsAlert = () => {
  const [problems, setProblems] = useState<string[]>([])

  useEffect(() => {
    const stop = onDraftChanged(({ problems: next }) => setProblems(next ?? []))
    requestDraftReplay()
    return stop
  }, [])

  if (!problems.length) {
    return null
  }
  return (
    <Alert
      description={<ul>{problems.map((line) => <li key={line}>{line}</li>)}</ul>}
      showIcon
      title='This draft cannot be published as it stands — fix these files, then preview again'
      type='error'
    />
  )
}
