import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { parseSettings } from '../data/settings'
import { createWriteQueue } from '../data/writeQueue'
import { botHandle, botLink } from '../lib/botLink'
import { setLanguage } from '../lib/language'
import { strings } from '../strings'
import { backTarget } from '../lib/nav'
import type { RemindersControl } from '../lib/useReminders'
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
      onOpenDebug: noop,
      botUsername: 'riopalabras_bot',
      ...props,
    }),
  )

const labels = (html: string) => [...html.matchAll(/<h2 id="settings-[a-z]+" class="settings-label">([^<]+)<\/h2>/g)].map((m) => m[1])

describe('the Settings screen', () => {
  it('has the header with a back button and the title, and the sections in this order: Learning, Language, Appearance, Notifications, About', () => {
    const html = render({}, { onBack: noop })
    expect(html).toContain('<h1>Settings</h1>')
    expect(html).toContain('class="back-link"')
    expect(labels(html)).toEqual(['Learning', 'Language', 'Appearance', 'Notifications', 'About'])
    expect(html).toMatch(/class="settings-label"/)
  })

  it('Debug is the sixth section, after About, for an account that unlocked it', () => {
    expect(labels(render({ debug_unlocked: true }))).toEqual(['Learning', 'Language', 'Appearance', 'Notifications', 'About', 'Debug'])
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

    it('a user who had a goal of 10 still sees 10; with no stored goal, the intro decides: 10 for an account that finished it (it has always had 10), 5 for one that has not', () => {
      expect(goal(render({ daily_new_word_limit: 10 }))).toBe('10')
      expect(goal(render({ onboarding_done: true }))).toBe('10')
      expect(goal(render({}))).toBe('5')
      expect(goal(render({ onboarding_done: false }))).toBe('5')
    })

    it('a stored goal is shown as stored, whether or not the intro was finished', () => {
      for (const done of [true, false]) for (const limit of [0, 5, 7, 10, 20]) expect(goal(render({ daily_new_word_limit: limit, onboarding_done: done })), `${limit} ${done}`).toBe(String(limit))
    })

    it('the buttons are off at the ends: nothing to decrease at 0, nothing to increase at 20', () => {
      expect(button(render({ daily_new_word_limit: 0 }), 'Decrease the daily goal')).toContain('disabled')
      expect(button(render({ daily_new_word_limit: 0 }), 'Increase the daily goal')).not.toContain('disabled')
      expect(button(render({ daily_new_word_limit: 20 }), 'Increase the daily goal')).toContain('disabled')
      expect(button(render({ daily_new_word_limit: 20 }), 'Decrease the daily goal')).not.toContain('disabled')
    })

    it('says what the goal means, under the stepper, at every value: the arithmetic, then that a bigger goal is a real choice too', () => {
      const why = 'Every word you learn comes back for review: at five new words a day that is roughly 20 to 30 reviews a day within a couple of months. A bigger goal is a real choice too: at ten a day the reviews come to about twice as many.'
      for (const limit of [0, 5, 10, 20]) {
        const html = render({ daily_new_word_limit: limit })
        expect(html, String(limit)).toContain(`<p class="setting-note">${why}</p>`)
        expect(html.indexOf('class="stepper"')).toBeLessThan(html.indexOf(why)) // under the stepper
      }
      expect(render({}).match(/class="setting-note"/g)).toHaveLength(1) // the one note, until the sessions note joins it from 16
    })

    it('in Russian too', () => {
      setLanguage('ru')
      try {
        expect(render({})).toContain('<p class="setting-note">Каждое выученное слово возвращается на повторение: при пяти новых словах в день через пару месяцев набирается 20–30 повторений ежедневно. Цель побольше — тоже нормальный выбор: при десяти словах повторений будет примерно вдвое\u00a0больше.</p>')
      } finally {
        setLanguage('en')
      }
    })

    it('the note about sessions of 10 appears above 15, and not at or below it', () => {
      const note = 'split into batches of 10 words'
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

    it('with both on, neither is disabled; with nothing stored both are on (the cards always showed both), and neither is disabled', () => {
      const both = render({ show_ru_translation: true, show_en_translation: true })
      expect(switchFor(both, 'language-ru')).not.toContain('disabled')
      expect(switchFor(both, 'language-en')).not.toContain('disabled')
      const none = render({})
      expect(switchFor(none, 'language-ru')).toContain('checked')
      expect(switchFor(none, 'language-en')).toContain('checked')
      expect(switchFor(none, 'language-ru')).not.toContain('disabled')
      expect(switchFor(none, 'language-en')).not.toContain('disabled')
    })

    it('an explicit "English off" from the Flutter app is kept: English stays off and Russian is the one that cannot be turned off', () => {
      const html = render({ show_en_translation: false })
      expect(switchFor(html, 'language-en')).not.toContain('checked')
      expect(switchFor(html, 'language-ru')).toContain('disabled')
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

  describe('notifications: the daily reminder', () => {
    const control = (over: Partial<RemindersControl> = {}): RemindersControl => ({ status: 'ready', shown: false, busy: false, notice: null, set: async () => {}, ...over })
    const switchOf = (html: string) => html.match(/<input id="daily-reminder"[^>]*>/)![0]

    it('is one labelled switch with a quiet line under the label saying 20:00 and "only when something is waiting"', () => {
      const html = render({}, { reminders: control() })
      expect(html).toMatch(/<label for="daily-reminder" class="setting-label">Daily reminder<\/label>/)
      expect(html).toContain('<span id="daily-reminder-hint" class="setting-hint">Comes around 20:00, and only when something is waiting.</span>')
      expect(switchOf(html)).toMatch(/type="checkbox" role="switch" class="switch"/)
      expect(switchOf(html)).toContain('aria-describedby="daily-reminder-hint"')
      expect(html).not.toContain('coming soon')
    })

    it('shows what the control says: off, on, and disabled while loading, unavailable or busy', () => {
      expect(switchOf(render({}, { reminders: control() }))).not.toContain('checked')
      expect(switchOf(render({}, { reminders: control() }))).not.toContain('disabled')
      expect(switchOf(render({}, { reminders: control({ shown: true }) }))).toContain('checked')
      for (const over of [{ status: 'loading' }, { status: 'unavailable' }, { busy: true }] as const) {
        expect(switchOf(render({}, { reminders: control(over) })), JSON.stringify(over)).toContain('disabled')
      }
      expect(switchOf(render())).toContain('disabled') // no control passed: nothing to turn on
    })

    it('says that Telegram did not allow messages, and where to allow them; or that saving failed; and nothing otherwise', () => {
      const declined = render({}, { reminders: control({ notice: 'declined' }) })
      expect(declined).toContain('<p id="daily-reminder-note" class="setting-note" role="status">Telegram did not allow messages. You can allow them from the bot&#x27;s chat.</p>')
      expect(switchOf(declined)).toContain('aria-describedby="daily-reminder-hint daily-reminder-note"')
      expect(render({}, { reminders: control({ notice: 'failed' }) })).toContain('Could not save this. Check your connection and try again.')
      expect(render({}, { reminders: control() })).not.toContain('daily-reminder-note')
    })

    it('tells the user, for an unreachable reminder, both steps in order, and that Start alone is not enough: two short sentences', () => {
      for (const language of ['en', 'ru'] as const) {
        setLanguage(language)
        try {
          const text = strings.settings.reminderUnreachable
          expect(text.match(/[.!?](\s|$)/g)).toHaveLength(2) // two sentences
          expect(text.length).toBeLessThan(135) // and short ones
          const steps = language === 'en' ? [/press Start/, /off and on again/, /Start alone is not enough/] : [/нажмите Start/, /выключите и снова включите/, /Одного нажатия Start недостаточно/]
          let at = -1
          for (const step of steps) {
            const found = text.search(step)
            expect(found, `${language}: ${step}`).toBeGreaterThan(at) // in this order: Start, then off and on, then "not enough"
            at = found
          }
        } finally {
          setLanguage('en')
        }
      }
    })

    it('says why nothing arrives under a switch that is on: paused after several reminders, or Telegram cannot deliver', () => {
      const paused = render({}, { reminders: control({ shown: true, notice: 'paused' }) })
      expect(paused).toContain('Paused — nothing was studied after several reminders. Turn it off and on to resume.</p>')
      expect(paused).toContain('role="status"')
      const unreachable = render({}, { reminders: control({ shown: true, notice: 'unreachable' }) })
      expect(unreachable).toContain('Open the bot&#x27;s chat and press Start, then switch this off and on again. Pressing Start alone is not enough.</p>')
      expect(switchOf(unreachable)).toContain('aria-describedby="daily-reminder-hint daily-reminder-note"')
    })

    it('says both of them in Russian', () => {
      setLanguage('ru')
      try {
        expect(render({}, { reminders: control({ shown: true, notice: 'paused' }) })).toContain('Приостановлено: после нескольких напоминаний вы не занимались. Чтобы возобновить, выключите напоминание и включите снова.</p>')
        expect(render({}, { reminders: control({ shown: true, notice: 'unreachable' }) })).toContain('Откройте чат с ботом и нажмите Start, затем выключите и снова включите напоминание. Одного нажатия Start недостаточно.</p>')
      } finally {
        setLanguage('en')
      }
    })

    it('in Russian', () => {
      setLanguage('ru')
      try {
        const html = render({}, { reminders: control({ notice: 'declined' }) })
        expect(html).toContain('Ежедневное напоминание')
        expect(html).toContain('Приходит около 20:00 и только если есть что повторять.')
        expect(html).toContain('Telegram не разрешил сообщения. Разрешить их можно в чате с ботом.')
        expect(render({}, { reminders: control({ notice: 'failed' }) })).toContain('Не удалось сохранить. Проверьте соединение и попробуйте еще раз.')
      } finally {
        setLanguage('en')
      }
    })
  })

  describe('about', () => {
    const rows = (html: string) => [...html.matchAll(/<button type="button" class="setting-row setting-nav"><span class="setting-label">([^<]+)<\/span>/g)].map((m) => m[1])

    it('the section opens with a row to the About screen, ahead of "How it works" (each row is there only when there is something to open)', () => {
      const html = render({}, { onOpenAbout: noop, onOpenHow: noop, onRunIntro: noop })
      expect(rows(html)).toEqual(['About Riopalabras', 'How it works', 'Run the intro again'])
      expect(rows(render({}, { onOpenHow: noop }))).toEqual(['How it works'])
      expect(render()).not.toContain('About Riopalabras')
    })

    it('in Russian the row is «О Riopalabras»', () => {
      setLanguage('ru')
      try {
        expect(rows(render({}, { onOpenAbout: noop }))).toEqual(['О Riopalabras'])
      } finally {
        setLanguage('en')
      }
    })

    it('the version is not here any more: it is on the About screen, with the seven taps', () => {
      const html = render({}, { onOpenAbout: noop })
      expect(html).not.toContain('setting-version')
      expect(html).not.toMatch(/Version|Версия/)
    })

    it('has the short paragraph about what the app is and where progress goes', () => {
      expect(render()).toContain('Learn the Spanish of Uruguay and Argentina one word at a time. Your progress is saved to your account.')
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
          createElement(SettingsScreen, { data: { settings: parseSettings({}), getSettings: () => parseSettings({}), applySettings: noop } as never, queue, theme: { choice: 'system', set: noop }, onOpenDebug: noop }),
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

  describe("what's new", () => {
    const NOW = new Date(2026, 0, 31, 12, 0)
    const entry = (id: string, at: string) => ({ id, at, en: { title: id, text: id }, ru: { title: id, text: id } })
    const NEWS = [entry('b', '2026-01-30T10:00'), entry('a', '2026-01-10T08:30')]
    const props = { onOpenWhatsNew: noop, onOpenAbout: noop, onOpenHow: noop, news: NEWS, now: NOW }
    const unreadRow = /<button type="button" class="setting-row setting-nav" aria-label="What&#x27;s new, unread"><span class="setting-label">What&#x27;s new<span class="news-dot news-dot-inline" aria-hidden="true"><\/span><\/span>/
    const readRow = '<button type="button" class="setting-row setting-nav"><span class="setting-label">What&#x27;s new</span>'

    it('while something is unread the row leads the screen, above Learning, with a dot and a label that says so', () => {
      const html = render({}, props)
      expect(html).toMatch(unreadRow)
      expect(html.indexOf("What&#x27;s new")).toBeLessThan(html.indexOf('id="settings-learning"'))
      expect(html.match(/What&#x27;s new/g)).toHaveLength(3) // the section's label, the row's label and the row's accessible name; the row is not also in About
      expect(html).not.toContain(readRow)
    })

    it('an older watermark is still unread, the newest one is read', () => {
      expect(render({ whats_new_seen: '2026-01-10T08:30' }, props)).toMatch(unreadRow)
      expect(render({ whats_new_seen: '2026-01-30T10:00' }, props)).not.toContain('news-dot')
    })

    it('once read the row settles into About, after "How it works" and before "Run the intro again", with no dot', () => {
      const html = render({ whats_new_seen: '2026-01-30T10:00' }, { ...props, onRunIntro: noop })
      expect(html).toContain(readRow)
      expect(html).not.toContain('news-dot')
      expect(html).not.toContain('unread')
      const rows = [...html.matchAll(/<button type="button" class="setting-row setting-nav"><span class="setting-label">([^<]+)<\/span>/g)].map((m) => m[1])
      expect(rows).toEqual(['About Riopalabras', 'How it works', 'What&#x27;s new', 'Run the intro again'])
      expect(html.indexOf(readRow)).toBeGreaterThan(html.indexOf('id="settings-about"'))
    })

    it('with no current entry there is no row at all (an expired list is not a dead end), and with no way to open it there is none either', () => {
      expect(render({}, { ...props, news: [] })).not.toContain('What&#x27;s new')
      expect(render({}, { ...props, news: [entry('stale', '2025-06-01T10:00')] })).not.toContain('What&#x27;s new')
      expect(render({}, { ...props, onOpenWhatsNew: undefined })).not.toContain('What&#x27;s new')
    })

    it('the section order is not changed by the row: the labelled sections are the same with or without it', () => {
      expect(labels(render({}, props))).toEqual(['Learning', 'Language', 'Appearance', 'Notifications', 'About'])
      expect(labels(render({ whats_new_seen: '2026-01-30T10:00' }, props))).toEqual(['Learning', 'Language', 'Appearance', 'Notifications', 'About'])
    })

    it('in Russian: «Что нового», «Что нового, есть непрочитанное»', () => {
      setLanguage('ru')
      try {
        const unread = render({}, props)
        expect(unread).toContain('aria-label="Что нового, есть непрочитанное"')
        expect(unread).toContain('Что нового<span class="news-dot')
        expect(render({ whats_new_seen: '2026-01-30T10:00' }, props)).toContain('<span class="setting-label">Что нового</span>')
      } finally {
        setLanguage('en')
      }
    })
  })

  describe('debug', () => {
    it('is not in the DOM at all until it is unlocked: no row, no section label, no word "Debug"', () => {
      const html = render({})
      expect(html).not.toContain('Debug')
      expect(html).not.toContain('settings-debug')
      expect(html).not.toContain('setting-nav')
    })

    it('unlocked it is one section with two rows: "Debug", a button that opens the Debug screen, and "Lock Debug"', () => {
      const html = render({ debug_unlocked: true })
      const section = html.match(/<section class="settings-section" aria-labelledby="settings-debug">.*?<\/section>/)![0]
      expect(section.match(/<button/g)).toHaveLength(2)
      expect(section).toMatch(/<button type="button" class="setting-row setting-nav"><span class="setting-label">Debug<\/span>/)
    })

    describe('unlocked with seven taps on the version row (debug_unlocked in the settings blob)', () => {
      it('an account that unlocked it sees the section, with a second row to lock it again', () => {
        const html = render({ debug_unlocked: true })
        const section = html.match(/<section class="settings-section" aria-labelledby="settings-debug">.*?<\/section>/)![0]
        expect(section.match(/<button/g)).toHaveLength(2)
        expect(section).toContain('<span class="setting-label">Debug</span>')
        expect(section).toContain('<span class="setting-label">Lock Debug</span>')
      })

      it('an account that did not never sees the word, and nothing about a lock', () => {
        for (const raw of [{}, { debug_unlocked: false }, { debug_unlocked: 'true' }]) {
          const html = render(raw)
          expect(html, JSON.stringify(raw)).not.toContain('Debug')
          expect(html).not.toContain('Lock')
        }
      })

      it('in Russian the lock row is «Заблокировать Debug»', () => {
        setLanguage('ru')
        try {
          expect(render({ debug_unlocked: true })).toContain('<span class="setting-label">Заблокировать Debug</span>')
        } finally {
          setLanguage('en')
        }
      })

      it('nothing on screen hints at the gesture: Settings says nothing of taps or unlocking (the version row, in About, is a plain row: see About.test.ts)', () => {
        const html = render({}, { onOpenAbout: noop })
        expect(html).not.toMatch(/tap|unlock|developer/i)
      })

      it('the version row\'s style gives no sign it can be tapped: no pointer, no highlight flash, no text selection from quick taps', () => {
        const css = readFileSync('src/index.css', 'utf8')
        const rule = css.match(/\.setting-version \{([^}]*)\}/)![1]
        expect(rule).toMatch(/-webkit-tap-highlight-color: transparent/)
        expect(rule).toMatch(/user-select: none/)
        expect(rule).not.toMatch(/cursor/)
      })

      it('no Telegram id, and nothing personal, in the code that does it', () => {
        for (const file of ['src/lib/tapCount.ts', 'src/screens/Settings.tsx', 'src/screens/About.tsx', 'src/data/settingsActions.ts']) {
          const code = readFileSync(file, 'utf8')
          expect(code, file).not.toMatch(/\b\d{6,}\b/) // a Telegram id is a long number
          expect(code, file).not.toMatch(/telegram_id|tg_\d|initDataUnsafe|@telegram/i)
        }
      })
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
    expect(backTarget('whatsnew', null)).toBe('settings')
    expect(backTarget('whatsnew', 'home')).toBe('settings')
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
    expect(app).toMatch(/if \(!debugUnlocked\) return <NotAvailable \/>/)
  })

  it("App opens What's new from Settings and gives it the same Back as the other screens under Settings", () => {
    const app = readFileSync('src/App.tsx', 'utf8')
    expect(app).toMatch(/onOpenWhatsNew=\{\(\) => setScreen\('whatsnew'\)\}/)
    expect(app).toMatch(/screen === 'whatsnew' && readyData && queue\) return <WhatsNewScreen data=\{readyData\} queue=\{queue\} onBack=\{inPageBack\} \/>/)
  })

  it('App lets Debug in only for an account that unlocked it, and opens every screen at the top of the page', () => {
    const app = readFileSync('src/App.tsx', 'utf8')
    // App is not rendered by any test: the two lines that make the gesture and the scroll fix real are pinned
    expect(app).toMatch(/const debugUnlocked = readyData\?\.settings\.debugUnlocked \?\? false/)
    expect(app).toMatch(/useScreenScroll\(screen, open\?\.from \?\? null\)/)
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
