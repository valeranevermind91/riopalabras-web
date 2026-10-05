import type { ReactNode } from 'react'

/** A small, non-blocking notice with one action button. Home uses it for every "something is retrying" message so they all look alike. */
export function Notice({ children, actionLabel, onAction }: { children?: ReactNode; actionLabel: string; onAction: () => void }) {
  return (
    <p className="notice" role="status">
      {children}{' '}
      <button type="button" className="btn-small wp-off" onClick={onAction}>
        {actionLabel}
      </button>
    </p>
  )
}
