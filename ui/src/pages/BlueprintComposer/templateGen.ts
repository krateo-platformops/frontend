/**
 * The template a placed node starts with — `templates/<id>.yaml`. Pure.
 *
 * WHAT IT WRITES, and why each part is there:
 *   the header      `krateo:placed <Kind> <apiVersion> (<class>)` — a Helm comment, so it renders
 *                   nothing. It is how the inspector knows the file was PLACED (and may offer to
 *                   set forEach on it), and what a reader of the chart sees first.
 *   metadata        the name expression (naming.ts) and the release namespace — a composition's
 *                   resources live in its own namespace.
 *   spec            for a custom resource or a composition, the CRD's REQUIRED fields with the empty
 *                   value of their type, and one `optional:` comment naming up to twelve of the rest
 *                   — a form to fill in, not a guess at values. For a native kind, a skeleton that
 *                   the apiserver would accept once its blanks are filled.
 *   forEach         when the node ranges, the document goes inside `range $i, $f := …` — a bare path
 *                   is ranged over directly, anything else is a named helper whose YAML list output is
 *                   ranged over (builder-publish's `include "builder-publish.files" $`).
 *
 * WHEN THE CRD COULD NOT BE READ the node is still placed, with `spec: {}` and a second header line
 * saying why — the person's placement is not refused over a read they cannot fix from here.
 */
import type { CrdSpecExtract, CrdSpecField } from '../../components/Autopilot/describeResource'

import type { ResourceClass } from './architecture'
import { placedNameExpression } from './naming'

/** What `planPlace` hands the generator: the node as the descriptor will hold it. */
export interface PlacedNode {
  id: string
  class: ResourceClass
  apiVersion: string
  kind: string
  forEach?: string
}

/** The marker the header carries — and the one `setForEach` looks for. */
export const PLACED_MARKER = 'krateo:placed'

/** How many optional fields the comment names before it says how many more there are. */
const OPTIONAL_SHOWN = 12

/** A Helm comment line. `*` + `/` inside it would end the comment early, so it cannot appear. */
const comment = (text: string): string => `{{- /* ${text.replace(/\*\//g, '* /')} */}}`

/** The empty value of a field's type — what the person replaces. */
const emptyValue = (field: CrdSpecField): string => {
  if (field.type === 'integer' || field.type === 'number') { return '0' }
  if (field.type === 'boolean') { return 'false' }
  if (field.type === 'object') { return '{}' }
  if (field.type === 'array') { return '[]' }
  return '""'
}

const specLines = (spec: CrdSpecExtract | null): string[] => {
  const fields = spec?.fields ?? []
  const required = fields.filter((field) => field.required)
  const optional = fields.filter((field) => !field.required).map((field) => field.name)
  const shown = optional.slice(0, OPTIONAL_SHOWN).join(', ')
  const more = optional.length > OPTIONAL_SHOWN ? ` … and ${optional.length - OPTIONAL_SHOWN} more` : ''
  const optionalNote = optional.length ? `# optional: ${shown}${more}` : ''
  if (!required.length) {
    return [optionalNote ? `spec: {} ${optionalNote}` : 'spec: {}']
  }
  return ['spec:', ...required.map((field) => `  ${field.name}: ${emptyValue(field)}`), ...(optionalNote ? [`  ${optionalNote}`] : [])]
}

const CONTAINER = ['- name: main', '  image: ""']

const indent = (lines: string[], by: number): string[] => lines.map((line) => `${' '.repeat(by)}${line}`)

/** A native kind's body — the parts the apiserver requires, with blanks where a value is the author's. */
const nativeSpec = (kind: string, name: string): string[] => {
  const selector = [`app.kubernetes.io/instance: ${name}`]
  switch (kind) {
    case 'Deployment':
    case 'StatefulSet':
      return [
        'spec:',
        ...(kind === 'StatefulSet' ? ['  serviceName: ""'] : []),
        '  replicas: 1',
        '  selector:',
        '    matchLabels:',
        ...indent(selector, 6),
        '  template:',
        '    metadata:',
        '      labels:',
        ...indent(selector, 8),
        '    spec:',
        '      containers:',
        ...indent(CONTAINER, 8),
      ]
    case 'Service':
      return ['spec:', '  selector: {}', '  ports:', '    - port: 80']
    case 'ConfigMap':
      return ['data: {}']
    case 'Secret':
      return ['type: Opaque', 'stringData: {}']
    case 'Ingress':
      return ['spec:', '  rules: []']
    case 'PersistentVolumeClaim':
      return ['spec:', '  accessModes:', '    - ReadWriteOnce', '  resources:', '    requests:', '      storage: 1Gi']
    case 'Job':
      return ['spec:', '  template:', '    spec:', '      restartPolicy: Never', '      containers:', ...indent(CONTAINER, 8)]
    case 'CronJob':
      return [
        'spec:', '  schedule: "0 * * * *"', '  jobTemplate:', '    spec:', '      template:', '        spec:',
        '          restartPolicy: OnFailure', '          containers:', ...indent(CONTAINER, 12),
      ]
    default:
      return ['spec: {}']
  }
}

/** What a forEach ranges over: a bare path directly, from the root; anything else as a named helper. */
export const rangeSource = (forEach: string): string =>
  (forEach.startsWith('.') ? `$${forEach}` : `(include "${forEach}" $ | fromYamlArray)`)

/** The line that opens a placed template's range. */
export const rangeLine = (forEach: string): string => `{{- range $i, $f := ${rangeSource(forEach)} }}`

/** The header lines — the marker, and the note when the CRD could not be read. */
export const placedHeader = (node: PlacedNode, specNote?: string): string[] => [
  comment(`${PLACED_MARKER} ${node.kind} ${node.apiVersion} (${node.class}) — written when it was placed; the rest of this file is yours.`),
  ...(specNote ? [comment(`Its CRD could not be read (${specNote}), so spec is empty — fill it in.`)] : []),
]

export const placedTemplate = (node: PlacedNode, { spec, specNote }: { spec: CrdSpecExtract | null; specNote?: string }): string => {
  const name = `{{ ${placedNameExpression(node.id, !!node.forEach)} }}`
  const body = [
    `apiVersion: ${node.apiVersion}`,
    `kind: ${node.kind}`,
    'metadata:',
    `  name: ${name}`,
    '  namespace: {{ $.Release.Namespace }}',
    ...(node.class === 'native' ? nativeSpec(node.kind, name) : specLines(specNote ? null : spec)),
  ]
  const document = node.forEach ? [rangeLine(node.forEach), '---', ...body, '{{- end }}'] : body
  return `${[...placedHeader(node, specNote), ...document].join('\n')}\n`
}
