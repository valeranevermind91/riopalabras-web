import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// The clock that keeps a count of "what is due" true while a screen stays open is ONE mechanism, used by Home and by the Review end screen. The behaviour
// is tested in a real browser (review.browser.test.ts: the end screen; homeForeground.browser.test.ts: Home); these pin the wiring, so a screen cannot
// quietly go back to counting once.

const source = (file: string) => readFileSync(file, 'utf8')
const hook = source('src/lib/useDueClock.ts')
const home = source('src/screens/Home.tsx')
const review = source('src/screens/Review.tsx')

describe('useDueClock', () => {
  it('takes the moment again when the app returns to the foreground, and when the next word about to come due does', () => {
    expect(hook).toMatch(/useForeground\(refresh\)/)
    expect(hook).toMatch(/nextDueWithin\(words, asOf, RELEARN_MS\)/)
    expect(hook).toMatch(/setTimeout\(refresh, Math\.max\(0, comesDueAt - Date\.now\(\)\) \+ 250\)/)
    expect(hook).toMatch(/return \(\) => clearTimeout\(timer\)/)
    expect(hook).toMatch(/timed && words \?/) // no timer when the screen says not to, or has no words yet
  })
})

describe('Home counts from it, and has no clock of its own any more', () => {
  it('uses the shared clock, with the timer off when a test names its own "now"', () => {
    expect(home).toMatch(/useDueClock\(data\.status === 'ready' \? data\.data\.words : null, \{ timed: !nowProp \}\)/)
    expect(home).not.toMatch(/setTimeout|useForeground|nextDueWithin/)
  })
})

describe('the Review end screen counts from it', () => {
  it('the count is taken as of the clock, which runs only on the end screen and is taken again at the last rating', () => {
    expect(review).toMatch(/const clock = useDueClock\(data\.words, \{ timed: completed \}\)/)
    expect(review).toMatch(/dueWords\(data\.words, clock\.asOf\)\.length/)
    expect(review).toMatch(/\[completed, data\.words, clock\.asOf\]/)
    expect(review).toMatch(/clock\.refresh\(\)[^\n]*\n\s*setCompleted\(true\)/)
  })

  it('has no second timer or foreground listener of its own, and Continue still draws by the moment it is pressed', () => {
    expect(review).not.toMatch(/setTimeout|useForeground\(/)
    expect(review).toMatch(/setSession\(buildReviewSession\(data\.words, new Date\(\)\)\)/)
  })
})
