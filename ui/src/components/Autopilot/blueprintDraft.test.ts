/**
 * FE-B1 + FE-B2 pure-logic coverage for blueprintDraft.ts:
 *   - the crdgen-defaults lint matrix (non-empty object/array defaults = the
 *     krateo-platformops/core-provider#46 class → HARD ERROR; scalar/absent/empty
 *     defaults pass; a property literally NAMED "default" is not a false positive),
 *     including the exact #46 ingress.hosts shape as a fixture;
 *   - the 512 KiB rawTemplates size cap (same discipline as the OAS attachment);
 *   - the inline-args guard (parseRawTemplates) and the form-preview builders
 *     (verbatim-string preference, name/namespace splice, hidden-title collection).
 */
import { describe, expect, it } from 'vitest'

import { ARCHITECTURE_TEMPLATE_PATH, unwrapFromConfigMapTemplate, wrapAsConfigMapTemplate } from '../../pages/BlueprintComposer/architecture'
import { placedNameExpression } from '../../pages/BlueprintComposer/naming'

import {
  buildFormPreviewModel,
  buildFormSchemaText,
  chartYamlName,
  chartYamlVersion,
  draftDisplayName,
  lintBlueprintDraft,
  lintValuesSchemaDefaults,
  lintValuesSchemaRoot,
  parseRawTemplates,
  RAW_TEMPLATES_MAX_BYTES,
  rawTemplatesByteSize,
  regenerateArchitecture,
  stripCodeFence,
} from './blueprintDraft'

describe('stripCodeFence — de-fence a model-wrapped file body', () => {
  const json = '{ "title": "AWS VPC", "type": "object" }'
  it('strips a python-style triple-quote wrapper (the observed values.schema.json failure)', () => {
    expect(stripCodeFence(`'''${json}'''`)).toBe(json)
    expect(stripCodeFence(`"""${json}"""`)).toBe(json)
  })
  it('strips a markdown fence, including an opening language tag', () => {
    expect(stripCodeFence(`\`\`\`json\n${json}\n\`\`\``)).toBe(json)
    expect(stripCodeFence(`\`\`\`\n${json}\n\`\`\``)).toBe(json)
  })
  it('leaves genuine content untouched (no wrapper)', () => {
    expect(stripCodeFence(json)).toBe(json)
    expect(stripCodeFence('replicaCount: 1\nimage:\n  tag: latest')).toBe('replicaCount: 1\nimage:\n  tag: latest')
  })
  it('parseRawTemplates de-fences every file body so the schema then parses', () => {
    const cleaned = parseRawTemplates({ 'Chart.yaml': '```yaml\nname: x\n```', 'values.schema.json': `'''${json}'''` })
    expect(cleaned).not.toBeNull()
    expect(cleaned!['values.schema.json']).toBe(json)
    expect(cleaned!['Chart.yaml']).toBe('name: x')
    expect(() => { JSON.parse(cleaned!['values.schema.json']) }).not.toThrow()
  })
})

/** The EXACT krateo-platformops/core-provider#46 class: a helm-scaffold ingress.hosts
 * array default in values.schema.json → malformed +kubebuilder:default marker →
 * controller-gen parse failure → the CompositionDefinition wedges Ready=False. */
const ISSUE_46_INGRESS_HOSTS_SCHEMA = JSON.stringify({
  properties: {
    ingress: {
      properties: {
        enabled: { default: false, type: 'boolean' },
        hosts: {
          default: [
            { host: 'chart-example.local', paths: [{ path: '/', pathType: 'ImplementationSpecific' }] },
          ],
          items: { type: 'object' },
          type: 'array',
        },
      },
      type: 'object',
    },
  },
  type: 'object',
})

