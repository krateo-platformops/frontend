import { ConfigProvider } from 'antd'
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'

import { cssVariables, getAntdTheme, type ThemeMode } from '../theme/tokens'

const STORAGE_KEY = 'krateo-theme-mode'

const getInitialMode = (): ThemeMode => {
  const stored = localStorage.getItem(STORAGE_KEY)
  if (stored === 'light' || stored === 'dark') {
    return stored
  }

  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

interface ThemeModeContextValue {
  mode: ThemeMode
  setMode: (mode: ThemeMode) => void
  toggle: () => void
}

const ThemeModeContext = createContext<ThemeModeContextValue | undefined>(undefined)

export const useThemeMode = (): ThemeModeContextValue => {
  const context = useContext(ThemeModeContext)
  if (!context) {
    throw new Error('useThemeMode must be used within a ThemeModeProvider')
  }

  return context
}

/** The active mode where a provider exists, light otherwise — for leaf components (e.g. a widget
 * rendered in a test or the visual harness) that only need to pick a per-mode value. */
export const useThemeModeOrLight = (): ThemeMode => useContext(ThemeModeContext)?.mode ?? 'light'

/**
 * Owns the active color mode (light/dark), the antd `ConfigProvider` theme, and
 * the `:root` CSS custom properties consumed by `*.module.css`. The mode is
 * seeded from localStorage, falling back to the OS `prefers-color-scheme`, and
 * persisted on change. CSS variables + the `data-theme` attribute are applied
 * synchronously during render so there is no flash on first paint or on toggle.
 */
export const ThemeModeProvider = ({ children }: { children: ReactNode }) => {
  const [mode, setMode] = useState<ThemeMode>(getInitialMode)

  // Apply synchronously (matches the prior cssVariables()-in-render pattern) so
  // the variables/attribute are set before children read them — no FOUC.
  cssVariables(mode)
  document.documentElement.dataset.theme = mode

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, mode)
  }, [mode])

  const value: ThemeModeContextValue = {
    mode,
    setMode,
    toggle: () => setMode((current) => (current === 'dark' ? 'light' : 'dark')),
  }

  return (
    <ThemeModeContext.Provider value={value}>
      <ConfigProvider theme={getAntdTheme(mode)}>
        {children}
      </ConfigProvider>
    </ThemeModeContext.Provider>
  )
}
