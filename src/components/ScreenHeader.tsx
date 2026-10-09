import type { ReactNode } from 'react'
import { strings } from '../strings'

/** Title row. `onBack` is passed only where Telegram's native BackButton isn't available; `actions` sit at the right edge; `brand` sets the title in the display face (the app name); `backLabel` overrides the Back text (Debug keeps it English). */
export function ScreenHeader({ title, onBack, actions, brand, backLabel }: { title: string; onBack?: () => void; actions?: ReactNode; brand?: boolean; backLabel?: string }) {
  return (
    <header className="screen-header">
      {onBack && (
        <button type="button" className="back-link" onClick={onBack}>
          ‹ {backLabel ?? strings.common.back}
        </button>
      )}
      <h1 className={brand ? 'brand home-title' : undefined}>{title}</h1>
      {actions && <div className="screen-header-actions">{actions}</div>}
    </header>
  )
}