describe('lintValuesSchemaDefaults — the FE-B2 crdgen-defaults matrix', () => {
  it('flags a non-empty OBJECT default as a hard error', () => {
    const schema = JSON.stringify({
      properties: { resources: { default: { limits: { cpu: '100m' } }, type: 'object' } },
      type: 'object',
    })
    const problems = lintValuesSchemaDefaults(schema)
    expect(problems).toHaveLength(1)
    expect(problems[0]).toContain('[CRDGEN-DEFAULTS]')
    expect(problems[0]).toContain('properties.resources.default')
    expect(problems[0]).toContain('object default')
    expect(problems[0]).toContain('krateo-platformops/core-provider#46')
  })

  it('flags a non-empty ARRAY default as a hard error', () => {
    const schema = JSON.stringify({
      properties: { tolerations: { default: [{ key: 'node' }], items: { type: 'object' }, type: 'array' } },
      type: 'object',
    })
    const problems = lintValuesSchemaDefaults(schema)
    expect(problems).toHaveLength(1)
    expect(problems[0]).toContain('array default')
    expect(problems[0]).toContain('properties.tolerations.default')
  })

  it('flags the exact #46 ingress.hosts fixture (and ONLY the hosts default)', () => {
    const problems = lintValuesSchemaDefaults(ISSUE_46_INGRESS_HOSTS_SCHEMA)
    expect(problems).toHaveLength(1)
    expect(problems[0]).toContain('properties.ingress.properties.hosts.default')
    expect(problems[0]).toContain('array default')
  })

  it('flags nested defaults at ANY depth (items / allOf branches)', () => {
    const schema = JSON.stringify({
      allOf: [{ properties: { extra: { default: { on: true }, type: 'object' } } }],
      properties: {
        list: { items: { default: ['a'], type: 'array' }, type: 'array' },
      },
      type: 'object',
    })
    const problems = lintValuesSchemaDefaults(schema)
    // THREE now: the two nested defaults, plus the `allOf` itself. A combinator is reported AND
    // still walked into — skipping its branches would quietly drop exactly the nested-defaults
    // coverage this case exists for, and those defaults do not vanish when the allOf is removed.
    expect(problems).toHaveLength(3)
    expect(problems.join('\n')).toContain('allOf[0].properties.extra.default')
    expect(problems.join('\n')).toContain('properties.list.items.default')
    expect(problems.join('\n')).toContain('[CRDGEN-COMBINATOR]')
  })

  it('flags a subschema combinator, which is valid JSON Schema and an ungenerable CRD', () => {
    // Observed on builder-publish 1.8.24: `anyOf: [{required:[files]},{required:[filesBundle]}]`
    // said "one or the other", and the apiserver rejected the generated CRD with
    // "anyOf[0].type: Forbidden: must be empty to be structural". The chart sat Ready=False, the
    // served CRD stayed a version behind, and a field the new schema added was pruned off every
    // claim that sent it — so a human publish committed nothing and opened an empty change request.
    const schema = JSON.stringify({
      anyOf: [{ required: ['files'] }, { required: ['filesBundle'] }],
      properties: { files: { type: 'array' }, filesBundle: { type: 'object' } },
      type: 'object',
    })

    expect(lintValuesSchemaDefaults(schema).join('\n')).toContain('[CRDGEN-COMBINATOR] anyOf')
  })

  it('passes scalar defaults, absent defaults, and EMPTY object/array defaults', () => {
    const schema = JSON.stringify({
      properties: {
        annotations: { default: {}, type: 'object' },
        args: { default: [], items: { type: 'string' }, type: 'array' },
        enabled: { default: false, type: 'boolean' },
        name: { type: 'string' },
        region: { default: 'eu-west-1', enum: ['eu-west-1', 'us-east-1'], type: 'string' },
        replicas: { default: 2, type: 'integer' },
        tag: { default: null, type: 'string' },
      },
      required: ['name'],
      type: 'object',
    })
    expect(lintValuesSchemaDefaults(schema)).toEqual([])
  })

  it('does NOT mistake a property literally named "default" for the keyword', () => {
    const schema = JSON.stringify({
      properties: {
        default: { properties: { size: { type: 'string' } }, type: 'object' },
      },
      type: 'object',
    })
    expect(lintValuesSchemaDefaults(schema)).toEqual([])
  })

  it('does not walk INTO enum/const/examples values (data, not schema)', () => {
    const schema = JSON.stringify({
      properties: {
        preset: { enum: [{ default: ['not-a-keyword'] }], type: 'object' },
      },
      type: 'object',
    })
    expect(lintValuesSchemaDefaults(schema)).toEqual([])
  })

  it('invalid JSON is itself a hard error (never a crash)', () => {
    const problems = lintValuesSchemaDefaults('{ not json')
    expect(problems).toHaveLength(1)
    expect(problems[0]).toContain('values.schema.json is not valid JSON')
  })
})

