// @vitest-environment jsdom
/**
 * The inspector's note for a path parameter read from status that a PUBLISHED Kind's spec still asks
 * for: excludedSpecFields is locked, so the Kind says why petId is asked for instead of offering a fix.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { planPlaceGroup, readController, restDefinitionPath } from './controllerChart'
import { startController } from './controllerStart'
import { KindInspector } from './KindInspector'

const NOTE = 'petId is asked for on create because this controller was published before it was excluded; excluding it needs the RestDefinition recreated.'
const PET = restDefinitionPath('Pet')

const placedPet = (): Record<string, string> => {
  const started = startController({
    apiGroup: 'petstore.example.io',
    baseUrl: 'https://petstore3.swagger.io/api/v3',
    name: 'petstore',
    paths: null,
    spec: readFileSync(join(__dirname, '__fixtures__', 'petstore-v3.openapi.json'), 'utf8'),
  })
  if (!started.ok) { throw new Error(JSON.stringify(started.problems)) }
  const plan = planPlaceGroup(started.files, 'pet')
  if (!plan.ok) { throw new Error(plan.reason) }
  return { ...started.files, ...plan.add }
}

const inspect = (files: Record<string, string>, locked: boolean) => {
  const model = readController(files)
  const noop = () => undefined
  render(
    <KindInspector
      kind={model.kinds[0]}
      locked={locked ? {} : null}
      model={model}
      onBindPathParam={noop}
      onClear={noop}
      onCompareScope={noop}
      onDismissRefusal={noop}
      onOpenFile={noop}
      onRemove={noop}
      onSetItemsPath={noop}
      onSetVerb={noop}
      onToggleConfigurationField={noop}
      onToggleField={noop}
      refusal={null}
    />,
  )
}

afterEach(cleanup)

describe('Excluded from spec — a path parameter read from status', () => {
  it('a Kind published before {petId} was excluded says why petId is asked for on create', () => {
    const placed = placedPet()
    inspect({ ...placed, [PET]: placed[PET].replace('      - petId\n', '') }, true)
    expect(screen.getByText(NOTE)).toBeTruthy()
  })

  it('excluded (as placed), or not yet published, there is no note', () => {
    const placed = placedPet()
    inspect(placed, true)
    expect(screen.queryByText(NOTE)).toBeNull()
    cleanup()
    inspect({ ...placed, [PET]: placed[PET].replace('      - petId\n', '') }, false)
    expect(screen.queryByText(NOTE)).toBeNull()
  })
})
