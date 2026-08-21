import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import svgr from 'vite-plugin-svgr'

// Build-time provenance for the sider build footer (Shell.tsx). The app version comes from
// package.json (the single source the app already versions itself by), NOT a hardcoded literal;
// the build marker is the git short-SHA. Both resolve at build/serve start and are inlined as
// compile-time constants (`__APP_VERSION__` / `__APP_BUILD__`). Each degrades to a safe fallback
// (a container build with no `.git`, or a package.json without a real version, must not crash).
const appVersion = (() => {
  try {
    const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf-8')) as { version?: string }
    return pkg.version || '0.0.0'
  } catch {
    return '0.0.0'
  }
})()

const appBuild = (() => {
  // CI image builds have no .git — the release workflow passes the commit as APP_BUILD instead
  if (process.env.APP_BUILD) {
    return process.env.APP_BUILD.slice(0, 7)
  }
  try {
    return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim()
  } catch {
    return 'dev'
  }
})()

// Plugin to print current config name during development
const printConfigPlugin = () => ({
  configResolved(config: { command: string }) {
    if (config.command === 'serve') {
      const configName = process.env.VITE_CONFIG_NAME
      if (configName) {
        const configFile = `config.${configName}.json`
        // eslint-disable-next-line no-console
        console.log(`\n🔧 Using config: ${configFile}\n`)
      } else {
        // eslint-disable-next-line no-console
        console.log(`\n🔧 Using config: config.json\n`)
      }
    }
  },
  name: 'print-config',
})

// Optional upstream base for the dev-only Autopilot same-origin proxy (see server.proxy below).
const autopilotProxyTarget = process.env.VITE_AUTOPILOT_PROXY_TARGET

// https://vitejs.dev/config/
export default defineConfig({
  css: {
    preprocessorOptions: {
      scss: {
        api: 'modern-compiler',
      },
    },
  },
  define: {
    __APP_BUILD__: JSON.stringify(appBuild),
    __APP_VERSION__: JSON.stringify(appVersion),
  },
  plugins: [
    react(),
    svgr({
      svgrOptions: {
        icon: true,
      },
    }),
    printConfigPlugin(),
  ],
  server: {
    port: 4000,
    // Optional dev-only same-origin proxy for the Autopilot A2A endpoint, mirroring the
    // production nginx `location /autopilot/`. Opt in by pointing it at a reachable kagent-ui,
    // then set AUTOPILOT_API_BASE_URL to "/autopilot" in the active config. (In-cluster with
    // agentgateway on, the rail calls the gateway's URL directly and no proxy is involved.)
    //   VITE_AUTOPILOT_PROXY_TARGET=http://<kagent-ui-or-gateway>:8080 npm run dev
    // Unset → no proxy is registered (no behavior change). Replaces the throwaway CORS proxy.
    ...(autopilotProxyTarget
      ? {
        proxy: {
          '/autopilot': {
            changeOrigin: true,
            rewrite: (path: string) => path.replace(/^\/autopilot/, '/api/a2a/krateo-system/autopilot'),
            target: autopilotProxyTarget,
          },
        },
      }
      : {}),
  },
})
