import { mergeConfig, type Plugin } from 'vite'

import base from '../vite.config'

/**
 * The visual-regression harness build: the app's own Vite config (same plugins, same defines),
 * pointed at visual/index.html instead of the app.
 *
 * One thing differs on purpose. ui/index.css pulls Inter and JetBrains Mono from Google Fonts with
 * an `@import`; a screenshot that depends on a third-party fetch is a screenshot that flakes. The
 * harness loads the same faces from @fontsource instead (see main.tsx), so this strips the import.
 */
const noRemoteFonts = (): Plugin => ({
  enforce: 'pre',
  name: 'visual-no-remote-fonts',
  transform: (code, id) =>
    (id.endsWith('/ui/index.css') ? code.replace(/@import url\('https:\/\/fonts\.googleapis\.com[^)]*\);?/, '') : undefined),
})

export default mergeConfig(base, {
  build: {
    outDir: 'dist-visual',
    rollupOptions: { input: 'visual/index.html' },
  },
  plugins: [noRemoteFonts()],
})
