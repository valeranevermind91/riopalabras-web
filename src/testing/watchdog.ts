import { afterAll, expect } from 'vitest'

/**
 * Every test file runs with this (setupFiles in vitest.config.ts): a file that is still running after FILE_TIMEOUT_MS has hung somewhere a test's own timeout
 * does not reach (an afterAll that never ends, a page that never answers, a timer that keeps being rearmed), and the run used to wait for it for as long as
 * anyone cared to. Now it says which file and which test (or that it was in a hook), and ends that worker; vitest reports the file as failed and the others carry on.
 * The slowest file takes about two minutes in a full run (everything at once on ten cores), so ten minutes is a ceiling for a slow machine, not a budget.
 * RIO_FILE_TIMEOUT_MS shortens it, for trying this out.
 *
 * It cannot help where the worker's event loop is blocked (no timer fires then), so the one synchronous wait the suite has, the build in privacy.build.test.ts,
 * has a timeout of its own.
 */
const FILE_TIMEOUT_MS = Number(process.env.RIO_FILE_TIMEOUT_MS) || 600_000

const timer = setTimeout(() => {
  const { testPath, currentTestName } = expect.getState()
  const where = currentTestName ? `in the test "${currentTestName}"` : 'outside any test: in a beforeAll or afterAll hook, or while the file was being loaded'
  process.stderr.write(`\n[watchdog] ${testPath} has been running for ${FILE_TIMEOUT_MS / 1000} s, stuck ${where}. Ending this worker.\n`)
  process.kill(process.pid, 'SIGKILL')
}, FILE_TIMEOUT_MS)
timer.unref()

afterAll(() => clearTimeout(timer))
