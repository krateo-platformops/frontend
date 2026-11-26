import { Result } from 'antd'
import { Link } from 'react-router'

import logoOnDark from '../../assets/images/logo_big.svg'
import logoOnLight from '../../assets/images/logo_black.png'
import { useRoutesContext } from '../../context/RoutesContext'
import { useThemeModeOrLight } from '../../context/ThemeModeContext'

import styles from './Page404.module.css'

const Page404 = () => {
  // The logo in the ink of the theme: the black mark on the light page, the white one on the dark
  // page, where the black mark was black on black (UX audit 404-1).
  const logo = useThemeModeOrLight() === 'dark' ? logoOnDark : logoOnLight
  // `/` opens the navigation's first page (the Menu redirects there), so the link names that page,
  // by the label the sidebar gives it: "Go to Dashboard". "Home page" is a name nothing else uses.
  const home = useRoutesContext().menuRoutes[0]?.title?.trim()
  return (
    <div className={styles.result}>
      <Result
        extra={<Link onClick={() => { window.location.href = '/' }} to=''>{home ? `Go to ${home}` : 'Go to the first page'}</Link>}
        icon={<img alt='Krateo | PlatformOps' src={logo} width={400} />}
        subTitle="We can't find the page you're looking for"
        title='404 Page not found'
      />
    </div>
  )
}

export default Page404
