/**
 * What each widget kind may hold: the `allowedResources` enum on its CRD, BY ROLE.
 *
 * This is the kind-level half of containment. It answers "can this kind ever hold that?". The
 * instance-level half stays where it was: a CR's own `allowedResources` says what that one slot is
 * for, and rule X5 checks its real children against it.
 *
 * ONE TABLE, AND THE GENERAL LISTS ARE DERIVED. The per-widget enums that used to sit in the schemas
 * failed by drifting: six frozen lists, one edit per new widget, and `Menu` naming two retired kinds
 * and nothing it held. So nothing here enumerates the general case: a general layout takes every
 * widget plural the CRDs declare, minus `NOT_A_CHILD`, and a new widget joins by existing. Only a
 * purpose-built kind lists anything, because only there is the narrowness the point.
 *
 * BY ROLE, NOT BY USAGE. Live usage is a floor, not a design: a Flex holds 25 plurals today and
 * nothing is wrong with one holding a QR code. A list of what happens to be in use would refuse
 * valid pages until a CRD release. Upstream's lists had the same shape: Row, Column, Page and
 * TabList took nearly every content widget, while NavMenu and RoutesLoader took one.
 *
 * RETIRED PLURALS STAY ON THE GENERAL KINDS. A live CR naming one has to stay writable, and they
 * cost a few enum values (see LEGACY_ALLOWED_RESOURCES in gen-crds.ts).
 */

/** Holds any widget. Real usage says so, and a layout has no business deciding its content. */
export const GENERAL_LAYOUTS: readonly string[] = ['Card', 'Col', 'Collapse', 'Flex', 'Row', 'Steps', 'Tabs']

/** In the vocabulary, but never a child: a `Layout` is a page's shell and a `Theme` renders nothing. */
export const NOT_A_CHILD: readonly string[] = ['layouts', 'themes']

const INPUT_WIDGETS = [
  'checkboxes', 'datepickers', 'inputnumbers', 'inputs', 'radios', 'rangepickers', 'selects', 'sliders', 'switches',
]

/** Each exists for one job, so its list IS the rule. Every value is checked at generation. */
export const PURPOSE_BUILT: Readonly<Record<string, readonly string[]>> = {
  ButtonGroup: ['buttons'],
  Filters: INPUT_WIDGETS,
  Form: [...INPUT_WIDGETS, 'uploads'],
  // `navmenuitems` and `pages` are retired, and stay for the reason above.
  Menu: ['flexes', 'navmenuitems', 'pages'],
  PageHeader: ['buttongroups', 'buttons', 'flexes'],
  // Table cells (`kind: widget`). Tables resolve these through `columns`/`dataSource`, not `items`.
  Table: [
    'barcharts', 'buttongroups', 'buttons', 'filters', 'flowcharts', 'linecharts', 'markdowns', 'paragraphs',
    'piecharts', 'rangepickers', 'yamlviewers',
  ],
}

/**
 * Their `items` are plain data (a crumb's title, a label/value pair), so they resolve no children
 * and a declaration on them could only mislead. They carry no `allowedResources` at all.
 */
export const HOLDS_NOTHING: readonly string[] = ['Breadcrumb', 'Descriptions']

/**
 * The enum for one container kind. Throws rather than guessing, because a wrong list here is a valid
 * CRD that refuses real pages: a new container has to be given a role, and a purpose-built list may
 * only name what exists.
 */
export const containmentFor = (kind: string, vocabulary: readonly string[]): string[] => {
  if (GENERAL_LAYOUTS.includes(kind)) {
    return vocabulary.filter((plural) => !NOT_A_CHILD.includes(plural))
  }
  const list = PURPOSE_BUILT[kind]
  if (!list) {
    throw new Error(`${kind} declares allowedResources but has no role: add it to scripts/containment.ts`)
  }
  const unknown = list.filter((plural) => !vocabulary.includes(plural))
  if (unknown.length) {
    throw new Error(`${kind} lists ${unknown.join(', ')}, which no widget CRD declares`)
  }
  return [...list].sort()
}
