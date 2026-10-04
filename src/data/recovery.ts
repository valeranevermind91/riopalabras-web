// Background retries for the user data that failed at launch but is not needed to start (favorites, hidden words).

export interface Retrier {
  start: () => void
  stop: () => void
  /** Try now instead of waiting (no-op while an attempt is running or once finished/stopped). */
  retryNow: () => void
}

export interface RetrierOptions {
  /** One attempt. Resolves true when there is nothing left to recover (the retrier then stops). */
  run: () => Promise<boolean>
  /** Waits before the first attempts; after these, `repeatMs`. */
  delaysMs?: readonly number[]
  repeatMs?: number
  setTimer?: (fn: () => void, ms: number) => unknown
  clearTimer?: (handle: unknown) => void
}

export const DEFAULT_BACKGROUND_DELAYS_MS: readonly number[] = [15_000, 30_000, 60_000]
export const DEFAULT_BACKGROUND_REPEAT_MS = 120_000

export function createBackgroundRetrier(options: RetrierOptions): Retrier {
  const delays = options.delaysMs ?? DEFAULT_BACKGROUND_DELAYS_MS
  const repeatMs = options.repeatMs ?? DEFAULT_BACKGROUND_REPEAT_MS
  const setTimer = options.setTimer ?? ((fn, ms) => setTimeout(fn, ms))
  const clearTimer = options.clearTimer ?? ((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>))

  let timer: unknown = null
  let scheduled = 0
  let stopped = true
  let running = false

  const clear = () => {
    if (timer !== null) clearTimer(timer)
    timer = null
  }

  const schedule = () => {
    if (stopped) return
    const ms = scheduled < delays.length ? delays[scheduled] : repeatMs
    scheduled++
    timer = setTimer(() => void attempt(), ms)
  }

  async function attempt() {
    timer = null
    if (stopped || running) return
    running = true
    let done = false
    try {
      done = await options.run()
    } catch {
      done = false // run() logs its own failures; the next attempt is already on its way
    } finally {
      running = false
    }
    if (stopped) return
    if (done) stopped = true
    else schedule()
  }

  return {
    start() {
      stopped = false
      scheduled = 0
      clear()
      schedule()
    },
    stop() {
      stopped = true
      clear()
    },
    retryNow() {
      if (stopped || running) return
      clear()
      void attempt()
    },
  }
}
