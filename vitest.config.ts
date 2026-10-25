import { defineConfig } from 'vitest/config'
import { buildDefines } from './buildInfo.ts'

// Pinned before any worker starts: the local-midnight and local-date tests are only meaningful
// in the timezone where the Flutter timestamp bug showed up (Uruguay, UTC-3).
process.env.TZ = 'America/Montevideo'

export default defineConfig({
  define: buildDefines(),
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'tools/**/*.test.mjs'],
    // vitest's 5 s / 10 s defaults are too tight for this suite: many tests sweep all 4,753 words, and the suite runs on every core at once, which
    // makes each test about five times slower than it is alone (the slowest test with no timeout of its own takes 0.7 s alone and 3.2 s in a
    // full run). 60 s is about twenty times that, and the same figure the browser tests already give themselves. It is a ceiling for a
    // slow machine, not a budget: a test that never finishes still fails when it is reached.
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
})
