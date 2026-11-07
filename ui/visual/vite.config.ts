import { fileURLToPath } from 'node:url'

import { mergeConfig, normalizePath, type Plugin } from 'vite'

import base from '../vite.config'

/**
 * The visual-regression harness build: the app's own Vite config (same plugins, same defines),
 * pointed at visual/index.html instead of the app.
 *
 * One thing differs on purpose. ui/index.css pulls Inter and JetBrains Mono from Google Fonts with
 * an `@import`; a screenshot that depends on a third-party fetch is a screenshot that flakes. The
 * harness loads the same faces from @fontsource instead (see main.tsx), so this strips the import.
 *
 * The file is matched by its RESOLVED path, not by a suffix. It used to match ids ending in
 * `/ui/index.css`, which holds in CI (the checkout has a `ui/` directory) but not in
 * visual/docker.sh, which mounts `ui/` itself at `/work`: there the id is `/work/index.css`, the
 * import survived, the container fetched the real Google faces, and local screenshots were taken
 * in different fonts from CI's. Resolving the path from this file works wherever the tree is mounted.
 */
const INDEX_CSS = normalizePath(fileURLToPath(new URL('../index.css', import.meta.url)))

const noRemoteFonts = (): Plugin => ({
  enforce: 'pre',
  name: 'visual-no-remote-fonts',
  transform: (code, id) =>
    (normalizePath(id.split('?')[0]) === INDEX_CSS ? code.replace(/@import url\('https:\/\/fonts\.googleapis\.com[^)]*\);?/, '') : undefined),
})

export default mergeConfig(base, {
  build: {
    outDir: 'dist-visual',
    rollupOptions: { input: 'visual/index.html' },
  },
  plugins: [noRemoteFonts()],
})
