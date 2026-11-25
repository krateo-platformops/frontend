/**
 * The empty-image lint: a container image left empty is named before Preview; a bare `image:` whose
 * value starts on the next line is not empty (a CRD's object `image`, a Pod image volume, a template).
 */
import { describe, expect, it } from 'vitest'

import { lintBlueprintDraft } from './blueprintDraft'

describe('lintBlueprintDraft — an empty container image', () => {
  const chart = {
    'Chart.yaml': 'apiVersion: v2\nname: pg-app\nversion: 0.1.0\n',
    'values.schema.json': JSON.stringify({ properties: {}, type: 'object' }),
  }
  const images = (template: string) => lintBlueprintDraft({ ...chart, 'templates/x.yaml': template }, 'blueprint')
    .filter((problem) => problem.includes('a container image is empty'))
    .map((problem) => problem.split(':')[1])

  it('names an image left empty, bare or quoted', () => {
    expect(images('containers:\n  - name: a\n    image: ""\n  - name: b\n    image:\n    ports: []\n  - name: c\n    image: \'\' # todo\n')).toEqual(['3', '5', '8'])
    expect(images('spec:\n  containers:\n    - image:\n')).toEqual(['3'])
  })

  it('leaves alone an image whose value starts on the next line', () => {
    // A CRD's object `image` (Metal3), a Pod image volume, a sequence at the key's column, a template action.
    expect(images('spec:\n  image:\n    url: http://x/img.qcow2\n    checksum: abc\n')).toEqual([])
    expect(images('volumes:\n  - name: v\n    image:\n      # the OCI artifact\n\n      reference: quay.io/x:1\n')).toEqual([])
    expect(images('images:\n  image:\n  - a\n')).toEqual([])
    expect(images('spec:\n  image:\n{{ toYaml .Values.image | indent 4 }}\n')).toEqual([])
    expect(images('    image: {{ .Values.image | quote }}\n')).toEqual([])
  })
})
