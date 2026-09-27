export interface TelegramUser {
  id: number
  first_name: string
  last_name?: string
  username?: string
  language_code?: string
}

interface WebAppInitDataUnsafe {
  user?: TelegramUser
  [key: string]: unknown
}

interface WebAppThemeParams {
  bg_color?: string
  text_color?: string
  hint_color?: string
  link_color?: string
  button_color?: string
  button_text_color?: string
  secondary_bg_color?: string
  [key: string]: string | undefined
}

export interface TelegramWebApp {
  initData: string
  initDataUnsafe: WebAppInitDataUnsafe
  colorScheme: 'light' | 'dark'
  themeParams: WebAppThemeParams
  ready: () => void
  expand: () => void
}

declare global {
  interface Window {
    Telegram?: {
      WebApp: TelegramWebApp
    }
  }
}

const MOCK_USER: TelegramUser = {
  id: 123456789,
  first_name: 'Ana',
  last_name: 'Dev',
  username: 'ana_dev',
  language_code: 'es',
}

const MOCK_WEB_APP: TelegramWebApp = {
  initData: '',
  initDataUnsafe: { user: MOCK_USER },
  colorScheme: 'light',
  themeParams: {
    bg_color: '#ffffff',
    text_color: '#222222',
    hint_color: '#999999',
    link_color: '#2678b6',
    button_color: '#50a8eb',
    button_text_color: '#ffffff',
    secondary_bg_color: '#f0f0f0',
  },
  ready: () => {},
  expand: () => {},
}

export interface WebAppContext {
  webApp: TelegramWebApp
  isMock: boolean
}

// Outside Telegram (e.g. plain browser during local dev), the telegram-web-app.js
// stub still defines window.Telegram.WebApp but with empty initData. In dev mode
// only, we fall back to a fully mocked WebApp so the UI is visible without opening
// the app inside Telegram.
export function getWebApp(): WebAppContext {
  const real = window.Telegram?.WebApp

  if (real?.initData) {
    return { webApp: real, isMock: false }
  }

  if (import.meta.env.DEV) {
    return { webApp: MOCK_WEB_APP, isMock: true }
  }

  return { webApp: real ?? MOCK_WEB_APP, isMock: !real }
}

export function applyTelegramTheme(webApp: TelegramWebApp) {
  const root = document.documentElement
  const { themeParams, colorScheme } = webApp

  root.dataset.colorScheme = colorScheme

  for (const [key, value] of Object.entries(themeParams)) {
    if (value) {
      root.style.setProperty(`--tg-${key.replace(/_/g, '-')}`, value)
    }
  }
}
