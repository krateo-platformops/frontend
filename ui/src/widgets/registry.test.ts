import yaml from 'js-yaml'
import { describe, expect, it } from 'vitest'

import './load'

import { getStructuralRegistry, getWidgetModule, getWidgetRegistry } from './registry'

const widgetRegistry = getWidgetRegistry()

/** Raw contents of every example fixture, loaded through Vite's glob import. */
const exampleFiles = import.meta.glob<string>('../examples/widgets/**/*.example.yaml', {
  eager: true,
  import: 'default',
  query: '?raw',
})

// Fixtures also contain non-widget CRs (e.g. RESTAction on templates.krateo.io)
// referenced by Form/Button examples — only collect actual widget CRs.
const exampleKinds = new Set<string>()
for (const raw of Object.values(exampleFiles)) {
  const docs = yaml.loadAll(raw) as Array<{ kind?: unknown; apiVersion?: unknown } | null>
  for (const doc of docs) {
    if (doc && typeof doc.kind === 'string' && typeof doc.apiVersion === 'string'
      && doc.apiVersion.includes('widgets.templates.krateo.io')) {
      exampleKinds.add(doc.kind)
    }
  }
}

/** Every antd-mapped widget kind (legacy aliases removed; structural kinds excluded). */
const KNOWN_KINDS = [
  'BarChart', 'Button', 'ButtonGroup', 'Card', 'Col',
  'Filters', 'Flex', 'FlowChart', 'Form', 'LineChart', 'Listy', 'Markdown',
  'Menu', 'Paragraph', 'PieChart', 'Row',
  'Table', 'Tabs', 'YamlViewer',
]

/**
 * Structural (non-antd) kinds resolved by WidgetRenderer. Route/RoutesLoader/NavMenu
 * and finally Page have all been removed: routing is now data — the sidebar Menu's
 * inline items are the single route source (no routes-loader, no Page wrapper).
 */
const STRUCTURAL_KINDS: string[] = []

describe('widgetRegistry', () => {
  it('registers all known registry kinds (regression gate for the switch removal)', () => {
    for (const kind of KNOWN_KINDS) {
      expect(widgetRegistry[kind], `kind "${kind}" should be registered`).toBeDefined()
      // A component may be a function OR a React exotic object (lazy/memo/forwardRef);
      // the chart widgets use React.lazy() for code-splitting, so accept both.
      expect(['function', 'object']).toContain(typeof widgetRegistry[kind].component)
    }
  })

  it('resolves a module for every kind used in example fixtures', () => {
    expect(exampleKinds.size).toBeGreaterThan(0)
    for (const kind of exampleKinds) {
      // resolve-all: antd widgets AND structural kinds
      expect(getWidgetModule(kind), `example kind "${kind}" should resolve`).toBeDefined()
    }
  })

  it('has NO structural kinds today — asserted, rather than looped over vacuously', () => {
    /*
     * This iterated STRUCTURAL_KINDS, which is `[]`. A loop over an empty list passes without
     * asserting anything, so the suite reported coverage of a segregation nothing exercised — and
     * the flag it guards is declared by none of the 46 widget modules.
     *
     * That is deliberate and documented in registry.ts: Page/Route/RoutesLoader/NavMenu were
     * removed because routing is data, and the hook is kept so a future non-antd kind can opt out.
     * So the honest assertion is that the set is EMPTY. The day something declares `structural`,
     * this fails and whoever added it writes the segregation test that was always implied.
     */
    expect(getStructuralRegistry()).toEqual({})
    expect(STRUCTURAL_KINDS).toHaveLength(0)
  })

  it('segregates any structural kind that IS declared, keeping it resolvable', () => {
    // Vacuous today, by construction — and it is the test STRUCTURAL_KINDS exists for, so it stays
    // beside the assertion above rather than disappearing with the empty list.
    for (const kind of STRUCTURAL_KINDS) {
      expect(widgetRegistry[kind], `structural "${kind}" must NOT be an antd widget`).toBeUndefined()
      expect(getWidgetModule(kind), `structural "${kind}" must still resolve for rendering`).toBeDefined()
    }
  })

  it('marks Listy as paginated', () => {
    expect(widgetRegistry.Listy?.paginated).toBe(true)
  })

  it('does not resolve legacy kind aliases (hard-break)', () => {
    for (const legacy of ['Panel', 'Column', 'TabList', 'NavMenu', 'DataGrid']) {
      expect(widgetRegistry[legacy], `legacy kind "${legacy}" must no longer resolve`).toBeUndefined()
    }
  })

  it('excludes Drawer and Modal (mounted directly by WidgetPage, not via the registry)', () => {
    expect(widgetRegistry.Drawer).toBeUndefined()
    expect(widgetRegistry.Modal).toBeUndefined()
  })
})
