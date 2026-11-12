import puppeteer, { type Browser } from 'puppeteer-core'

/**
 * How the browser tests start and stop Chrome and their Vite server, in one place, so that a Chrome or a server that wedges fails a test by name within a
 * minute instead of holding the whole run for as long as anyone waits (once: 25 minutes against the usual three).
 *
 * - A call to Chrome that gets no answer rejects after PROTOCOL_MS with the name of the call ("Runtime.callFunctionOn timed out"); puppeteer's own default is
 *   three minutes, longer than the 60 s a test is allowed (vitest.config.ts), so the test timeout used to win and name nothing.
 * - Starting Chrome is given LAUNCH_MS, and closing Chrome or the server CLOSE_MS: past that Chrome is killed outright and the server is let go, with a line
 *   on stderr saying which one, because an afterAll that waits for ever would keep the worker (and the run) alive after every test had passed.
 */
export const LAUNCH_MS = 30_000
export const PROTOCOL_MS = 45_000
export const CLOSE_MS = 15_000

export function launchBrowser(executablePath: string | undefined): Promise<Browser> {
  return puppeteer.launch({ executablePath, headless: true, args: ['--no-sandbox'], timeout: LAUNCH_MS, protocolTimeout: PROTOCOL_MS })
}

/** Resolves when the thing is closed or, failing that, after `ms` having said so. */
async function within(what: string, closing: Promise<unknown> | undefined, ms: number, onTimeout: () => void): Promise<void> {
  if (!closing) return
  let timer: ReturnType<typeof setTimeout> | undefined
  const late = new Promise<'late'>((resolve) => {
    timer = setTimeout(() => resolve('late'), ms)
  })
  const outcome = await Promise.race([closing.then(() => 'closed' as const, () => 'closed' as const), late])
  clearTimeout(timer)
  if (outcome === 'late') {
    process.stderr.write(`[browser tests] ${what} did not close in ${ms / 1000} s; letting it go\n`)
    onTimeout()
  }
}

export async function closeBrowser(browser: Browser | undefined): Promise<void> {
  await within('Chrome', browser?.close(), CLOSE_MS, () => void browser?.process()?.kill('SIGKILL'))
}

export async function closeServer(server: { close: () => Promise<void> } | undefined): Promise<void> {
  await within('the Vite server', server?.close(), CLOSE_MS, () => {})
}
