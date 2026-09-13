import { createContext, useContext, useMemo } from 'react'
import type { ReactNode } from 'react'

/**
 * The chain of widget endpoints currently being rendered, innermost last.
 *
 * WHY THIS EXISTS. Widgets render other widgets: `Flex`, `Card`, `Tabs`, `Form`, `Layout`,
 * `ButtonGroup`, `Filters` and `Drawer` all mount a nested `WidgetRenderer` for each child they
 * resolve. Nothing bounded that. A CR whose `resourcesRefs` points back at an ancestor — directly
 * (`a → a`) or through a cycle (`a → b → a`) — recursed until the browser's stack gave out, which
 * is a white page with a console trace nobody outside the frontend team can read.
 *
 * It is not a hypothetical authoring mistake. A cycle is two CRs each naming the other, in
 * different files, each correct in isolation; nothing in the CRD, the dry-run or the chart lint
 * can see it, because neither CR is wrong on its own.
 *
 * TWO BOUNDS, because they fail differently:
 *
 *   - a REPEATED endpoint in the chain is a cycle, and can be named precisely. That is the useful
 *     error: it tells the author which two CRs point at each other.
 *   - a chain that is merely very deep may be legitimate-but-absurd rather than cyclic, so it gets
 *     a depth cap with a vaguer message. 32 is far past any real page and far short of a
 *     stack overflow. Calibrated by measuring: a DFS over all 511 CRs and 450 child edges in the
 *     portal chart finds zero cycles and a deepest real chain of NINE levels, so the cap leaves
 *     roughly 3.5x headroom over the deepest composition anyone has actually authored.
 */
const RenderChainContext = createContext<readonly string[]>([])

/** How deep widget nesting may go before we assume something is wrong. */
export const MAX_RENDER_DEPTH = 32

export const useRenderChain = () => useContext(RenderChainContext)

/** The CR name out of a widget endpoint, for an error a chart author can act on. */
export const shortName = (endpoint: string): string => {
  const match = (/[?&]name=([^&]+)/).exec(endpoint)
  return match ? decodeURIComponent(match[1]) : 'another widget'
}

/**
 * What a renderer should do before rendering `endpoint`: `'render'`, or a reason not to.
 * Pure and separately testable — the decision never touches React.
 */
export const inspectChain = (chain: readonly string[], endpoint: string | undefined): { reason: string; verdict: 'cycle' | 'too-deep' } | { verdict: 'render' } => {
  if (endpoint && chain.includes(endpoint)) {
    const from = chain[chain.length - 1]
    return {
      reason: from && from !== endpoint
        ? `This widget and ${shortName(from)} reference each other, so rendering one renders the other forever.`
        : 'This widget references itself, so rendering it would never finish.',
      verdict: 'cycle',
    }
  }
  if (chain.length >= MAX_RENDER_DEPTH) {
    return { reason: `Widgets are nested more than ${MAX_RENDER_DEPTH} deep here, which is almost always a reference loop.`, verdict: 'too-deep' }
  }
  return { verdict: 'render' }
}

export const RenderChainProvider = ({ children, endpoint }: { children: ReactNode; endpoint: string | undefined }) => {
  const parent = useRenderChain()
  const value = useMemo(() => (endpoint ? [...parent, endpoint] : parent), [parent, endpoint])
  return <RenderChainContext.Provider value={value}>{children}</RenderChainContext.Provider>
}