describe('lintBlueprintDraft — size cap + schema gate', () => {
  const cleanDraft = {
    'Chart.yaml': 'apiVersion: v2\nname: pg-app\nversion: 0.1.0\n',
    'templates/cm.yaml': 'kind: ConfigMap\n',
    'values.schema.json': JSON.stringify({ properties: { size: { default: 'S', type: 'string' } }, type: 'object' }),
    'values.yaml': 'size: S\n',
  }

  it('passes a clean draft (scalar defaults only, under the cap)', () => {
    expect(lintBlueprintDraft(cleanDraft, 'blueprint')).toEqual([])
  })

  it('rejects a draft over the 512 KiB cap — the SAME discipline as $oasAttachment', () => {
    const oversized = { ...cleanDraft, 'templates/big.yaml': 'x'.repeat(RAW_TEMPLATES_MAX_BYTES + 1) }
    const problems = lintBlueprintDraft(oversized, 'blueprint')
    expect(problems).toHaveLength(1)
    expect(problems[0]).toContain('512 KiB')
  })

  it('surfaces the #46 class through the draft gate', () => {
    const bad = { ...cleanDraft, 'values.schema.json': ISSUE_46_INGRESS_HOSTS_SCHEMA }
    expect(lintBlueprintDraft(bad, 'blueprint').join('\n')).toContain('[CRDGEN-DEFAULTS]')
  })

  it('REFUSES a draft without values.schema.json — it can be published and never installed', () => {
    // This asserted the opposite and pinned the defect: the lint returned [] when the schema was
    // absent, so the gate armed and the publish went through. core-provider then opens
    // values.schema.json to build the CRD and hard-errors, so the CompositionDefinition wedges at
    // Ready=False with "error getting spec schema" — several layers and one MERGE away from the
    // cause. The builder was happily shipping charts that could never become a CRD.
    const noSchema = { 'Chart.yaml': cleanDraft['Chart.yaml'], 'templates/cm.yaml': 'kind: ConfigMap\n' }

    expect(lintBlueprintDraft(noSchema, 'blueprint').join('\n')).toContain('values.schema.json is missing')
  })

  it('REFUSES a draft without Chart.yaml, rather than mistaking it for a page', () => {
    // `isPageDraft` is literally `!('Chart.yaml' in files)`, so a blueprint missing one was
    // reclassified as a portal PAGE and refused on an identity mismatch — a message about page
    // slugs, for a missing chart file.
    const noChart = { 'templates/cm.yaml': 'kind: ConfigMap\n', 'values.schema.json': '{"type":"object"}' }

    expect(lintBlueprintDraft(noChart, 'blueprint').join('\n')).toContain('Chart.yaml is missing')
  })

  it('REFUSES a chart name that cannot be a repository, a branch, a claim and a Kind', () => {
    const named = (name: string) => lintBlueprintDraft({ ...cleanDraft, 'Chart.yaml': `apiVersion: v2\nname: ${name}\nversion: 0.1.0\n` }, 'blueprint').join('\n')

    expect(named('Pg_App')).toContain('name "Pg_App": not a valid chart name')
    expect(named('-pg')).toContain('not a valid chart name')
    expect(named('a'.repeat(64))).toContain('not a valid chart name')
    // 63 is a legal LABEL, and used to pass here. It is not a legal blueprint: its Kind is 63, and
    // the CRD list type core-provider names after it cannot exist. See the identity block below.
    expect(named('a'.repeat(63))).toContain('the Kind (the name without dashes) can be at most 59')
    expect(named('"pg-app" # quoted, with a comment')).toBe('')
    expect(lintBlueprintDraft({ ...cleanDraft, 'Chart.yaml': 'apiVersion: v2\nversion: 0.1.0\n' }, 'blueprint').join('\n')).toContain('Chart.yaml has no name')
  })

  describe('the chart identity — the SAME rule Start runs, at the version Chart.yaml carries now', () => {
    const chart = (name: string, version: string) => `apiVersion: v2\nname: ${name}\nversion: ${version}\n`
    const lint = (name: string, version: string, kind: 'blueprint' | 'page') =>
      lintBlueprintDraft({ ...cleanDraft, 'Chart.yaml': chart(name, version) }, kind).join('\n')
    // Kind 42, which flect pluralises with one `s`: the controller container is <43>-v0-1-0-controller
    // = 61 characters. At 10.20.30 the same plural makes 64 — the budget there is 41.
    const FITS_ONLY_EARLY = `a${'b'.repeat(41)}`

    // krateoplatformops-blueprints charts at their released versions. Each deploys on a default
    // install (core-provider's cdc.metrics.enabled is false, so no metrics Service is created), and
    // each was refused here — unpreviewable, unholdable, unpublishable — by a rule that assumed it.
    it.each([
      ['github-scaffolding-with-composition-page', '1.2.2'],
      ['portal-composition-page-cloudnative-stack', '1.4.2'],
      ['portal-composition-page-continuous-deployment', '1.0.0'],
      // Marketplace blueprints whose Kinds (43, 44) only add `s`: a flat +3 for the plural refused them.
      ['aws-sagemaker-notebookinstancelifecycleconfig', '0.3.0'],
      ['aws-sagemaker-modelexplainabilityjobdefinition', '0.3.0'],
    ])('a real blueprint that deploys is not refused: %s@%s', (name, version) => {
      expect(lint(name, version, 'blueprint')).toBe('')
    })

    it('a held blueprint whose version was bumped past the budget is REFUSED, naming the container and the budget', () => {
      expect(lint(FITS_ONLY_EARLY, '0.1.0', 'blueprint')).toBe('')
      const bumped = lint(FITS_ONLY_EARLY, '10.20.30', 'blueprint')
      expect(bumped).toContain(`Chart.yaml name "${FITS_ONLY_EARLY}": at version 10.20.30 the Kind (the name without dashes) can be at most 41 characters`)
      expect(bumped).toContain('container <plural>-v10-20-30-controller,')
    })

    it('the SAME name on a PAGE draft is not — a page keeps the label check only (its version is the CHART_VERSION placeholder)', () => {
      expect(lint(FITS_ONLY_EARLY, '10.20.30', 'page')).toBe('')
      expect(lint(FITS_ONLY_EARLY, 'CHART_VERSION', 'page')).toBe('')
      expect(lint('a'.repeat(59), 'CHART_VERSION', 'page')).toBe('')
      expect(lint('Pg_App', 'CHART_VERSION', 'page')).toContain('name "Pg_App": not a valid chart name')
    })

    it('a PAGE set still obeys the version-independent rule — it is registered by a CompositionDefinition too', () => {
      // Its Kind comes from the name: a leading digit, or a Kind whose list type outgrows a label,
      // can never create its CRD, at any version.
      expect(lint('9-lives', 'CHART_VERSION', 'page')).toContain('must start with a letter')
      expect(lint('a'.repeat(60), 'CHART_VERSION', 'page')).toContain('the CRD\'s list type')
    })

    it('a blueprint version that is missing, not SemVer, or not an API version is refused as the VERSION', () => {
      expect(lintBlueprintDraft({ ...cleanDraft, 'Chart.yaml': 'apiVersion: v2\nname: pg-app\n' }, 'blueprint').join('\n')).toContain('Chart.yaml has no version')
      expect(lint('pg-app', 'CHART_VERSION', 'blueprint')).toContain('version "CHART_VERSION": a semantic version')
      // YAML reads 1.0 as the NUMBER 1 — read back as "1", and refused as the non-SemVer it is.
      expect(lint('pg-app', '1.0', 'blueprint')).toContain('version "1": a semantic version')
      expect(lint('pg-app', '1.0.0-RC.1', 'blueprint')).toContain('API version v1-0-0-RC-1')
    })
  })

  describe('the architecture file, when the chart carries one', () => {
    const descriptor = (resources: string) => [
      'apiVersion: architecture.krateo.io/v1alpha1',
      'kind: ChartArchitecture',
      'chart: pg-app',
      'resources:',
      resources,
    ].join('\n')
    const node = (id: string, dependsOn = '', extra: string[] = [`    name: printf "%s-${id}" .Release.Name`]) => [
      `  - id: ${id}`,
      '    class: native',
      '    apiVersion: v1',
      '    kind: ConfigMap',
      `    template: templates/${id}.yaml`,
      ...extra,
      ...(dependsOn ? [`    dependsOn: [{ ref: ${dependsOn} }]`] : []),
    ].join('\n')
    const withArch = (text: string, more: Record<string, string> = {}) =>
      lintBlueprintDraft({ ...cleanDraft, ...more, [ARCHITECTURE_TEMPLATE_PATH]: text }, 'blueprint').join('\n')
    const wrapped = (...nodes: string[]) => wrapAsConfigMapTemplate(descriptor(nodes.join('\n')), 'pg-app')

    it('passes a well-formed, acyclic descriptor', () => {
      expect(withArch(wrapped(node('a'), node('b', 'a')))).toBe('')
    })

    it('refuses a template that does not carry the descriptor where the readers look', () => {
      expect(withArch('apiVersion: v1\nkind: ConfigMap\n')).toContain('does not carry the descriptor in data.architecture')
    })

    it('names each descriptor problem by its path', () => {
      const problems = withArch(wrapAsConfigMapTemplate(descriptor('  - id: a\n    class: nonsense'), 'pg-app'))
      expect(problems).toContain('resources[0].class')
      expect(problems).toContain('resources[0].kind')
    })

    it('NEVER throws on a malformed dependsOn — this lint runs inside the draft broadcast', () => {
      // Each of these threw out of the kernel, and so out of every store write that held it: the
      // tree was replaced, nothing disarmed it, and no draft bus answered again.
      for (const dependsOn of ['db', '{ ref: a }', '[null]']) {
        const text = wrapAsConfigMapTemplate(descriptor(`${node('a')}\n    dependsOn: ${dependsOn}`), 'pg-app')
        expect(() => withArch(text)).not.toThrow()
        expect(withArch(text)).toContain(ARCHITECTURE_TEMPLATE_PATH)
      }
    })

    it('refuses a dependency cycle — a chart with one never leaves its first state', () => {
      expect(withArch(wrapped(node('a', 'b'), node('b', 'a')))).toMatch(/cycle \(.*→.*\)/)
    })

    describe('names and the graph block (L1–L5)', () => {
      const shim = node('legacy', '', ['    lifecycle: shim'])

      it('L1: a sequenced resource needs a name; a shim does not', () => {
        const problems = withArch(wrapped(node('a'), node('b', 'a', []), shim))
        expect(problems).toContain('resources[1].name — required on a sequenced resource')
        expect(problems).not.toContain('resources[2]')
      })

      it('L1: when the template names its object, the problem says with what', () => {
        const template = 'apiVersion: v1\nkind: ConfigMap\nmetadata:\n  name: {{ printf "%s-b" .Release.Name }}\n'
        expect(withArch(wrapped(node('b', '', [])), { 'templates/b.yaml': template })).toContain('templates/b.yaml names it printf "%s-b" .Release.Name.')
      })

      it('L2: the descriptor\'s chart must be Chart.yaml\'s name — the label and the graph carry it', () => {
        const other = wrapAsConfigMapTemplate(descriptor(node('a')).replace('chart: pg-app', 'chart: pg-other'), 'pg-app')
        expect(withArch(other)).toContain('chart — "pg-other" is not this chart: Chart.yaml names it "pg-app"')
      })

      it('L3: the graph block must be there, and be exactly what the descriptor compiles to', () => {
        const text = wrapped(node('a'), node('b', 'a'))
        const absent = text.slice(0, text.indexOf('{{- /* krateo:graph begin'))
        expect(unwrapFromConfigMapTemplate(absent)).toBe(unwrapFromConfigMapTemplate(text))
        expect(withArch(absent)).toContain('has no krateo:graph block after data.architecture')
        // A hand edit to the descriptor leaves the block behind…
        const handEdited = text.replace('    name: printf "%s-b" .Release.Name', '    name: printf "%s-bee" .Release.Name')
        expect(withArch(handEdited)).toContain('the krateo:graph block no longer matches data.architecture')
        // …and so does a hand edit to the block itself.
        expect(withArch(text.replace('"level" 1', '"level" 0'))).toContain('no longer matches data.architecture')
        // Both say how it comes back, in a way a person has: any save of the chart rewrites the block.
        expect(withArch(handEdited)).toContain('the composer rewrites it whenever the chart is saved — in Chart files, by the composer or by Autopilot. Apply any edit in Chart files to have it rewritten, or Undo.')
        expect(withArch(wrapAsConfigMapTemplate(unwrapFromConfigMapTemplate(handEdited)!, 'pg-app'))).toBe('')
      })

      it('L3 is a backstop: a save regenerates the block, and so does the parse of a tree Autopilot proposes', () => {
        const text = wrapped(node('a'), node('b', 'a'))
        const tree = { ...cleanDraft, [ARCHITECTURE_TEMPLATE_PATH]: text.replace('    name: printf "%s-b" .Release.Name', '    name: printf "%s-bee" .Release.Name') }
        expect(lintBlueprintDraft(tree, 'blueprint').join('\n')).toContain('no longer matches data.architecture')
        // What every write to a held chart does (the store), and what previewBlueprint's arg guard does
        // BEFORE the lint and the render, so the bytes rendered are the bytes held.
        expect(lintBlueprintDraft(regenerateArchitecture(tree), 'blueprint')).toEqual([])
        expect(parseRawTemplates(tree)).toEqual(regenerateArchitecture(tree))
        // A chart renamed in Chart.yaml and in the descriptor: the block and the label follow.
        const renamed = { ...cleanDraft, [ARCHITECTURE_TEMPLATE_PATH]: text.replace('chart: pg-app', 'chart: pg-renamed'), 'Chart.yaml': 'apiVersion: v2\nname: pg-renamed\nversion: 0.1.0\n' }
        expect(lintBlueprintDraft(renamed, 'blueprint').join('\n')).toContain('no longer matches data.architecture')
        expect(lintBlueprintDraft(regenerateArchitecture(renamed), 'blueprint')).toEqual([])
        expect(regenerateArchitecture(renamed)[ARCHITECTURE_TEMPLATE_PATH]).toContain('krateo.io/architecture: "pg-renamed"')
        // Nothing to regenerate is the same tree back.
        expect(regenerateArchitecture(cleanDraft)).toBe(cleanDraft)
      })

      it('L3: the block is compiled with Chart.yaml\'s name, not whatever the file was wrapped with', () => {
        expect(withArch(wrapAsConfigMapTemplate(descriptor(node('a')), 'pg-other'))).toContain('no longer matches data.architecture')
      })

      it('L4: a name must be the one its template gives the object — when the scan can tell', () => {
        const template = (name: string) => `apiVersion: v1\nkind: ConfigMap\nmetadata:\n  name: ${name}\nspec:\n  name: not-this\n`
        const text = wrapped(node('a'))
        expect(withArch(text, { 'templates/a.yaml': template('{{ printf "%s-a" .Release.Name }}') })).toBe('')
        expect(withArch(text, { 'templates/a.yaml': template('{{ printf "%s-other" .Release.Name | quote }}') }))
          .toContain('resources[0].name — templates/a.yaml names its object printf "%s-other" .Release.Name, not printf "%s-a" .Release.Name')
        // A variable assigned twice is not guessed at: no L4 either way.
        const twice = '{{- $n := "x" -}}\n{{- $n = "y" -}}\napiVersion: v1\nkind: ConfigMap\nmetadata:\n  name: {{ $n }}\n'
        expect(withArch(text, { 'templates/a.yaml': twice })).toBe('')
      })

      it('L4: inside a range or a with, the name that resolves where the block evaluates it is the one that passes', () => {
        const scoped = (open: string, name: string) => `${open}\n---\napiVersion: v1\nkind: ConfigMap\nmetadata:\n  name: {{ ${name} }}\n{{- end }}\n`
        const templates = {
          'templates/db.yaml': scoped('{{- with .Values.db }}', '.name'),
          'templates/items.yaml': scoped('{{- range .Values.items }}', 'printf "%s-%s" $.Release.Name .name'),
        }
        const text = wrapped(
          node('items', '', ['    name: printf "%s-%s" $.Release.Name $f.name', '    forEach: .Values.items']),
          node('db', '', ['    name: .Values.db.name', '    when: .Values.db']),
        )
        expect(withArch(text, templates)).toBe('')
      })

      it('L1/L4: a template named with the template action is matched by the include form — the one the block can evaluate', () => {
        const svc = { 'templates/svc.yaml': 'apiVersion: v1\nkind: Service\nmetadata:\n  name: {{ template "pg-app.fullname" . }}\n' }
        expect(withArch(wrapped(node('svc', '', [])), svc)).toContain('templates/svc.yaml names it include "pg-app.fullname" .')
        expect(withArch(wrapped(node('svc', '', ['    name: include "pg-app.fullname" .'])), svc)).toBe('')
        expect(withArch(wrapped(node('svc', '', ['    name: template "pg-app.fullname" .'])), svc)).toContain('resources[0].name — must name the object with include, not template')
      })

      it('L5: two sequenced resources cannot share a name — the page tells objects apart by it', () => {
        const same = ['    name: printf "%s-same" .Release.Name']
        const problems = withArch(wrapped(node('a', '', same), node('b', 'a', same)))
        expect(problems).toContain('resources[1].name — the same name as resources[0]')
        expect(problems).not.toContain('resources[0].name')
        // A shim is outside the sequence: sharing a name with one is not refused.
        const namedShim = node('legacy', '', [...same, '    lifecycle: shim'])
        expect(withArch(wrapped(node('a', '', same), namedShim))).toBe('')
      })

      it('L5, per item: no item of a ranged node may be named what another node names its one object', () => {
        const single = (id: string) => [`    name: ${placedNameExpression(id, false)}`]
        const ranged = (name: string) => [`    name: ${name}`, '    forEach: .Values.envs']
        // The bare index S4a first wrote: item 2 of `web` is `<release>-web-2`, which `web-2` names its object.
        const bare = 'printf "%s-%d" (printf "%s-web" $.Release.Name | trunc 56 | trimSuffix "-") (int $i)'
        expect(withArch(wrapped(node('web', '', ranged(bare)), node('web-2', '', single('web-2')))))
          .toContain('resources[0].name — one object per item of .Values.envs, and item 2 is named <release>-web-2, the name resources[1] (web-2) gives its object')
        // Whichever of the two comes first in the descriptor.
        expect(withArch(wrapped(node('web-10', '', single('web-10')), node('web', '', ranged(bare)))))
          .toContain('resources[1].name — one object per item of .Values.envs, and item 10 is named <release>-web-10, the name resources[0] (web-10) gives its object')
        // The composer's own per-item name never meets an id it hands out…
        expect(withArch(wrapped(node('web', '', ranged(placedNameExpression('web', true))), node('web-2', '', single('web-2'))))).toBe('')
        // …only a name written to meet it; and a name that is not an index (`-02`, `-2x`) is no item.
        expect(withArch(wrapped(node('web', '', ranged(placedNameExpression('web', true))), node('web-i0', '', single('web-i0'))))).toContain('item 0 is named <release>-web-i0')
        expect(withArch(wrapped(node('web', '', ranged(bare)), node('web-02', '', single('web-02')), node('web-2x', '', single('web-2x'))))).toBe('')
        // A shim is outside the sequence, as for L5 itself.
        expect(withArch(wrapped(node('web', '', ranged(bare)), node('web-2', '', [...single('web-2'), '    lifecycle: shim'])))).toBe('')
      })

      it('NEVER throws, whatever the templates hold', () => {
        const text = wrapped(node('a'))
        for (const template of ['', '{{', 'kind: X\nmetadata:\n  name: {{ $ }}\n', 'kind: X\nmetadata:\n  name: "{{ .a }}-{{ .b }}"\n']) {
          expect(() => withArch(text, { 'templates/a.yaml': template })).not.toThrow()
        }
      })
    })
  })

  it('reads the chart name ONCE — the lint and the identity cannot disagree', () => {
    const withName = (line: string) => ({ ...cleanDraft, 'Chart.yaml': `apiVersion: v2\n${line}\nversion: 0.1.0\n` })
    // A trailing comment: the lint passed it, and the identity fell back to "draft chart".
    expect(chartYamlName('name: pg-app # the app\n')).toBe('pg-app')
    expect(draftDisplayName(withName('name: pg-app # the app'))).toBe('pg-app')
    expect(lintBlueprintDraft(withName('name: pg-app # the app'), 'blueprint')).toEqual([])
    // A `#` with no space before it is part of the name, as in YAML — and not a valid one.
    expect(chartYamlName('name: a#b\n')).toBe('a#b')
    expect(lintBlueprintDraft(withName('name: a#b'), 'blueprint').join('\n')).toContain('name "a#b": not a valid chart name')
    expect(chartYamlName("name: 'pg-app'\r\n")).toBe('pg-app')
    expect(chartYamlName('name: "my chart"\n')).toBe('my chart')
    expect(chartYamlName('apiVersion: v2\n')).toBeNull()
    expect(chartYamlName('name: ""\n')).toBeNull()
    // A name on the next line is still YAML — and still what Helm reads.
    expect(chartYamlName('apiVersion: v2\nname:\n  pg-app\nversion: 0.1.0\n')).toBe('pg-app')
    expect(chartYamlName('name: [unclosed\n')).toBeNull()
    expect(chartYamlName(undefined)).toBeNull()
    // The version is read the same way: YAML, a trailing comment is a comment, a number is its string.
    expect(chartYamlVersion('name: pg-app\nversion: 0.1.0 # first\n')).toBe('0.1.0')
    expect(chartYamlVersion('version: "1.2.3"\n')).toBe('1.2.3')
    expect(chartYamlVersion('version: 2\n')).toBe('2')
    expect(chartYamlVersion('name: pg-app\n')).toBeNull()
    expect(chartYamlVersion('version: [unclosed\n')).toBeNull()
  })

  describe('[CDC-GLOBAL] a closed root must declare global (E6)', () => {
    // composition-dynamic-controller adds a top-level `global` to the values of EVERY render, and
    // Helm validates them against this schema first. A closed root that does not declare it previews,
    // publishes, merges, releases and registers — and then no composition of the chart renders.
    // test-mongodb-db found it that way (ea6aa3c).
    const withSchema = (schema: unknown, kind: 'blueprint' | 'page' = 'blueprint') =>
      lintBlueprintDraft({ ...cleanDraft, 'values.schema.json': JSON.stringify(schema) }, kind).join('\n')
    const closed = { additionalProperties: false, properties: { size: { type: 'string' } }, type: 'object' }

    it('REFUSES a blueprint whose root sets additionalProperties: false without declaring global', () => {
      const problems = withSchema(closed)
      expect(problems).toContain('[CDC-GLOBAL] values.schema.json')
      // The message names the CAUSE, so the author can see why a valid schema is refused.
      expect(problems).toMatch(/composition-dynamic-controller adds a top-level global block to the values of every render/)
    })

    it('accepts the same closed root once global is declared under properties', () => {
      expect(withSchema({ ...closed, properties: { ...closed.properties, global: { type: 'object' } } })).toBe('')
    })

    it('accepts an OPEN root, and a closed NESTED object — CDC injects nothing deeper', () => {
      expect(withSchema({ properties: { size: { type: 'string' } }, type: 'object' })).toBe('')
      expect(withSchema({ additionalProperties: true, properties: {}, type: 'object' })).toBe('')
      expect(withSchema({ properties: { db: { additionalProperties: false, properties: { name: { type: 'string' } }, type: 'object' } }, type: 'object' })).toBe('')
    })

    it('is a BLUEPRINT rule — a page draft is not refused for it', () => {
      // A page set's schema is written by the page builder, not by the person publishing it, so a
      // refusal here would name a file nobody authored. The generator declares global instead, and
      // generatedValuesSchemas.test.ts runs this same check on it. The schema here is closed WITHOUT
      // global on purpose: with the generator's own, this test would pass whatever the scope was.
      const pageDraft = { 'Chart.yaml': 'apiVersion: v2\nname: fleet\nversion: CHART_VERSION\n', 'values.schema.json': JSON.stringify(closed) }
      expect(lintBlueprintDraft(pageDraft, 'page').join('\n')).not.toContain('CDC-GLOBAL')
    })

    it('names invalid JSON once — the defaults lint already reports it', () => {
      expect(lintValuesSchemaRoot('{not json')).toEqual([])
      expect(lintBlueprintDraft({ ...cleanDraft, 'values.schema.json': '{not json' }, 'blueprint').filter((problem) => problem.includes('not valid JSON'))).toHaveLength(1)
    })
  })

  it('rawTemplatesByteSize measures UTF-8 bytes of paths + contents', () => {
    expect(rawTemplatesByteSize({ 'a.yaml': 'xy' })).toBe('a.yaml'.length + 2)
    expect(rawTemplatesByteSize({ 'é.yaml': 'é' })).toBe(Buffer.byteLength('é.yaml') + Buffer.byteLength('é'))
  })
})

