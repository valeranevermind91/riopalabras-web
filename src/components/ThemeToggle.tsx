import type { ReactNode } from 'react'
import { nextThemeChoice, type ThemeChoice } from '../lib/theme'
import { strings } from '../strings'

const ICONS: Record<ThemeChoice, ReactNode> = {
  // half-filled disc: follow the system
  system: (
    <>
      <circle cx="12" cy="12" r="8" />
      <path d="M12 4a8 8 0 0 1 0 16z" fill="currentColor" stroke="none" />
    </>
  ),
  light: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </>
  ),
  dark: <path d="M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5z" />,
}

/** A small icon button that cycles the theme: system → light → dark. It moves to Settings later; the logic lives in lib/theme. */
export function ThemeToggle({ choice, onCycle }: { choice: ThemeChoice; onCycle: () => void }) {
  const label = strings.theme.toggle(strings.theme.names[choice], strings.theme.names[nextThemeChoice(choice)])
  return (
    <button type="button" className="icon-btn" aria-label={label} title={label} data-theme-choice={choice} onClick={onCycle}>
      <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        {ICONS[choice]}
      </svg>
    </button>
  )
}
