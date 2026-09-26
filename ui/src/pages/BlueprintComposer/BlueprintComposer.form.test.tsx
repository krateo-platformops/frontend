// @vitest-environment jsdom
/**
 * Screen 10 — the form editor: values.schema.json with its crdgen problems marked where they are,
 * the fix one press away, and the create form it generates beside it. Every write rides the
 * file-edit bus as `values.schema.json` of a blueprint; the provider's refusal is shown where the
 * edit was made.
 */
import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { AUTOPILOT_PREVIEW_FILE_EDIT_EVENT, onFileEdit, type FileEditDetail } from '../../components/Autopilot/previewFileEdit'
import { graphDouble } from '../../components/DependencyGraph/flowGraphDouble'

import { MOCKUP_10_FIXED, MOCKUP_10_SCHEMA } from './__fixtures__/s4a'
import { hold, installAntdShims, installScrollShim, listen, mount, seededChart } from './blueprintTestHarness'

vi.mock('@ant-design/graphs', () => import('../../components/DependencyGraph/flowGraphDouble'))
vi.mock('@antv/g6-extension-react', () => ({ ReactNode: vi.fn() }))

beforeAll(() => {
  installAntdShims()
  installScrollShim()
})
beforeEach(() => graphDouble.reset())
afterEach(cleanup)

const COMBINATOR = '{\n  "type": "object",\n  "properties": {\n    "src": { "type": "object", "anyOf": [{ "required": ["a"] }, { "required": ["b"] }] }\n  }\n}\n'

const openEditor = (schema = MOCKUP_10_SCHEMA) => {
  mount()
  hold({ ...seededChart(), 'values.schema.json': schema })
  act(() => { within(screen.getByLabelText('Inspector')).getByRole('button', { name: 'Open form editor' }).click() })
  return screen.getByRole('dialog')
}

const schemaPane = () => within(screen.getByRole('dialog')).getByRole('region', { name: 'values.schema.json' })
const formPane = () => within(screen.getByRole('dialog')).getByRole('region', { name: 'Create form preview' })

