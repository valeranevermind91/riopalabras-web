import { useEffect, useLayoutEffect, useRef, type ReactNode } from 'react'
import type { ExitPlan } from '../lib/swipe'

/**
 * The card that was just swiped away, kept on screen while it leaves: it starts where the finger let go
 * and continues in the dragged direction at the release speed (transform and opacity only), or cross-fades
 * under reduced motion. It removes itself when done. Without the Web Animations API it is simply not shown.
 */
export function SwipeGhost({ plan, onDone, children }: { plan: ExitPlan; onDone: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  const done = useRef(onDone)
  useEffect(() => {
    done.current = onDone // the animation must not restart when the parent re-renders
  })

  useLayoutEffect(() => {
    const el = ref.current
    if (!el || typeof el.animate !== 'function') {
      done.current()
      return
    }
    const keyframes: Keyframe[] =
      plan.mode === 'fade'
        ? [{ opacity: 1 }, { opacity: 0 }]
        : [
            { transform: `translateX(${plan.from}px)`, opacity: 1 },
            { transform: `translateX(${plan.from + (plan.to - plan.from) * 0.65}px)`, opacity: 1, offset: 0.65 },
            { transform: `translateX(${plan.to}px)`, opacity: 0 },
          ]
    const animation = el.animate(keyframes, { duration: plan.duration, easing: plan.mode === 'fade' ? 'ease-out' : 'cubic-bezier(0.3, 0.55, 0.5, 1)', fill: 'forwards' })
    animation.onfinish = () => done.current()
    const fallback = window.setTimeout(() => done.current(), plan.duration + 120)
    return () => {
      window.clearTimeout(fallback)
      animation.cancel()
    }
  }, [plan])

  return (
    <div ref={ref} className="swipe-ghost" aria-hidden="true">
      {children}
    </div>
  )
}
