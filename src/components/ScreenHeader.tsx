import type { ReactNode } from 'react'
import { strings } from '../strings'

/** Title row. `onBack` is passed only where Telegram's native BackButton isn't available; `actions` sit at the right edge. */
export function ScreenHeader({ title, onBack, actions }: { title: string; onBack?: () => void; actions?: ReactNode }) {
  return (
    <header className="screen-header">
      {onBack && (
        <button type="button" className="back-link" onClick={onBack}>
          ‹ {strings.common.back}
        </button>
      )}
      <h1>{title}</h1>
      {actions && <div className="screen-header-actions">{actions}</div>}
    </header>
  )
}