describe('parseRawTemplates — the inline-args guard', () => {
  it('accepts a non-empty path→string map', () => {
    expect(parseRawTemplates({ 'Chart.yaml': 'name: x' })).toEqual({ 'Chart.yaml': 'name: x' })
  })

  it('denies empty maps, non-objects, blank paths and non-string contents', () => {
    expect(parseRawTemplates({})).toBeNull()
    expect(parseRawTemplates(undefined)).toBeNull()
    expect(parseRawTemplates(null)).toBeNull()
    expect(parseRawTemplates('Chart.yaml')).toBeNull()
    expect(parseRawTemplates([])).toBeNull()
    expect(parseRawTemplates({ ' ': 'content' })).toBeNull()
    expect(parseRawTemplates({ 'Chart.yaml': 42 })).toBeNull()
    expect(parseRawTemplates({ 'Chart.yaml': { name: 'x' } })).toBeNull()
  })
})

describe('draftDisplayName', () => {
  it('reads the chart name from Chart.yaml', () => {
    expect(draftDisplayName({ 'Chart.yaml': 'apiVersion: v2\nname: pg-app\nversion: 0.1.0\n' })).toBe('pg-app')
    expect(draftDisplayName({ 'Chart.yaml': 'name: "quoted-app"\n' })).toBe('quoted-app')
  })

  it('falls back to "draft chart" without a parseable name', () => {
    expect(draftDisplayName({})).toBe('draft chart')
    expect(draftDisplayName({ 'Chart.yaml': 'apiVersion: v2\n' })).toBe('draft chart')
  })
})

