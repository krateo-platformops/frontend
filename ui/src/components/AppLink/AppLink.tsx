/**
 * Links a widget renders from data: a page of this app goes through the router (same tab, no reload),
 * anything else opens in a new tab. Shared by Markdown and Descriptions so the rule is stated once.
 */
import type { ReactNode } from 'react'
import { Link, useInRouterContext } from 'react-router'

/** A path of this app (`/login`, `/blueprints/…`), not `//host` or `/\host`. */
export const isAppPath = (href: string | undefined): href is string => !!href && /^\/(?![/\\])/.test(href)

/**
 * A link to a page of this app (`/login`, `/compositions/…`): same tab, through the app's router,
 * so the page changes without a reload — as every link in the portal's own chrome does. It used to
 * open in a new tab like an external link, which split a public page's "Sign in" into a second tab.
 * Rendered outside a router (a bare test, a preview), it is a plain same-tab link.
 */
export const AppPathLink = ({ children, href }: { children: ReactNode; href: string }) => (
  useInRouterContext() ? <Link to={href}>{children}</Link> : <a href={href}>{children}</a>
)

/** A link from data: a page of this app through the router, anything else in a new tab. */
export const DataLink = ({ children, href }: { children: ReactNode; href: string }) => (
  isAppPath(href) ? <AppPathLink href={href}>{children}</AppPathLink> : <a href={href} rel='noopener noreferrer' target='_blank'>{children}</a>
)