describe('BlueprintComposer — the form editor (screen 10)', () => {
  it('1. the mockup schema: the credentials lines are marked, and the refusal says why, with the fix', () => {
    openEditor()
    const marked = [...schemaPane().querySelectorAll('[data-problem]')].map((line) => line.textContent ?? '')
    expect(marked).toHaveLength(5)
    expect(marked[0]).toContain('"credentials": {')
    expect(marked[2]).toContain('"default": { "authMethod": "basic" }')
    const box = schemaPane().querySelector('[data-problem-box="properties.credentials.default"]')
    expect(box?.querySelector('strong')?.textContent).toBe('credentials.default')
    expect(box?.textContent).toContain(' — a populated object default breaks Krateo\'s CRD generation: the CompositionDefinition would wedge at Ready=False. Keep the object default empty and put the values on the scalars inside it.')
    expect(within(schemaPane()).getByRole('button', { name: 'Fix it for me' })).toBeTruthy()
  })

  it('2. the header says the exception: "1 problem · publish blocked" — and nothing when there is none', () => {
    const dialog = openEditor()
    expect(within(dialog).getByText('1 problem · publish blocked')).toBeTruthy()
    cleanup()
    const clean = openEditor(MOCKUP_10_FIXED)
    expect(within(clean).queryByText(/publish blocked/)).toBeNull()
  })

  it('3. the form leaves Credentials out and says so; every other field renders', () => {
    openEditor()
    const form = within(formPane())
    expect(form.getByText('credentials — not rendered while the schema has a problem')).toBeTruthy()
    for (const label of ['name', 'builder', 'url', 'create', 'files']) {
      expect(form.getAllByText(label).length).toBeGreaterThan(0)
    }
    expect(form.queryByText('authMethod')).toBeNull()
  })

  it('4. Fix it for me: ONE file edit of values.schema.json, the golden bytes — and once held, no problems and Credentials renders', async () => {
    openEditor()
    const edits = listen<FileEditDetail>(AUTOPILOT_PREVIEW_FILE_EDIT_EVENT)
    act(() => { within(schemaPane()).getByRole('button', { name: 'Fix it for me' }).click() })
    edits.stop()
    expect(edits.seen).toHaveLength(1)
    expect(edits.seen[0]).toMatchObject({ content: MOCKUP_10_FIXED, kind: 'blueprint', path: 'values.schema.json' })
    hold({ ...seededChart(), 'values.schema.json': MOCKUP_10_FIXED })
    await waitFor(() => expect(schemaPane().querySelectorAll('[data-problem]')).toHaveLength(0))
    expect(within(screen.getByRole('dialog')).queryByText(/publish blocked/)).toBeNull()
    expect(within(formPane()).queryByText(/not rendered while the schema has a problem/)).toBeNull()
    expect(within(formPane()).getAllByText('authMethod').length).toBeGreaterThan(0)
  })

  it('5. a combinator is marked — and has no fix to offer', () => {
    openEditor(COMBINATOR)
    expect(schemaPane().querySelectorAll('[data-problem]')).toHaveLength(1)
    expect(within(schemaPane()).getByText('src.anyOf')).toBeTruthy()
    expect(within(schemaPane()).queryByRole('button', { name: 'Fix it for me' })).toBeNull()
  })

  it('6. Form fields "String" opens the editor on a String field: "region" is added; "name" is refused with its reason', async () => {
    mount()
    hold(seededChart())
    const edits = listen<FileEditDetail>(AUTOPILOT_PREVIEW_FILE_EDIT_EVENT)
    act(() => { within(screen.getByRole('region', { name: 'Add' })).getByRole('button', { name: 'String' }).click() })
    const dialog = within(screen.getByRole('dialog'))
    await waitFor(() => expect(document.activeElement).toBe(dialog.getByLabelText('Field name')))
    expect(dialog.getByRole('group', { name: 'Add a field' }).textContent).toContain('String')
    act(() => { fireEvent.change(dialog.getByLabelText('Field name'), { target: { value: 'name' } }) })
    act(() => { dialog.getByRole('button', { name: 'Add field' }).click() })
    expect(dialog.getByRole('alert').textContent).toBe('"name" is reserved — the create form always asks for the composition\'s name and namespace itself.')
    expect(edits.seen).toEqual([])
    act(() => { fireEvent.change(dialog.getByLabelText('Field name'), { target: { value: 'region' } }) })
    act(() => { dialog.getByRole('button', { name: 'Add field' }).click() })
    edits.stop()
    expect(edits.seen).toHaveLength(1)
    expect(edits.seen[0]).toMatchObject({ kind: 'blueprint', path: 'values.schema.json' })
    expect(JSON.parse(edits.seen[0].content)).toMatchObject({ properties: { region: { type: 'string' } } })
  })

  it('7. the provider refuses a write: "This edit was not applied", with its reason', () => {
    openEditor()
    const stop = onFileEdit((_edit, respond) => respond({ error: 'the edit brings the draft to 600 KiB — over the 512 KiB cap; trim the file', ok: false }))
    act(() => { within(schemaPane()).getByRole('button', { name: 'Fix it for me' }).click() })
    stop()
    expect(within(schemaPane()).getByText('This edit was not applied')).toBeTruthy()
    expect(within(schemaPane()).getByText(/over the 512 KiB cap/)).toBeTruthy()
  })

  it('Edit, then Apply: the text is written as typed, and text that is not JSON is refused before it is', () => {
    openEditor(MOCKUP_10_FIXED)
    const edits = listen<FileEditDetail>(AUTOPILOT_PREVIEW_FILE_EDIT_EVENT)
    act(() => { within(schemaPane()).getByRole('button', { name: 'Edit' }).click() })
    act(() => { fireEvent.change(within(schemaPane()).getByLabelText('Edit values.schema.json'), { target: { value: '{ "type": ' } }) })
    act(() => { within(schemaPane()).getByRole('button', { name: 'Apply' }).click() })
    expect(within(schemaPane()).getByText('This edit was not applied')).toBeTruthy()
    expect(edits.seen).toEqual([])
    act(() => { fireEvent.change(within(schemaPane()).getByLabelText('Edit values.schema.json'), { target: { value: '{ "type": "object", "properties": {} }\n' } }) })
    act(() => { within(schemaPane()).getByRole('button', { name: 'Apply' }).click() })
    edits.stop()
    expect(edits.seen.map((edit) => edit.content)).toEqual(['{ "type": "object", "properties": {} }\n'])
  })

  it('Esc closes the editor and gives focus back to what opened it', async () => {
    mount()
    hold({ ...seededChart(), 'values.schema.json': MOCKUP_10_SCHEMA })
    const trigger = within(screen.getByLabelText('Inspector')).getByRole('button', { name: 'Open form editor' })
    trigger.focus()
    act(() => { trigger.click() })
    const dialog = screen.getByRole('dialog')
    act(() => { fireEvent.keyDown(dialog, { code: 'Escape', key: 'Escape' }) })
    await waitFor(() => expect(document.activeElement).toBe(trigger))
  })
})
