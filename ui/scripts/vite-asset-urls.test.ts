// @vitest-environment node
/**
 * The built bundle writes JS- and CSS-side asset URLs relative to the file that references them,
 * and leaves index.html's own tags root-absolute. See `renderBuiltUrl` in ../vite.config.ts for why
 * both halves matter (sub-path hosting vs nginx deep links).
 *
 * This builds a small fixture with the app's real Vite config, not the whole app: one imported
 * image, one lazy chunk that carries its own CSS (the shape of the Bar/Line/Pie chart widgets,
 * whose CSS goes through the preload helper), and one CSS `url()`. The image is larger than Vite's
 * 4 KiB inline limit, so it is emitted as a file and not inlined as a data URL, which would hide
 * the URL entirely.
 *
 * Controls: drop `experimental.renderBuiltUrl` from vite.config.ts and the four JS/CSS assertions
 * fail, because the default base `/` writes `/assets/...` into the chunks and the CSS, and
 * `"/"+dep` into the preload helper. Set `base: './'` instead and those four pass but the
 * index.html assertion fails, which is the deep-link breakage this avoids.
 */
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { build, mergeConfig } from 'vite'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import appConfig from '../vite.config'

let root: string
let html: string
let js: Record<string, string>
let css: Record<string, string>

const readAll = (dir: string, ext: string) =>
  Object.fromEntries(
    readdirSync(dir)
      .filter((name) => name.endsWith(ext))
      .map((name) => [name, readFileSync(join(dir, name), 'utf-8')]),
  )

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), 'vite-asset-urls-'))
  // Not a real PNG: Vite emits asset bytes as they are, and only the size decides file vs data URL.
  writeFileSync(join(root, 'mascot.png'), Buffer.alloc(8192, 1))
  writeFileSync(join(root, 'texture.png'), Buffer.alloc(8192, 2))
  writeFileSync(join(root, 'index.html'), '<!doctype html><html><body><script type="module" src="/main.js"></script></body></html>')
  writeFileSync(
    join(root, 'main.js'),
    "import mascot from './mascot.png'\ndocument.body.dataset.mascot = mascot\nimport('./chart.js').then((m) => m.draw())\n",
  )
  writeFileSync(join(root, 'chart.js'), "import './chart.css'\nexport const draw = () => document.body.append('chart')\n")
  writeFileSync(join(root, 'chart.css'), '.chart { background: url(./texture.png) }\n')

  await build(
    mergeConfig(appConfig, {
      build: { emptyOutDir: true, outDir: join(root, 'dist') },
      configFile: false,
      logLevel: 'silent',
      root,
    }),
  )

  html = readFileSync(join(root, 'dist', 'index.html'), 'utf-8')
  js = readAll(join(root, 'dist', 'assets'), '.js')
  css = readAll(join(root, 'dist', 'assets'), '.css')
}, 60000)

afterAll(() => {
  rmSync(root, { force: true, recursive: true })
})

describe('built asset URLs', () => {
  it('keeps index.html root-absolute, so an nginx deep link that falls back to it still loads the entry', () => {
    expect(html).toMatch(/<script type="module" crossorigin src="\/assets\/index-[\w-]+\.js"><\/script>/)
  })

  it('writes no root-absolute /assets/ URL into any JS chunk', () => {
    const offenders = Object.entries(js).filter(([, code]) => /["'`]\/assets\//.test(code)).map(([name]) => name)
    expect(Object.keys(js).length).toBeGreaterThan(1)
    expect(offenders).toEqual([])
  })

  it('resolves an imported image against the chunk that imports it', () => {
    const entry = Object.entries(js).find(([name]) => name.startsWith('index-'))?.[1] ?? ''
    expect(entry).toMatch(/new URL\(["'`]mascot-[\w-]+\.png["'`],\s*import\.meta\.url\)/)
  })

  it("resolves a lazy chunk's CSS preload against the importing chunk, not the origin root", () => {
    const entry = Object.entries(js).find(([name]) => name.startsWith('index-'))?.[1] ?? ''
    // The preload dep list (`__vite__mapDeps`): the lazy chunk and its CSS, as written in the bundle.
    const deps = JSON.parse(/m\.f=(\[[^\]]*\])/.exec(entry)?.[1] ?? '[]') as string[]
    expect(deps.some((dep) => /^(\.\/)?chart-[\w-]+\.css$/.test(dep))).toBe(true)
    expect(deps.filter((dep) => dep.startsWith('/'))).toEqual([])
    // ...and the helper that turns a dep into a URL resolves it against the importer. The default
    // base `/` emits `function(e){return"/"+e}` instead.
    expect(entry).toMatch(/function\((\w+),(\w+)\)\{return new URL\(\1,\2\)\.href\}/)
    expect(entry).not.toMatch(/return\s*["'`]\/["'`]\s*\+/)
  })

  it('writes a CSS url() relative to the stylesheet', () => {
    const sheet = Object.values(css).join('\n')
    expect(sheet).toMatch(/url\((["']?)(\.\/)?texture-[\w-]+\.png\1\)/)
  })
})
