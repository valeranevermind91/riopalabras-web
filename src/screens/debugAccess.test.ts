import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { parseSettings } from '../data/settings'
import { createWriteQueue } from '../data/writeQueue'
import { HomeScreen } from './Home'
import { NotAvailable } from './NotAvailable'
import { SettingsScreen } from './Settings'

// Debug has one way in (seven taps on the version row, kept in the account's settings as debug_unlocked) and one way out ("Lock Debug"). There used to be a
// second way in, a list of Telegram ids in an environment variable; it is gone, and these tests keep it gone.

const noop = () => {}
const queue = createWriteQueue({ sendProgress: async () => {}, sendSettings: async () => {} })
const settings = (raw: Record<string, unknown>) => renderToStaticMarkup(createElement(SettingsScreen, { data: { settings: parseSettings(raw), getSettings: () => parseSettings(raw), applySettings: noop } as never, queue, theme: { choice: 'system', set: noop }, onOpenDebug: noop, botUsername: 'riopalabras_bot' }))

/** Every file under a folder, skipping what is not ours (dependencies, the build). */
function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    if (['node_modules', 'dist', '.git'].includes(name)) return []
    const path = join(dir, name)
    return statSync(path).isDirectory() ? files(path) : [path]
  })
}

describe('what the UI shows', () => {
  const props = { auth: { status: 'no-telegram' as const }, data: { status: 'loading' as const }, onLearn: () => {}, onReview: () => {}, onMatching: () => {}, onCloze: () => {}, queue: null, metrics: null }

  it('the Home screen has no Debug link, whoever is looking: Settings is the way in', () => {
    expect(renderToStaticMarkup(createElement(HomeScreen, props))).not.toContain('debug-link')
    expect(renderToStaticMarkup(createElement(HomeScreen, { ...props, onSettings: () => {} }))).not.toMatch(/>Debug</)
  })

  it('the refusal is a plain "Not available" and nothing else', () => {
    expect(renderToStaticMarkup(createElement(NotAvailable))).toBe('<main class="screen"><p>Not available</p></main>')
  })
})

describe('Debug depends on the account\'s own setting and on nothing else', () => {
  it('whatever else is in the settings, without debug_unlocked there is no Debug; with it there is', () => {
    for (const raw of [{}, { ui_language: 'ru', onboarding_done: true, daily_new_word_limit: 20 }, { debug_unlocked: false }, { debug_unlocked: 'true' }, { debug_unlocked: 1 }]) {
      expect(settings(raw), JSON.stringify(raw)).not.toContain('settings-debug')
    }
    expect(settings({ debug_unlocked: true })).toContain('settings-debug')
  })

  it('SettingsScreen takes no "allowed" flag from outside any more, and App decides from the setting alone', () => {
    const source = readFileSync('src/screens/Settings.tsx', 'utf8')
    expect(source).not.toMatch(/debugAllowed/)
    expect(source).toMatch(/\{settings\.debugUnlocked && \(/)
    const app = readFileSync('src/App.tsx', 'utf8')
    expect(app).not.toMatch(/debugAllowed|debugListed|useDebugAccess/)
    expect(app).not.toMatch(/auth\.getUser|verifiedTelegramId/)
  })
})

describe('the list of Telegram ids is gone', () => {
  const OLD_VARIABLE = ['VITE', 'DEBUG', 'TG', 'IDS'].join('_') // spelled in pieces so this file is not itself a mention

  it('its code is deleted: the gate, the hook and their tests', () => {
    for (const file of ['src/lib/debugGate.ts', 'src/lib/useDebugAccess.ts', 'src/lib/debugGate.test.ts']) expect(existsSync(file), file).toBe(false)
  })

  it('the variable is mentioned nowhere in the repository: not in the code, the types, .env.example or the docs', () => {
    const mentions = [...files('src'), ...files('tools'), '.env.example', 'README.md', 'BACKLOG.md', 'vite.config.ts', 'vercel.json', 'index.html'].filter((f) => existsSync(f) && readFileSync(f, 'utf8').includes(OLD_VARIABLE))
    expect(mentions).toEqual([])
  })

  it('nothing reads the account\'s Telegram id from its email any more (the only thing that did was the list)', () => {
    const readers = files('src').filter((f) => /\.tsx?$/.test(f) && /tg_\(\\d\+\)|telegram\.riopalabras\.internal/.test(readFileSync(f, 'utf8')))
    expect(readers).toEqual([])
  })

  it('.env.example still lists the variables that are used', () => {
    const example = readFileSync('.env.example', 'utf8')
    for (const name of ['VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY', 'VITE_PROXY_URL', 'VITE_BOT_USERNAME']) expect(example).toContain(name)
  })
})
