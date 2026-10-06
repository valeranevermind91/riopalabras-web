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

interface WebAppBackButton {
  show: () => void
  hide: () => void
  onClick: (callback: () => void) => void
  offClick: (callback: () => void) => void
}

interface WebAppHapticFeedback {
  impactOccurred: (style: 'light' | 'medium' | 'heavy' | 'rigid' | 'soft') => void
  notificationOccurred: (type: 'error' | 'success' | 'warning') => void
  selectionChanged: () => void
}

export interface TelegramWebApp {
  initData: string
  initDataUnsafe: WebAppInitDataUnsafe
  colorScheme: 'light' | 'dark'
  themeParams: WebAppThemeParams
  ready: () => void
  expand: () => void
  // Optional: absent in the dev mock and in Telegram clients older than the Bot API version that added them.
  isVersionAtLeast?: (version: string) => boolean
  BackButton?: WebAppBackButton
  HapticFeedback?: WebAppHapticFeedback
  showConfirm?: (message: string, callback: (confirmed: boolean) => void) => void
  // Chrome colours (Bot API 6.1+): a hex colour or 'bg_color' / 'secondary_bg_color'.
  setHeaderColor?: (color: string) => void
  setBackgroundColor?: (color: string) => void
  // Closing confirmation (Bot API 6.2+) and events ('activated' arrives with 8.0); absent in the dev mock.
  enableClosingConfirmation?: () => void
  disableClosingConfirmation?: () => void
  onEvent?: (eventType: string, callback: () => void) => void
  offEvent?: (eventType: string, callback: () => void) => void
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
  themeParams: {}, // unused: the app's colours are its own (src/tokens.css); only colorScheme is read
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

/** Telegram's own back button (Bot API 6.1+), or null where it doesn't exist — callers then render an in-page one. */
export function nativeBackButton(webApp: TelegramWebApp): WebAppBackButton | null {
  return webApp.BackButton && webApp.isVersionAtLeast?.('6.1') ? webApp.BackButton : null
}

export type Haptic = 'tap' | 'select' | 'success' | 'error'

/** Haptic feedback where Telegram supports it; a silent no-op everywhere else. */
export function haptic(kind: Haptic): void {
  const { webApp } = getWebApp()
  const feedback = webApp.HapticFeedback
  if (!feedback || !webApp.isVersionAtLeast?.('6.1')) return
  try {
    if (kind === 'tap') feedback.impactOccurred('light')
    else if (kind === 'select') feedback.selectionChanged()
    else feedback.notificationOccurred(kind)
  } catch {
    // Feedback is decoration; never let it break an interaction.
  }
}

/** Telegram's native confirm popup (6.2+), falling back to window.confirm. */
export function confirmDialog(message: string): Promise<boolean> {
  const { webApp } = getWebApp()
  if (webApp.showConfirm && webApp.isVersionAtLeast?.('6.2')) {
    const showConfirm = webApp.showConfirm
    return new Promise((resolve) => showConfirm.call(webApp, message, resolve))
  }
  return Promise.resolve(window.confirm(message))
}

/**
 * Turns Telegram's "are you sure you want to close?" prompt on or off (Bot API 6.2+). A no-op
 * outside Telegram, in clients without it, and if the call itself throws.
 */
export function setClosingConfirmation(enabled: boolean, webApp: TelegramWebApp = getWebApp().webApp): void {
  const call = enabled ? webApp.enableClosingConfirmation : webApp.disableClosingConfirmation
  if (!call || !webApp.isVersionAtLeast?.('6.2')) return
  try {
    call.call(webApp)
  } catch {
    // the prompt is a safety net, never a reason to break the app
  }
}

/** Calls `callback` when Telegram re-activates the Mini App (Bot API 8.0+). Returns the unsubscribe; a no-op where the event doesn't exist. */
export function onTelegramActivated(callback: () => void, webApp: TelegramWebApp = getWebApp().webApp): () => void {
  if (!webApp.onEvent || !webApp.isVersionAtLeast?.('8.0')) return () => {}
  try {
    webApp.onEvent('activated', callback)
  } catch {
    return () => {}
  }
  return () => {
    try {
      webApp.offEvent?.('activated', callback)
    } catch {
      // already gone
    }
  }
}
