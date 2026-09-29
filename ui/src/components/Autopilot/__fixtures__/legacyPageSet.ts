/**
 * A legacy page set as the sandbox holds it (from before draft records): a `page-fleet` root Flex,
 * its header, a Row holding a Table, the Table's RESTAction, and one ref to a widget that lives
 * elsewhere. The header carries no preview label. Shared by the adopt and legacy-Discard suites.
 */
import { vi } from 'vitest'

export const LEGACY_NS = 'krateo-preview'
const WIDGETS = 'widgets.templates.krateo.io/v1beta1'
export const PREVIEW_LABELS = { 'krateo.io/preview-session': 'unattributed', 'krateo.io/purpose': 'preview-draft' }

export const legacyPageSet: Record<string, Record<string, unknown>> = {
  'fleet-data': {
    apiVersion: 'templates.krateo.io/v1',
    kind: 'RESTAction',
    metadata: { labels: PREVIEW_LABELS, name: 'fleet-data', namespace: LEGACY_NS, resourceVersion: '9' },
    spec: { api: [{ name: 'nodes', path: '/api/v1/nodes' }] },
  },
  'fleet-header': {
    // No preview label: reached by the walk, adopted into the page, but not this adoption's to delete.
    apiVersion: WIDGETS,
    kind: 'PageHeader',
    metadata: { name: 'fleet-header', namespace: LEGACY_NS },
    spec: { resourcesRefs: { items: [] }, widgetData: { title: 'Fleet' } },
  },
  'fleet-row': {
    apiVersion: WIDGETS,
    kind: 'Row',
    metadata: { labels: PREVIEW_LABELS, name: 'fleet-row', namespace: LEGACY_NS },
    spec: { resourcesRefs: { items: [{ apiVersion: WIDGETS, id: 't', name: 'fleet-table', namespace: LEGACY_NS, resource: 'tables', verb: 'GET' }] }, widgetData: { items: [] } },
  },
  'fleet-table': {
    apiVersion: WIDGETS,
    kind: 'Table',
    metadata: { labels: PREVIEW_LABELS, name: 'fleet-table', namespace: LEGACY_NS },
    spec: { apiRef: { name: 'fleet-data', namespace: LEGACY_NS }, resourcesRefs: { items: [] }, widgetData: { columns: [] } },
    status: { widgetData: { resolved: true } },
  },
  'page-fleet': {
    apiVersion: WIDGETS,
    kind: 'Flex',
    metadata: {
      annotations: { 'krateo.io/nav-path': '/fleet', 'kubectl.kubernetes.io/last-applied-configuration': '{}' },
      creationTimestamp: '2026-09-18T10:00:00Z',
      labels: PREVIEW_LABELS,
      name: 'page-fleet',
      namespace: LEGACY_NS,
      uid: 'abc',
    },
    spec: {
      resourcesRefs: {
        items: [
          { apiVersion: WIDGETS, id: 'h', name: 'fleet-header', namespace: LEGACY_NS, resource: 'pageheaders', verb: 'GET' },
          { apiVersion: WIDGETS, id: 'r', name: 'fleet-row', namespace: LEGACY_NS, resource: 'rows', verb: 'GET' },
          // "Place existing": lives elsewhere, is not the page set's, and is never read.
          { apiVersion: WIDGETS, id: 'n', name: 'shared-notice', namespace: 'krateo-system', resource: 'paragraphs', verb: 'GET' },
        ],
      },
      widgetData: { items: [] },
    },
  },
}

/** A /call that serves `objects` by name, with per-name status overrides. */
export const serveLegacyPageSet = (overrides: Record<string, number> = {}, patch: Record<string, Record<string, unknown>> = {}) => vi.fn((input: string) => {
  const name = new URL(input).searchParams.get('name') ?? ''
  const status = overrides[name] ?? (legacyPageSet[name] ? 200 : 404)
  return Promise.resolve({ json: () => Promise.resolve(patch[name] ?? legacyPageSet[name]), ok: status === 200, status })
})
