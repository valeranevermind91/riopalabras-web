import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { parseSettings } from '../data/settings'
import { createWriteQueue } from '../data/writeQueue'
import { botHandle, botLink } from '../lib/botLink'
import { VERSION_LABEL, formatVersion } from '../lib/buildInfo'
import { backTarget } from '../lib/nav'
import { readStoredChoice, storeChoice } from '../lib/theme'
import { SettingsScreen } from './Settings'

const noop = () => {}
const queue = createWriteQueue({ sendProgress: async () => {}, sendSettings: async () => {} })

const render = (raw: Record<string, unknown> = {}, props: Partial<Parameters<typeof SettingsScreen>[0]> = {}) =>
  renderToStaticMarkup(
    createElement(SettingsScreen, {
      data: { settings: parseSettings(raw), getSettings: () => parseSettings(raw), applySettings: noop } as never,
      queue,
      theme: { choice: 'system', set: noop },
      debugAllowed: false,
      onOpenDebug: noop,
      botUsername: 'riopalabras_bot',
      ...props,
    }),
  )

const labels = (html: string) => [...html.matchAll(/<h2 id="settings-[a-z]+" class="settings-label">([^<]+)<\/h2>/g)].map((m) => m[1])

describe('the Settings screen', () => {
  it('has the header with a back button and the title, and the sections in this order: Learning, Appearance, Notifications, About', () => {
    const html = render({}, { onBack: noop })
    expect(html).toContain('<h1>Settings</h1>')
    expect(html).toContain('class="back-link"')
    expect(labels(html)).toEqual(['Learning', 'Appearance', 'Notifications', 'About'])
    expect(html).toMatch(/class="settings-label"/)
  })

  it('Debug is the fifth section, after About, for someone allowed', () => {
    expect(labels(render({}, { debugAllowed: true }))).toEqual(['Learning', 'Appearance', 'Notifications', 'About', 'Debug'])
  })

  describe('the daily goal', () => {
    const goal = (html: string) => html.match(/<output[^>]*>(\d+)<\/output>/)![1]
    const button = (html: string, label: string) => html.match(new RegExp(`<button[^>]*aria-label="${label}"[^>]*>`))![0]

    it('shows the stored value, labelled, with − and + around it', () => {
      const html = render({ daily_new_word_limit: 12 })
      expect(goal(html)).toBe('12')
      expect(html).toContain('id="goal-label"')
      expect(html).toContain('aria-labelledby="goal-label"')
      expect(html).toContain('New words per day')
      expect(button(html, 'Decrease the daily goal')).not.toContain('disabled')
      expect(button(html, 'Increase the daily goal')).not.toContain('disabled')
    })

    it('a user who had a goal of 10 still sees 10, and 10 is also what a user with no stored goal gets', () => {
      expect(goal(render({ daily_new_word_limit: 10 }))).toBe('10')
      expect(goal(render({}))).toBe('10')
    })

    it('the buttons are off at the ends: nothing to decrease at 0, nothing to increase at 20', () => {
      expect(button(render({ daily_new_word_limit: 0 }), 'Decrease the daily goal')).toContain('disabled')
      expect(button(render({ daily_new_word_limit: 0 }), 'Increase the daily goal')).not.toContain('disabled')
      expect(button(render({ daily_new_word_limit: 20 }), 'Increase the daily goal')).toContain('disabled')
      expect(button(render({ daily_new_word_limit: 20 }), 'Decrease the daily goal')).not.toContain('disabled')
    })

    it('the note about sessions of 10 appears above 15, and not at or below it', () => {
      const note = 'split into sessions of 10'
      for (const limit of [0, 10, 14, 15]) expect(render({ daily_new_word_limit: limit }), String(limit)).not.toContain(note)
      for (const limit of [16, 18, 20]) expect(render({ daily_new_word_limit: limit }), String(limit)).toContain(note)
    })
  })

  describe('the translation language: two switches, the last one on is off-limits', () => {
    const switchFor = (html: string, id: string) => html.match(new RegExp(`<input id="${id}"[^>]*>`))![0]

    it('each switch is a real labelled control: a <label for> pointing at an input with role="switch"', () => {
      const html = render({})
      for (const [id, text] of [['language-ru', 'Russian'], ['language-en', 'English']]) {
        expect(html).toMatch(new RegExp(`<label for="${id}" class="setting-label">${text}</label>`))
        expect(switchFor(html, id)).toMatch(/type="checkbox" role="switch"/)
      }
    })

    it('reflects the stored flags', () => {
      const both = render({ show_ru_translation: true, show_en_translation: true })
      expect(switchFor(both, 'language-ru')).toContain('checked')
      expect(switchFor(both, 'language-en')).toContain('checked')
      const en = render({ show_ru_translation: false, show_en_translation: true })
      expect(switchFor(en, 'language-ru')).not.toContain('checked')
      expect(switchFor(en, 'language-en')).toContain('checked')
    })

    it('the only one on is disabled, so it cannot be turned off; the other one can be turned on', () => {
      const ruOnly = render({ show_ru_translation: true, show_en_translation: false })
      expect(switchFor(ruOnly, 'language-ru')).toContain('disabled')
      expect(switchFor(ruOnly, 'language-en')).not.toContain('disabled')
      const enOnly = render({ show_ru_translation: false, show_en_translation: true })
      expect(switchFor(enOnly, 'language-en')).toContain('disabled')
      expect(switchFor(enOnly, 'language-ru')).not.toContain('disabled')
    })

    it('with both on, neither is disabled; with nothing stored it is Russian only, as it always was', () => {
      const both = render({ show_ru_translation: true, show_en_translation: true })
      expect(switchFor(both, 'language-ru')).not.toContain('disabled')
      expect(switchFor(both, 'language-en')).not.toContain('disabled')
      expect(switchFor(render({}), 'language-ru')).toContain('disabled')
    })
  })

  describe('the theme', () => {
    it('a three-way control, System / Light / Dark, in a labelled radio group, with the current choice checked', () => {
      const html = render({}, { theme: { choice: 'dark', set: noop } })
      const group = html.match(/<div class="segmented" role="radiogroup" aria-labelledby="theme-label">.*?<\/div>/)![0]
      expect([...group.matchAll(/role="radio" aria-checked="(true|false)">([^<]+)</g)].map((m) => `${m[2]}:${m[1]}`)).toEqual(['System:false', 'Light:false', 'Dark:true'])
      expect(html).toContain('id="theme-label"')
    })
  })

  describe('notifications', () => {
    it('one disabled row, "Reminders — coming soon", with a muted explanation, and nothing to focus or press', () => {
      const html = render()
      const row = html.match(/<div class="setting-row is-disabled">.*?<\/div><\/div>/)![0]
      expect(row).toContain('Reminders — coming soon')
      expect(row).toContain('They will arrive through the bot.')
      expect(row).not.toMatch(/<(button|input|a|select)\b|tabindex/)
    })
  })

  describe('about', () => {
    it('shows the version from the build, as "v<hash> · <date>"', () => {
      const html = render()
      expect(html).toContain(`<span class="setting-value">${VERSION_LABEL}</span>`)
      expect(formatVersion('1a2b3c4', '2026-10-07')).toBe('v1a2b3c4 · 2026-10-07')
    })

    it('a build with no git reads "dev", not "vdev"', () => {
      expect(formatVersion('dev', '2026-10-07')).toBe('dev · 2026-10-07')
    })

    it('has the short paragraph about the app being in development', () => {
      expect(render()).toContain('The app is in development and has no onboarding yet. You can learn words, and your progress is saved.')
    })

    it('links to the bot from the username: https://t.me/<username>', () => {
      const html = render({}, { botUsername: 'riopalabras_bot' })
      expect(html).toContain('href="https://t.me/riopalabras_bot"')
      expect(html).toContain('@riopalabras_bot')
      expect(html).toContain('rel="noopener noreferrer"')
    })

    it.each(['', '   ', 'REPLACE_ME', 'replace_me', 'bad name', '@', 'a'])('has no link row when the username is %j', (username) => {
      const html = render({}, { botUsername: username })
      expect(html).not.toContain('t.me')
      expect(html).not.toContain('Open the bot')
      expect(html).not.toMatch(/<a /)
    })

    describe('from the environment (VITE_BOT_USERNAME), when no username is passed in', () => {
      afterEach(() => vi.unstubAllEnvs())
      const fromEnv = () =>
        renderToStaticMarkup(
          createElement(SettingsScreen, { data: { settings: parseSettings({}), getSettings: () => parseSettings({}), applySettings: noop } as never, queue, theme: { choice: 'system', set: noop }, debugAllowed: false, onOpenDebug: noop }),
        )

      it('reads the username and builds the link', () => {
        vi.stubEnv('VITE_BOT_USERNAME', 'riopalabras_bot')
        expect(fromEnv()).toContain('href="https://t.me/riopalabras_bot"')
      })

      it('unset: no link row', () => {
        vi.stubEnv('VITE_BOT_USERNAME', undefined as never)
        const html = fromEnv()
        expect(html).not.toContain('t.me')
        expect(html).not.toContain('Open the bot')
      })

      it('REPLACE_ME (the placeholder): no link row', () => {
        vi.stubEnv('VITE_BOT_USERNAME', 'REPLACE_ME')
        expect(fromEnv()).not.toContain('t.me')
      })
    })
  })

  describe('debug', () => {
    it('is not in the DOM at all for someone who is not allowed: no row, no section label, no word "Debug"', () => {
      const html = render({}, { debugAllowed: false })
      expect(html).not.toContain('Debug')
      expect(html).not.toContain('settings-debug')
      expect(html).not.toContain('setting-nav')
    })

    it('for someone allowed it is one row labelled "Debug", a button that opens the Debug screen', () => {
      const html = render({}, { debugAllowed: true })
      const section = html.match(/<section class="settings-section" aria-labelledby="settings-debug">.*?<\/section>/)![0]
      expect(section.match(/<button/g)).toHaveLength(1)
      expect(section).toMatch(/<button type="button" class="setting-row setting-nav"><span class="setting-label">Debug<\/span>/)
    })
  })

  it('every row is at least 48px tall, and nothing in the new styles is a colour literal or a Telegram variable', () => {
    const css = readFileSync('src/index.css', 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
    const settings = css.slice(css.indexOf('.settings {'))
    expect(css).toMatch(/\.setting-row \{[^}]*min-height: 48px/s)
    expect(settings).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
    expect(settings).not.toMatch(/rgba?\(/)
    expect(settings).not.toContain('--tg-')
  })
})

describe('the bot link', () => {
  it('is built from a username, with or without a leading @, and the handle reads back', () => {
    expect(botLink('riopalabras_bot')).toBe('https://t.me/riopalabras_bot')
    expect(botLink('@riopalabras_bot')).toBe('https://t.me/riopalabras_bot')
    expect(botHandle('https://t.me/riopalabras_bot')).toBe('@riopalabras_bot')
  })
  it('is null for anything unusable, so the row is left out', () => {
    for (const bad of [undefined, null, '', 'REPLACE_ME', 'https://t.me/riopalabras_bot', 'has space', '1abcde', 'ab']) expect(botLink(bad as never), String(bad)).toBeNull()
  })
})

describe('where Back goes', () => {
  it('Settings goes Home; Debug goes back to Settings (its only way in); a word goes back to where it was opened', () => {
    expect(backTarget('settings', null)).toBe('home')
    expect(backTarget('debug', null)).toBe('settings')
    expect(backTarget('word', 'words')).toBe('words')
    expect(backTarget('word', 'home')).toBe('home')
    expect(backTarget('word', null)).toBe('home')
    for (const screen of ['learn', 'review', 'matching', 'cloze', 'words'] as const) expect(backTarget(screen, null)).toBe('home')
  })

  it('App uses it, opens Settings from the gear, and Debug only from Settings', () => {
    const app = readFileSync('src/App.tsx', 'utf8')
    expect(app).toMatch(/backTargetFor\(screen/)
    expect(app).toMatch(/onSettings=\{\(\) => setScreen\('settings'\)\}/)
    expect(app).toMatch(/onOpenDebug=\{\(\) => setScreen\('debug'\)\}/)
    expect(app).toMatch(/debugAllowed=\{debugAllowed\}/)
    expect(app).toMatch(/if \(!debugAllowed\) return <NotAvailable \/>/)
  })
})

describe('the theme choice, signed out', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('is kept in localStorage and read back, so a choice made signed out (or before the settings load) holds', () => {
    const items = new Map<string, string>()
    const storage = { getItem: (k: string) => items.get(k) ?? null, setItem: (k: string, v: string) => void items.set(k, v), removeItem: (k: string) => void items.delete(k) }
    expect(readStoredChoice(storage)).toBeNull()
    storeChoice('dark', storage)
    expect(items.get('riopalabras.theme.v1')).toBe('dark')
    expect(readStoredChoice(storage)).toBe('dark')
    storeChoice('light', storage)
    expect(readStoredChoice(storage)).toBe('light')
  })

  it('a storage that throws changes nothing', () => {
    const broken = { getItem: () => { throw new Error('blocked') }, setItem: () => { throw new Error('blocked') }, removeItem: () => {} }
    expect(readStoredChoice(broken)).toBeNull()
    expect(() => storeChoice('dark', broken)).not.toThrow()
  })
})
