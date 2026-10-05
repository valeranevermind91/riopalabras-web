import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { applyTheme, insideTelegram, readStoredChoice, readThemeEnv, resolveTheme } from './lib/theme'

// Before the first render: the remembered choice (or system), so the page never flashes the wrong theme.
const telegram = window.Telegram?.WebApp
applyTheme(document.documentElement, resolveTheme(readStoredChoice() ?? 'system', readThemeEnv(telegram)), insideTelegram(telegram) ? telegram! : null)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
