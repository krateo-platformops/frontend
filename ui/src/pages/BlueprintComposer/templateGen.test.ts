/**
 * The template a placement writes — one golden per class, the two forEach shapes, and the header.
 * The spec fields are the LIVE CRD's (sliced from krateo-057), read at the version the pick names.
 */
import { load } from 'js-yaml'
import { describe, expect, it } from 'vitest'

import { extractCrdSpecFields } from '../../components/Autopilot/describeResource'

import { CRDS, golden } from './__fixtures__/s4a'
import { PLACED_MARKER, placedHeader, placedTemplate, rangeSource } from './templateGen'

const repositorySpec = extractCrdSpecFields(CRDS['repositories.github.krateo.io'], 'v2022-11-28')
const localSpec = extractCrdSpecFields(CRDS['localresources.git.krateo.io'], 'v1alpha1')
const builderSpec = extractCrdSpecFields(CRDS['builderpublishes.composition.krateo.io'], 'v1-8-40')

/** Helm actions out, so the rest can be read as the YAML it renders to. */
const rendered = (template: string): unknown => load(template
  .replace(/^\{\{-.*\}\}$/gm, '')
  .replace(/\{\{[^}]*\}\}/g, 'x'))

describe('placedTemplate — one golden per class', () => {
  it('custom: the CRD\'s required spec fields, empty by type, and the optional ones named', () => {
    const text = placedTemplate({ apiVersion: 'github.krateo.io/v2022-11-28', class: 'custom', id: 'repository', kind: 'Repository' }, { spec: repositorySpec })
    expect(text).toBe(golden('repository'))
    expect(rendered(text)).toMatchObject({ kind: 'Repository', spec: { configurationRef: {}, name: '', org: '' } })
  })

  it('composition: a claim of the served version — v1-8-40, never the unserved storage version', () => {
    const text = placedTemplate({ apiVersion: 'composition.krateo.io/v1-8-40', class: 'composition', id: 'builderpublish', kind: 'BuilderPublish' }, { spec: builderSpec })
    expect(text).toBe(golden('builderpublish'))
  })

  it('native: a skeleton the apiserver takes once its blanks are filled, whatever spec is passed', () => {
    const text = placedTemplate({ apiVersion: 'apps/v1', class: 'native', id: 'deployment', kind: 'Deployment' }, { spec: repositorySpec })
    expect(text).toBe(golden('deployment'))
  })

  it('every native kind renders YAML with its name and namespace', () => {
    for (const kind of ['Deployment', 'StatefulSet', 'Service', 'ConfigMap', 'Secret', 'Ingress', 'PersistentVolumeClaim', 'Job', 'CronJob']) {
      const doc = rendered(placedTemplate({ apiVersion: 'v1', class: 'native', id: kind.toLowerCase(), kind }, { spec: null })) as { kind: string; metadata: unknown }
      expect(doc.kind).toBe(kind)
      expect(doc.metadata).toEqual({ name: 'x', namespace: 'x' })
    }
  })
})

describe('placedTemplate — forEach', () => {
  const node = { apiVersion: 'git.krateo.io/v1alpha1', class: 'custom' as const, id: 'localresource', kind: 'LocalResource' }

  it('a bare path is ranged over from the root, and each item is named by its index', () => {
    expect(placedTemplate({ ...node, forEach: '.Values.files' }, { spec: localSpec })).toBe(golden('localresource.foreach-path'))
  })

  it('anything else is a named helper whose YAML list is ranged over', () => {
    expect(placedTemplate({ ...node, forEach: 'builder-publish.files' }, { spec: localSpec })).toBe(golden('localresource.foreach-helper'))
    expect(rangeSource('builder-publish.files')).toBe('(include "builder-publish.files" $ | fromYamlArray)')
    expect(rangeSource('.Values.a.b')).toBe('$.Values.a.b')
  })
})

describe('placedTemplate — the header', () => {
  it('carries the marker, the kind, the apiVersion and the class, as a comment that renders nothing', () => {
    const [header] = placedHeader({ apiVersion: 'v1', class: 'native', id: 'cm', kind: 'ConfigMap' })
    expect(header.startsWith(`{{- /* ${PLACED_MARKER} ConfigMap v1 (native)`)).toBe(true)
    expect(header.endsWith('*/}}')).toBe(true)
  })

  it('when the CRD could not be read: spec is empty, and a second header line says why', () => {
    const text = placedTemplate({ apiVersion: 'github.krateo.io/v2022-11-28', class: 'custom', id: 'repository', kind: 'Repository' }, { spec: repositorySpec, specNote: 'snowplow answered 403' })
    expect(text.split('\n')[1]).toBe('{{- /* Its CRD could not be read (snowplow answered 403), so spec is empty — fill it in. */}}')
    expect(text).toContain('\nspec: {}\n')
    expect(text).not.toContain('configurationRef')
  })

  it('a reason cannot close the comment early', () => {
    const [, note] = placedHeader({ apiVersion: 'v1', class: 'custom', id: 'x', kind: 'X' }, 'evil */}} {{ fail "x" }}')
    expect(note.indexOf('*/')).toBe(note.length - 4)
  })

  it('names at most twelve optional fields and counts the rest; with none required, spec is {}', () => {
    const fields = Array.from({ length: 15 }, (_, idx) => ({ name: `f${idx}`, required: false, type: 'string' }))
    const text = placedTemplate({ apiVersion: 'x.io/v1', class: 'custom', id: 'x', kind: 'X' }, { spec: { fields } })
    expect(text).toContain('spec: {} # optional: f0, f1, f2, f3, f4, f5, f6, f7, f8, f9, f10, f11 … and 3 more\n')
  })
})
