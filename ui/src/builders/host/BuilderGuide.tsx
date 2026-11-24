/**
 * THE BUILDER'S GUIDE — how a page, a blueprint or a controller gets built, at the top of its composer.
 *
 * The Builder names it (`spec.portal.guideCard`), and the portal owns it: a Card widget in the
 * builder's page namespace, its steps and words included. The composer only mounts it. The steps used
 * to sit on the builder's own page (/portal-builder's "How a page gets built"), read once and then
 * scrolled past on every visit; the page is now a dashboard of what was built and what waits on
 * someone, and the steps are here, beside the canvas they explain.
 *
 * - A Builder that names no guide has none: nothing is drawn, and nothing is fetched.
 * - "Hide guide" puts it away for this Builder, in this browser (localStorage, best effort: a storage
 *   that throws or is empty only means the guide shows), and "Show how it gets built" brings it back.
 * - Only under the app's providers (FiltersProvider, which every WidgetRenderer needs): a composer
 *   mounted bare shows no guide.
 * - The Card mounts in the CHROME scope (WidgetScopeContext): the composer's route has a query
 *   (`?resume=`, `?adopt=`) that is not the guide's, so it never enters the guide's extras and never
 *   partitions its cache cell.
 */
import { Button } from 'antd'
import { useContext, useState } from 'react'

import { useInFiltersProvider } from '../../components/FiltesProvider/FiltersProvider'
import WidgetRenderer from '../../components/WidgetRenderer'
import { ConfigContext } from '../../context/ConfigContext'
import { WidgetScopeProvider } from '../../context/WidgetScopeContext'
import { getResourceEndpoint } from '../../utils/utils'
import type { NamespacedRef } from '../builderSpec'

import styles from './BuilderGuide.module.css'

const WIDGETS_API_VERSION = 'widgets.templates.krateo.io/v1beta1'

/** The localStorage key that remembers a Builder's guide was hidden. */
export const guideHiddenKey = (builderName: string): string => `krateo.builder-guide.hidden.${builderName}`

const readHidden = (builderName: string): boolean => {
  try {
    return window.localStorage.getItem(guideHiddenKey(builderName)) === 'true'
  } catch {
    return false
  }
}

const writeHidden = (builderName: string, hidden: boolean): void => {
  try {
    if (hidden) {
      window.localStorage.setItem(guideHiddenKey(builderName), 'true')
    } else {
      window.localStorage.removeItem(guideHiddenKey(builderName))
    }
  } catch {
    // Not remembered: the guide shows again on the next visit, which is the safe side.
  }
}

/** The `/call` read of a guide Card: its own namespace, or the frontend's when it names none. */
export const guideEndpoint = (guide: NamespacedRef, frontendNamespace: string | undefined): string | null => {
  const namespace = guide.namespace ?? frontendNamespace
  return namespace ? getResourceEndpoint({ apiVersion: WIDGETS_API_VERSION, name: guide.name, namespace, resource: 'cards' }) : null
}

export const BuilderGuide = ({ builderName, guide }: { builderName: string; guide?: NamespacedRef }) => {
  // `useContext`, not a throwing hook: a composer mounts bare in tests and degrades without config.
  const frontendNamespace = useContext(ConfigContext)?.config?.params?.FRONTEND_NAMESPACE
  // A widget tree renders under the app's providers; a composer mounted bare (its tests) has none,
  // and shows no guide rather than a widget that cannot render.
  const canRender = useInFiltersProvider()
  const [hidden, setHidden] = useState(() => readHidden(builderName))
  const endpoint = guide ? guideEndpoint(guide, frontendNamespace) : null
  if (!endpoint || !canRender) {
    return null
  }
  const toggle = (next: boolean) => {
    writeHidden(builderName, next)
    setHidden(next)
  }
  if (hidden) {
    return (
      <div className={styles.shown}>
        <Button onClick={() => toggle(false)} size='small' type='link'>Show how it gets built</Button>
      </div>
    )
  }
  return (
    <section aria-label='How it gets built' className={styles.guide}>
      <WidgetScopeProvider scope='chrome'>
        <WidgetRenderer widgetEndpoint={endpoint} />
      </WidgetScopeProvider>
      {/* Over the Card's head, where its `extra` would sit: the Card is the portal's, the link is ours. */}
      <Button className={styles.hide} onClick={() => toggle(true)} size='small' type='link'>Hide guide</Button>
    </section>
  )
}

export default BuilderGuide
