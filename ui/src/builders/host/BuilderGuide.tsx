/**
 * THE BUILDER'S GUIDE — how a page, a blueprint or a controller gets built, above its canvas.
 *
 * The Builder carries it (`spec.guide`: a title and its steps), so whoever can read the Builder, which
 * is whoever can open this page, reads its guide: no second object, no grant of its own, no read of its
 * own. The steps used to sit on the builder's own page (/portal-builder's "How a page gets built"),
 * read once and then scrolled past on every visit.
 *
 * - A Builder with no guide has none: nothing is drawn.
 * - "Hide guide" puts it away for this Builder, in this browser (localStorage, best effort: a storage
 *   that throws or is empty only means the guide shows), and "Show how it gets built" brings it back.
 */
import { Button, Card } from 'antd'
import { useState } from 'react'

import Steps from '../../widgets/Steps/Steps'
import type { BuilderGuideSpec } from '../builderSpec'

import styles from './BuilderGuide.module.css'

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

export const BuilderGuide = ({ builderName, guide }: { builderName: string; guide?: BuilderGuideSpec }) => {
  const [hidden, setHidden] = useState(() => readHidden(builderName))
  if (!guide) {
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
      <Card
        extra={<Button onClick={() => toggle(true)} size='small' type='link'>Hide guide</Button>}
        size='small'
        title={<span className={styles.title}>{guide.title}</span>}
      >
        <Steps
          resourcesRefs={{ items: [] }}
          uid={`${builderName}-guide`}
          widgetData={{
            items: guide.steps.map((step, index) => ({ ...step, eyebrow: `Step ${index + 1}` })),
            orientation: 'horizontal',
          }}
        />
      </Card>
    </section>
  )
}

export default BuilderGuide
