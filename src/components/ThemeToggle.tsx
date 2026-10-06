import type { ReactNode } from 'react'
import { nextThemeChoice, type Scheme, type ThemeChoice } from '../lib/theme'
import { strings } from '../strings'

const ICONS: Record<Scheme, ReactNode> = {
  light: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </>
  ),
  dark: <path d="M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5z" />,
}

/**
 * A round icon button that cycles the theme: system → light → dark. The icon shows the scheme on
 * screen (sun in light, moon in dark); the label says which choice is active and what a tap does.
 * It moves to Settings later; the logic lives in lib/theme.
 */
export function ThemeToggle({ choice, scheme, onCycle }: { choice: ThemeChoice; scheme: Scheme; onCycle: () => void }) {
  const label = strings.theme.toggle(strings.theme.names[choice], strings.theme.names[nextThemeChoice(choice)])
  return (
    <button type="button" className="icon-btn" aria-label={label} title={label} data-theme-choice={choice} data-scheme={scheme} onClick={onCycle}>
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        {ICONS[scheme]}
      </svg>
    </button>
  )
}
