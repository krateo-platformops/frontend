/**
 * setForEach — ranging a placed node over a list (and back), as one batch: the descriptor's
 * `forEach`, and the template's range and name. Only on a template still in the shape placing wrote.
 */
import { describe, expect, it } from 'vitest'

import { extractCrdSpecFields } from '../../components/Autopilot/describeResource'

import { CRDS, golden } from './__fixtures__/s4a'
import { ARCHITECTURE_TEMPLATE_PATH, parseArchitecture, unwrapFromConfigMapTemplate } from './architecture'
import { placedNameExpression } from './naming'
import { planPlace, setForEach, type PlacePlan } from './planPlace'
import { startChart } from './startChart'
import { placedTemplate } from './templateGen'

const localResource = { apiVersion: 'git.krateo.io/v1alpha1', cls: 'custom' as const, group: 'git.krateo.io', kind: 'LocalResource', plural: 'localresources' }
const PATH = 'templates/localresource.yaml'

const applied = (files: Record<string, string>, plan: PlacePlan): Record<string, string> => {
  if (!plan.ok) { throw new Error(plan.reason) }
  return { ...files, ...plan.add, ...plan.edit }
}

/** A seeded chart with one LocalResource placed. */
const withPlaced = (): Record<string, string> => {
  const started = startChart({ description: '', name: 'orders', version: '0.1.0' })
  if (!started.ok) { throw new Error('fixture refused') }
  return applied(started.files, planPlace(started.files, localResource, extractCrdSpecFields(CRDS['localresources.git.krateo.io'], 'v1alpha1')))
}

const nameOf = (files: Record<string, string>): string | undefined => {
  const parsed = parseArchitecture(unwrapFromConfigMapTemplate(files[ARCHITECTURE_TEMPLATE_PATH]) ?? '')
  return parsed.ok ? parsed.architecture.resources[0].name : 'unparsed'
}

const forEachOf = (files: Record<string, string>): string | undefined => {
  const parsed = parseArchitecture(unwrapFromConfigMapTemplate(files[ARCHITECTURE_TEMPLATE_PATH]) ?? '')
  return parsed.ok ? parsed.architecture.resources[0].forEach : 'unparsed'
}

const RESHAPED = `${PATH} has changed shape since it was placed — set forEach in Chart files.`

