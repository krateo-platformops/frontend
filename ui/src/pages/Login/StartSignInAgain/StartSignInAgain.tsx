import type { To } from 'react-router'
import { Link } from 'react-router'

type StartSignInAgainProps = {
  /*
   * What else starting over takes on the page that renders this. The callback page needs nothing:
   * its link leaves for /login, which mounts a fresh sign-in. The login page IS /login, so following
   * the link mounts nothing new, and the failed attempt it shows has to be cleared here.
   */
  onClick?: () => void
  /** Where the sign-in starts over. Defaults to the login page. */
  to?: To
}

/**
 * The "Start the sign-in again" action, for a sign-in attempt that did not finish and that the
 * person can retry themselves. One component so the callback page (Auth.tsx, on every `restart`)
 * and the login page (Login.tsx, when its sign-in call got no answer) offer the same action in the
 * same words.
 */
const StartSignInAgain = ({ onClick, to = '/login' }: StartSignInAgainProps) => (
  <Link onClick={onClick} to={to}>Start the sign-in again</Link>
)

export default StartSignInAgain
