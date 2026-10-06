import { useEffect } from 'react'
import { setVerticalSwipes } from './telegram'

/** While the screen is shown, Telegram's swipe-down-to-minimize gesture is off (see setVerticalSwipes); it comes back when the screen goes. */
export function useVerticalSwipesOff(): void {
  useEffect(() => {
    setVerticalSwipes(false)
    return () => setVerticalSwipes(true)
  }, [])
}
