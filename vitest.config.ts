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
  },
})
