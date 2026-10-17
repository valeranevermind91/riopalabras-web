import { useEffect, useRef } from 'react'
import { onTelegramActivated } from './telegram'

/**
 * Calls `onForeground` each time the app comes back to the foreground: the page becomes visible again (visibilitychange), or Telegram
 * re-activates the Mini App (Bot API 8.0+, where the page may stay "visible" the whole time). A screen that works something out from the
 * date or the time uses it to work that out again: a Mini App is often left open in the background overnight, and what it computed the day
 * before is then yesterday's. The call is made from the event itself, so the callback may set state.
 */
export function useForeground(onForeground: () => void): void {
  const latest = useRef(onForeground)
  useEffect(() => {
    latest.current = onForeground
  })
  useEffect(() => {
    const comeBack = () => latest.current()
    const onVisibility = () => {
      if (document.visibilityState === 'visible') comeBack()
    }
    document.addEventListener('visibilitychange', onVisibility)
    const stopActivated = onTelegramActivated(comeBack)
    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      stopActivated()
    }
  }, [])
}
