import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import yaml from 'js-yaml'
import { describe, expect, it } from 'vitest'

import { BUILDER_SPEC_KEYS, BUILDER_SPEC_REQUIRED, parseBuilder } from './builderSpec'

const CRD_PATH = join(__dirname, '..', '..', '..', 'helm', 'frontend-crds', 'templates', 'builders', 'Builder.yaml')

interface SchemaNode { properties?: Record<string, SchemaNode>; required?: string[] }

const crdSpec = (): SchemaNode => {
  const crd = yaml.load(readFileSync(CRD_PATH, 'utf8')) as { spec: { versions: { schema: { openAPIV3Schema: SchemaNode } }[] } }
  return crd.spec.versions[0].schema.openAPIV3Schema.properties!.spec
}

/** A minimal valid Builder, rebuilt per test so a mutation never leaks. */
const valid = (): Record<string, unknown> => ({
  apiVersion: 'builders.templates.krateo.io/v1alpha1',
  kind: 'Builder',
  metadata: { name: 'demo-builder' },
  spec: {
    canvas: { plugin: 'page-grid' },
    draftKind: 'page',
    files: { locked: ['compositiondefinition.yaml'], required: ['Chart.yaml'] },
    gates: ['preview-before-publish'],
    inspector: { plugin: 'object-tree' },
    label: 'Demo',
    lint: ['chart-lint'],
    palette: { plugin: 'widgets' },
    portal: { draftsCard: { name: 'demo-drafts-card' } },
    preview: { mode: 'sandbox-apply' },
    publish: {
      builder: 'page',
      registration: { kind: 'CompositionDefinition', path: 'compositiondefinition.yaml' },
      targetKey: 'AUTOPILOT_PAGE_BUILDER_REPO',
      templateKey: 'AUTOPILOT_PAGE_BUILDER_TEMPLATE',
    },
    route: '/demo-builder/compose',
    start: { fields: [{ label: 'Slug', name: 'slug', required: true }], maxDraftBytes: 524288 },
    verbs: { allowed: ['composeAdd'] },
  },
})

const specOf = (builder: Record<string, unknown>) => builder.spec as Record<string, Record<string, unknown>>

const problemsOf = (value: unknown): string[] => {
  const result = parseBuilder(value)
  return result.ok ? [] : result.problems
}

describe('the Builder spec mirrors the CRD', () => {
  it('has exactly the CRD spec\'s keys', () => {
    expect([...BUILDER_SPEC_KEYS].sort()).toEqual(Object.keys(crdSpec().properties!).sort())
  })

  it('requires exactly what the CRD requires', () => {
    expect([...BUILDER_SPEC_REQUIRED].sort()).toEqual([...crdSpec().required!].sort())
  })

  it('carries no default and no preserve-unknown anywhere in the CRD', () => {
    const keys: string[] = []
    const walk = (node: unknown): void => {
      if (Array.isArray(node)) {
        node.forEach(walk)
      } else if (typeof node === 'object' && node !== null) {
        Object.entries(node).forEach(([key, value]) => {
          keys.push(key)
          walk(value)
        })
      }
    }
    walk(crdSpec())
    expect(keys).not.toContain('default')
    expect(keys).not.toContain('x-kubernetes-preserve-unknown-fields')
    expect(keys).toContain('pattern')
  })
})

describe('parseBuilder', () => {
  it('accepts a minimal valid Builder and types it', () => {
    const result = parseBuilder(valid())
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.builder.spec.route).toBe('/demo-builder/compose')
      expect(result.builder.spec.parser).toBeUndefined()
    }
  })

  it('never throws, whatever it is handed', () => {
    for (const value of [null, undefined, 42, 'Builder', [], { spec: [] }, { spec: { start: { fields: 'x' } } }]) {
      expect(() => parseBuilder(value)).not.toThrow()
      expect(parseBuilder(value).ok).toBe(false)
    }
  })

  it('refuses the wrong apiVersion or kind, and a missing name', () => {
    const builder = valid()
    builder.apiVersion = 'widgets.templates.krateo.io/v1beta1'
    builder.kind = 'Card'
    builder.metadata = {}
    expect(problemsOf(builder)).toEqual([
      'apiVersion must be builders.templates.krateo.io/v1alpha1, not "widgets.templates.krateo.io/v1beta1"',
      'kind must be Builder, not "Card"',
      'metadata.name is required',
    ])
  })

  it('names each missing required field by its path', () => {
    const builder = valid()
    delete specOf(builder).route
    delete specOf(builder).publish.templateKey
    expect(problemsOf(builder)).toEqual(['spec.route is required', 'spec.publish.templateKey is required'])
  })

  it('reports an unknown field rather than dropping it silently', () => {
    const builder = valid()
    specOf(builder).canvas.plugins = 'page-grid'
    ;(builder.spec as Record<string, unknown>).palete = { plugin: 'widgets' }
    expect(problemsOf(builder)).toEqual(['spec.canvas.plugins is not a Builder field', 'spec.palete is not a Builder field'])
  })

  it('holds the CRD\'s patterns and enums', () => {
    const builder = valid()
    specOf(builder).canvas.plugin = 'PageGrid'
    ;(builder.spec as Record<string, unknown>).route = 'portal-builder'
    specOf(builder).preview.mode = 'apply'
    specOf(builder).publish.targetKey = 'autopilot_repo'
    const problems = problemsOf(builder)
    expect(problems).toHaveLength(4)
    expect(problems.join('\n')).toMatch(/spec\.canvas\.plugin "PageGrid"/)
    expect(problems.join('\n')).toMatch(/spec\.route "portal-builder"/)
    expect(problems.join('\n')).toMatch(/spec\.preview\.mode "apply" is not one of sandbox-apply, render/)
    expect(problems.join('\n')).toMatch(/spec\.publish\.targetKey "autopilot_repo"/)
  })

  it('refuses a render preview with no RESTAction — the CRD\'s CEL rule', () => {
    const builder = valid()
    specOf(builder).preview.mode = 'render'
    expect(problemsOf(builder)).toEqual(['a render preview names the RESTAction that renders it (preview.restActionRef)'])
    specOf(builder).preview.restActionRef = { name: 'blueprint-render-draft' }
    expect(problemsOf(builder)).toEqual([])
  })

  it('refuses a repeated list entry, a repeated start field and a file both required and locked', () => {
    const builder = valid()
    ;(builder.spec as Record<string, unknown>).lint = ['chart-lint', 'chart-lint']
    specOf(builder).start.fields = [{ label: 'A', name: 'slug', required: true }, { label: 'B', name: 'slug', required: false }]
    specOf(builder).files.locked = ['Chart.yaml']
    expect(problemsOf(builder)).toEqual([
      'spec.start.fields names "slug" twice',
      'spec.files lists "Chart.yaml" as both required and locked — a file the author must keep but may never write',
      'spec.lint lists "chart-lint" twice',
    ])
  })

  it('refuses a byte cap outside a ConfigMap and a start-field pattern that is not a regex', () => {
    const builder = valid()
    specOf(builder).start.maxDraftBytes = 2 * 1048576
    specOf(builder).start.fields = [{ label: 'Slug', name: 'slug', pattern: '([', required: true }]
    expect(problemsOf(builder)).toEqual([
      'spec.start.maxDraftBytes must be a whole number of bytes from 1 to 1048576',
      'spec.start.fields[0].pattern is not a valid regular expression',
    ])
  })
})
