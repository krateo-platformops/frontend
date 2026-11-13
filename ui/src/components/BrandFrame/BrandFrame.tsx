/**
 * The sign-in card's brand, as parts any surface can draw: the band with the logo, and the
 * "to Krateo PlatformOps · <installation>" line under a heading.
 *
 * WHERE THE BRAND COMES FROM. The frontend's own config, `config.login` (ConfigMap-mountable per
 * install, read before any backend identity): the logo and its alt, falling back to the bundled
 * mark, and the installation's name. Never from a widget CR — a page cannot claim to be another
 * installation. The sign-in page (pages/Login) and the Card widget's `brand` frame both draw these,
 * so a branded page reads as the same installation the sign-in card names.
 *
 * The config is read without the throwing hook: a branded Card rendered with no ConfigProvider
 * above it (a test, a preview) draws the bundled logo and the bare product line.
 */
import { createContext, useContext } from 'react'

import logo from '../../assets/images/logo_big.svg'
import { type Config, ConfigContext } from '../../context/ConfigContext'

import styles from './BrandFrame.module.css'

export const DEFAULT_LOGO_ALT = 'Krateo | PlatformOps'

export interface Brand {
  logoAlt: string
  logoSrc: string
  /** absent when the install sets none */
  installationName?: string
}

/** The brand `config.login` sets, with the bundled logo and alt in place of any it leaves out. */
export const brandOf = (branding: Config['login']): Brand => ({
  installationName: branding?.installationName?.trim() || undefined,
  logoAlt: branding?.logoAlt ?? DEFAULT_LOGO_ALT,
  logoSrc: branding?.logoUrl || logo,
})

/** `brandOf` the config above, or the bundled brand when there is none. */
export const useBrand = (): Brand => brandOf(useContext(ConfigContext)?.config?.login)

/** The brand gradient band, carrying the logo. */
export const BrandBand = ({ logoAlt, logoSrc }: Pick<Brand, 'logoAlt' | 'logoSrc'>) => (
  <div className={styles.band}>
    <img alt={logoAlt} className={styles.logo} src={logoSrc} />
  </div>
)

/** "to Krateo PlatformOps", followed by the installation's name when the install sets one. */
export const InstallationLine = ({ installationName }: Pick<Brand, 'installationName'>) => (
  <p className={styles.to}>
    to Krateo PlatformOps
    {installationName && <> · <span className={styles.installation}>{installationName}</span></>}
  </p>
)

/** The class of the brand's display-face heading. */
export const brandTitleClass = styles.title

/** The class of a block holding the heading and the installation line, in a container with its own gap. */
export const brandHeadingClass = styles.heading

/**
 * Whether the content is inside a branded frame (the Card widget's `brand`). A widget that draws a
 * heading — the Form's `title` — draws it as the brand heading, with the installation line under
 * it, so the line goes with the heading when a Result replaces the form, as the sign-in card's
 * heading and line go together.
 */
export const BrandFrameContext = createContext(false)