describe('setForEach', () => {
  it('ranges a placed node over a bare path: descriptor and template in ONE batch, pinned to what it read', () => {
    const files = withPlaced()
    const plan = setForEach(files, 'localresource', '.Values.files')
    if (!plan.ok) { throw new Error(plan.reason) }
    expect(plan.add).toEqual({})
    expect(Object.keys(plan.edit).sort()).toEqual([ARCHITECTURE_TEMPLATE_PATH, PATH])
    expect(plan.edit[PATH]).toBe(golden('localresource.foreach-path'))
    expect(plan.expect).toEqual({ [ARCHITECTURE_TEMPLATE_PATH]: files[ARCHITECTURE_TEMPLATE_PATH], [PATH]: files[PATH] })
    expect(forEachOf(applied(files, plan))).toBe('.Values.files')
  })

  it('the descriptor\'s name follows the template\'s — per item while it ranges, single again when cleared', () => {
    const files = withPlaced()
    expect(nameOf(files)).toBe(placedNameExpression('localresource', false))
    const ranged = applied(files, setForEach(files, 'localresource', '.Values.files'))
    expect(nameOf(ranged)).toBe(placedNameExpression('localresource', true))
    expect(ranged[PATH]).toContain(`  name: {{ ${placedNameExpression('localresource', true)} }}`)
    expect(nameOf(applied(ranged, setForEach(ranged, 'localresource', null)))).toBe(placedNameExpression('localresource', false))
  })

  it('…or over a named helper', () => {
    const plan = setForEach(withPlaced(), 'localresource', 'builder-publish.files')
    expect(plan.ok && plan.edit[PATH]).toBe(golden('localresource.foreach-helper'))
  })

  it('clearing it puts the template back exactly as placing wrote it', () => {
    const files = withPlaced()
    const ranged = applied(files, setForEach(files, 'localresource', '.Values.files'))
    const cleared = applied(ranged, setForEach(ranged, 'localresource', null))
    expect(cleared[PATH]).toBe(files[PATH])
    expect(forEachOf(cleared)).toBeUndefined()
    // …and a range can be moved from one list to another.
    expect(setForEach(ranged, 'localresource', 'builder-publish.files').ok).toBe(true)
  })

  for (const kind of ['Deployment', 'StatefulSet']) {
    it(`a native ${kind}: its selector and pod labels become per item too — exactly the template placing writes ranged`, () => {
      const started = startChart({ description: '', name: 'orders', version: '0.1.0' })
      if (!started.ok) { throw new Error('fixture refused') }
      const placed = applied(started.files, planPlace(started.files, { apiVersion: 'apps/v1', cls: 'native', kind }, null))
      const id = kind.toLowerCase()
      const path = `templates/${id}.yaml`
      const plan = setForEach(placed, id, '.Values.envs')
      if (!plan.ok) { throw new Error(plan.reason) }
      expect(plan.edit[path]).toBe(placedTemplate({ apiVersion: 'apps/v1', class: 'native', forEach: '.Values.envs', id, kind }, { spec: null }))
      expect(plan.edit[path]).toContain(`        app.kubernetes.io/instance: {{ ${placedNameExpression(id, true)} }}`)
      expect(plan.edit[path]).not.toContain(placedNameExpression(id, false))
      // …and cleared, the template placing wrote, byte for byte.
      const ranged = applied(placed, plan)
      expect(applied(ranged, setForEach(ranged, id, null))[path]).toBe(placed[path])
    })
  }

  it('a selector the author changed is theirs: ranging leaves it as they wrote it', () => {
    const started = startChart({ description: '', name: 'orders', version: '0.1.0' })
    if (!started.ok) { throw new Error('fixture refused') }
    const placed = applied(started.files, planPlace(started.files, { apiVersion: 'apps/v1', cls: 'native', kind: 'Deployment' }, null))
    const path = 'templates/deployment.yaml'
    const single = placedNameExpression('deployment', false)
    const edited = placed[path].replace(`      app.kubernetes.io/instance: {{ ${single} }}`, '      app: web')
    const plan = setForEach({ ...placed, [path]: edited }, 'deployment', '.Values.envs')
    if (!plan.ok) { throw new Error(plan.reason) }
    expect(plan.edit[path]).toContain('    matchLabels:\n      app: web\n')
    expect(plan.edit[path]).toContain(`        app.kubernetes.io/instance: {{ ${placedNameExpression('deployment', true)} }}`)
  })

  it('spec values the author filled in are kept — only the shape has to be placing\'s', () => {
    const files = withPlaced()
    const filled = { ...files, [PATH]: files[PATH].replace('  toRepo: {}', '  toRepo:\n    url: https://github.com/x/y') }
    const plan = setForEach(filled, 'localresource', '.Values.files')
    expect(plan.ok && plan.edit[PATH]).toContain('  toRepo:\n    url: https://github.com/x/y\n')
  })

  it('a template reshaped by hand is refused with the copy that says where to do it instead', () => {
    const files = withPlaced()
    const reshaped: Record<string, string> = {
      'a block of its own': files[PATH].replace('apiVersion:', '{{- if .Values.enabled }}\napiVersion:').concat('{{- end }}\n'),
      'a renamed object': files[PATH].replace('"%s-localresource"', '"%s-files"'),
      'a second document': `${files[PATH]}---\napiVersion: v1\nkind: ConfigMap\n`,
      'no placed marker': files[PATH].replace('krateo:placed ', ''),
    }
    for (const [why, template] of Object.entries(reshaped)) {
      expect({ why, ...setForEach({ ...files, [PATH]: template }, 'localresource', '.Values.files') }).toEqual({ ok: false, reason: RESHAPED, why })
    }
  })

  it('refuses what is not a path or a helper, a node that is not there, a template that is not held, and a no-op', () => {
    const files = withPlaced()
    const notAPath = { ok: false, reason: 'One per item of takes a bare path (.Values.files) or a named helper (builder-publish.files).' }
    expect(setForEach(files, 'localresource', '{{ .Values.files }}')).toEqual(notAPath)
    // A path is a .Values path: the descriptor's parser takes no other, and `.files` would leave an
    // architecture file the composer could not read back. A dashed key would not parse as `$.Values.a-b`.
    expect(setForEach(files, 'localresource', '.files')).toEqual(notAPath)
    expect(setForEach(files, 'localresource', '.Values.my-files')).toEqual(notAPath)
    expect(setForEach(files, 'nowhere', '.Values.files')).toEqual({ ok: false, reason: '"nowhere" is not a resource of this chart.' })
    const { [PATH]: _gone, ...withoutTemplate } = files
    expect(setForEach(withoutTemplate, 'localresource', '.Values.files')).toEqual({ ok: false, reason: `${PATH} is not in the chart — there is nothing to range.` })
    expect(setForEach(files, 'localresource', null)).toEqual({ ok: false, reason: 'localresource is not ranged over anything.' })
  })
})
