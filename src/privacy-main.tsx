import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import { readStoredLanguage, setLanguage } from './lib/language'
import { startingLanguage } from './lib/privacy'
import { applyTheme, readStoredChoice, readThemeEnv, resolveScheme } from './lib/theme'
import { PrivacyPage } from './screens/Privacy'

// The entry of privacy.html. Nothing here talks to Telegram, to the proxy or to Supabase: it sets the theme and the language and draws the page.
// Theme: the choice this device remembers, else the OS (there is no Telegram scheme to follow, and no Telegram header to colour).
applyTheme(document.documentElement, resolveScheme(readStoredChoice() ?? 'system', readThemeEnv(null)), null)

// Language: ?lang=, else what this device last used, else the browser's first preference; shown, not remembered.
setLanguage(startingLanguage({ search: location.search, stored: readStoredLanguage(), languages: navigator.languages?.length ? navigator.languages : [navigator.language] }), { remember: false })

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <PrivacyPage />
  </StrictMode>,
)
