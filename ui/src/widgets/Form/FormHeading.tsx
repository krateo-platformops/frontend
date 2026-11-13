import { Typography } from 'antd'

import { brandHeadingClass, brandTitleClass, InstallationLine } from '../../components/BrandFrame'

import styles from './Form.module.css'

/**
 * The Form's `title`, above its fields. It is the form's own, so it goes with the form when a
 * Result replaces it.
 *
 * Inside a Card's `brand` frame it is the sign-in card's heading: the page's one heading (level 1,
 * as the sign-in card's "Sign in" is), in the display face, with the installation line ("to Krateo
 * PlatformOps · <installation>", from the frontend's config) under it — both from
 * components/BrandFrame, so they are the sign-in card's own. The line goes with the heading.
 */
export const FormHeading = ({ brand, installationName, title }: { brand: boolean; installationName?: string; title: string }) => {
  if (!brand) {
    return <Typography.Title className={styles.title} level={3}>{title}</Typography.Title>
  }
  return (
    <div className={brandHeadingClass}>
      <Typography.Title className={brandTitleClass} level={1}>{title}</Typography.Title>
      <InstallationLine installationName={installationName} />
    </div>
  )
}
