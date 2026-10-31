import type { WidgetProps } from '../types/Widget'

/**
 * The contract every registry widget exposes as the default export of its
 * `index.ts`. The auto-registry (`registry.ts`) discovers these via
 * `import.meta.glob`, so adding a widget no longer requires editing
 * `WidgetRenderer`.
 */
export interface WidgetModule<T = unknown> {
  /** The `kind` discriminator matching the backend Widget CR `kind`. */
  kind: string
  /** The React component that renders the widget. */
  component: React.ComponentType<WidgetProps<T>>
  /** When true, `WidgetRenderer` wraps the component in `ScrollPagination`. */
  paginated?: boolean
  /**
   * Navigation/structural resource (routing, page shell) — NOT an antd-mapped
   * widget. Still resolved by `WidgetRenderer`, but excluded from the antd
   * `widgetRegistry` (the antd-fidelity set). See docs/widget-authoring.md.
   */
  structural?: boolean
}

/** Identity helper that preserves the generic while enforcing the shape. */
export const defineWidget = <T >(module: WidgetModule<T>): WidgetModule<T> => module
