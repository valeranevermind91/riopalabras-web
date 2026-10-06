import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { setVerticalSwipes, type TelegramWebApp } from './telegram'

// The static side of "the swipe must reach our handlers on a phone". The real-input proof is swipe.touch.test.ts.

const css = readFileSync('src/index.css', 'utf8').replace(/\/\*[\s\S]*?\*\//g, '') // without comments

/** Every rule of the stylesheet as [selectors, body]. */
function rules(): { selectors: string[]; body: string }[] {
  return [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({ selectors: m[1].split(',').map((s) => s.trim()), body: m[2] }))
}

describe('touch-action in the swipe area', () => {
  it('the swipe area and every element inside it say pan-y themselves (touch-action stops counting at the nearest scroll container)', () => {
    const rule = rules().find((r) => r.selectors.includes('.swipe-area *'))
    expect(rule?.selectors).toContain('.swipe-area')
    expect(rule?.body).toMatch(/touch-action: pan-y/)
  })

  it('no rule inside the swipe area switches touch-action back, and no ancestor of the card is a scroll container that could take the gesture', () => {
    for (const r of rules()) {
      if (!/touch-action/.test(r.body)) continue
      expect(r.selectors.every((s) => s.startsWith('.swipe-area')), r.selectors.join(', ')).toBe(true)
      expect(r.body).not.toMatch(/touch-action: (auto|manipulation|none)/)
    }
    for (const selector of ['.swipe-area', '.swipe-stage', '.swipe-layer', '.screen', '.fill']) {
      const r = rules().find((x) => x.selectors.includes(selector))
      expect(r?.body ?? '', selector).not.toMatch(/overflow(-y)?: (auto|scroll)/)
    }
  })

  it('the card is the one scroll container in the swipe area (long content scrolls inside it) and it is covered by the rule above', () => {
    const scrolling = rules().filter((r) => /overflow-y: (auto|scroll)/.test(r.body) && r.selectors.some((s) => s.includes('.swipe-layer') || s.includes('.swipe-ghost') || s.includes('.swipe-area')))
    expect(scrolling.flatMap((r) => r.selectors).every((s) => s.includes('.word-card'))).toBe(true)
  })

  it('the leaving card never receives the pointer', () => {
    expect(rules().filter((r) => r.selectors.includes('.swipe-ghost')).some((r) => /pointer-events: none/.test(r.body))).toBe(true)
  })
})

describe('which events the swipe listens to', () => {
  const hook = readFileSync('src/lib/useSwipe.ts', 'utf8')

  it('pointer events only: down, move, up and cancel (touch and mouse arrive as pointer events)', () => {
    const handlers = hook.match(/handlers: \{([^}]*)\}/)![1]
    expect(handlers.split(',').map((h) => h.trim().split(':')[0]).filter(Boolean)).toEqual(['onPointerDown', 'onPointerMove', 'onPointerUp', 'onPointerCancel'])
    expect(hook).not.toMatch(/onTouch|onMouse|addEventListener/)
  })

  it('the hook never cancels the browser\'s own handling: no preventDefault, so vertical scrolling is untouched', () => {
    expect(hook).not.toMatch(/preventDefault/)
  })

  it('the pointer is captured on down (the drag follows the finger past the card edge) and left to the browser to release', () => {
    expect(hook).toMatch(/setPointerCapture/)
    expect(hook).not.toMatch(/releasePointerCapture/)
  })
})

describe("Telegram's swipe-down-to-minimize gesture", () => {
  const base = { initData: '', initDataUnsafe: {}, colorScheme: 'light', themeParams: {}, ready() {}, expand() {} } as TelegramWebApp
  const modern = (extra: Partial<TelegramWebApp> = {}) => ({ ...base, disableVerticalSwipes: vi.fn(), enableVerticalSwipes: vi.fn(), isVersionAtLeast: () => true, ...extra }) as TelegramWebApp & { disableVerticalSwipes: ReturnType<typeof vi.fn>; enableVerticalSwipes: ReturnType<typeof vi.fn> }

  it('is switched off while a card screen is shown and back on afterwards (Bot API 7.7+)', () => {
    const w = modern()
    setVerticalSwipes(false, w)
    setVerticalSwipes(true, w)
    expect(w.disableVerticalSwipes).toHaveBeenCalledTimes(1)
    expect(w.enableVerticalSwipes).toHaveBeenCalledTimes(1)
  })

  it('does nothing outside Telegram, in a client older than 7.7, or when the call throws', () => {
    expect(() => setVerticalSwipes(false, base)).not.toThrow()
    const old = modern({ isVersionAtLeast: (v: string) => v !== '7.7' })
    setVerticalSwipes(false, old)
    expect(old.disableVerticalSwipes).not.toHaveBeenCalled()
    expect(() => setVerticalSwipes(false, modern({ disableVerticalSwipes: () => { throw new Error('boom') } }))).not.toThrow()
  })

  it('Learn and Review both switch it off for as long as they are on screen', () => {
    for (const file of ['src/screens/Learn.tsx', 'src/screens/Review.tsx']) expect(readFileSync(file, 'utf8'), file).toContain('useVerticalSwipesOff()')
    const hook = readFileSync('src/lib/useVerticalSwipesOff.ts', 'utf8')
    expect(hook).toContain('setVerticalSwipes(false)')
    expect(hook).toContain('return () => setVerticalSwipes(true)')
  })
})
