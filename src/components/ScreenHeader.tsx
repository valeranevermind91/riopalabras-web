import { strings } from '../strings'

/** Title row. `onBack` is passed only where Telegram's native BackButton isn't available. */
export function ScreenHeader({ title, onBack }: { title: string; onBack?: () => void }) {
  return (
    <header className="screen-header">
      {onBack && (
        <button type="button" className="back-link" onClick={onBack}>
          ‹ {strings.common.back}
        </button>
      )}
      <h1>{title}</h1>
    </header>
  )
}