describe('buildFormSchemaText — the raw string the form preview mounts', () => {
  const draftSchemaText = '{"type":"object","properties":{"size":{"type":"string"}}}'

  it('prefers the VERBATIM draft file over the response schema (authoring order)', () => {
    const text = buildFormSchemaText({ 'values.schema.json': draftSchemaText }, { properties: {} }, undefined)
    expect(text).toBe(draftSchemaText)
  })

  it('falls back to the response valuesSchema in remote-chart mode', () => {
    const text = buildFormSchemaText(undefined, { properties: { size: { type: 'string' } }, type: 'object' }, undefined)
    expect(text).toBe(JSON.stringify({ properties: { size: { type: 'string' } }, type: 'object' }))
  })

  it('returns undefined on a render error, a schema-less response, or a non-object schema', () => {
    expect(buildFormSchemaText({ 'values.schema.json': draftSchemaText }, undefined, 'template: boom')).toBeUndefined()
    expect(buildFormSchemaText(undefined, undefined, undefined)).toBeUndefined()
    expect(buildFormSchemaText(undefined, 'not-a-schema', undefined)).toBeUndefined()
  })
})

describe('buildFormPreviewModel — the blueprint-formdef splice, client-side', () => {
  it('splices synthetic name + namespace as the FIRST properties, both required', () => {
    const model = buildFormPreviewModel(JSON.stringify({
      properties: { size: { title: 'Size', type: 'string' } },
      required: ['size'],
      type: 'object',
    }))
    expect(model).not.toBeNull()
    expect(Object.keys(model?.schema.properties ?? {})).toEqual(['name', 'namespace', 'size'])
    expect(model?.schema.required).toEqual(['name', 'namespace', 'size'])
  })

  it('collects "(should be hidden)" titles — the formdef hide convention — at any depth', () => {
    const model = buildFormPreviewModel(JSON.stringify({
      properties: {
        debug: { title: 'Debug flag (should be hidden)', type: 'boolean' },
        nested: {
          properties: { internal: { title: 'Internal (Should Be Hidden)', type: 'string' } },
          type: 'object',
        },
        size: { title: 'Size', type: 'string' },
      },
      type: 'object',
    }))
    expect(model?.hidden.sort()).toEqual(['debug', 'internal'])
  })

  it('returns null for unparseable, property-less or non-object schemas (no section)', () => {
    expect(buildFormPreviewModel('{ not json')).toBeNull()
    expect(buildFormPreviewModel(JSON.stringify({ type: 'object' }))).toBeNull()
    expect(buildFormPreviewModel(JSON.stringify({ properties: {}, type: 'object' }))).toBeNull()
    expect(buildFormPreviewModel(JSON.stringify(['not', 'a', 'schema']))).toBeNull()
  })
})
