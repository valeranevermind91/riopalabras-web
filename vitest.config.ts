import { defineConfig } from 'vitest/config'

// Pinned before any worker starts: the local-midnight and local-date tests are only meaningful
// in the timezone where the Flutter timestamp bug showed up (Uruguay, UTC-3).
process.env.TZ = 'America/Montevideo'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
