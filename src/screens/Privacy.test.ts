import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it } from 'vitest'
import config, { PRIVACY_ROUTE } from '../../vite.config'
import { FEEDBACK_TABLE, toFeedbackRow } from '../data/feedback'
import { rowFromValues, blankValues } from '../data/customWords'
import { toMetricsRow, toProgressRow, toReviewLogRow } from '../data/writes'
import { emptyRow } from '../data/metrics'
import { CRITICAL_TABLES, NON_CRITICAL_TABLES } from '../data/overlay'
import { REVIEW_LOG_TABLE } from '../data/reviewLog'
import { turnReminderOn, type ReminderPatch } from '../data/reminders'
import { setLanguage } from '../lib/language'
import { resolveScheme, readThemeEnv, type ThemeChoice } from '../lib/theme'
import { PRIVACY_UPDATED } from '../lib/privacy'
import { en, strings, type Strings } from '../strings'
import { ru } from '../strings.ru'
import { ACCOUNT_EMAIL_EXAMPLE } from '../lib/links'
import { PrivacyPage } from './Privacy'

afterEach(() => setLanguage('en'))

const read = (file: string) => readFileSync(file, 'utf8')
/** The app's own source files (not the tests, not the test harnesses). */
const walkSources = (): string[] => {
  const out: string[] = []
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const path = `${dir}/${name}`
      if (statSync(path).isDirectory()) {
        if (path !== 'src/testing') walk(path)
      } else if (/\.(ts|tsx)$/.test(name) && !/\.test\./.test(name)) out.push(path)
    }
  }
  walk('src')
  return out
}
const render = () => renderToStaticMarkup(createElement(PrivacyPage))
const text = (html: string) =>
  html
    .replace(/<[^>]*>/g, (tag) => (/^<\/?(h1|h2|p|div|section|main|header|button|li|ul)\b/.test(tag) ? ' ' : ''))
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim()
const headings = (html: string) => [...html.matchAll(/<h2 id="privacy-([a-z-]+)">([^<]+)<\/h2>/g)].map((m) => `${m[1]}:${m[2].replace(/&#x27;/g, "'")}`)
/** All the words of the privacy page in one language as one string: the claims below are looked for in it. */
const pageText = (map: Strings) => [map.privacy.intro, ...map.privacy.sections.flatMap((s) => [s.heading, ...s.paragraphs])].join(' ')
const wordCount = (map: Strings) => pageText(map).replace(/[{}]/g, '').split(/\s+/).filter(Boolean).length

describe('the privacy page, as drawn', () => {
  it('English: a title, the language switch, an intro, four sections in this order, and the date', () => {
    const html = render()
    expect(html).toContain('<h1>Privacy</h1>')
    expect(html).toContain('role="radiogroup" aria-label="Language"')
    expect(html.match(/role="radio"/g)).toHaveLength(2)
    expect(text(html)).toContain('Riopalabras is a free app for learning the Spanish of Uruguay and Argentina, inside Telegram.')
    expect(headings(html)).toEqual(['stored:What it keeps', 'shared:Who else sees it', 'ads:What\'s not here', 'delete:Deleting your data'])
    expect(text(html)).toContain('Last updated: 25 October 2026')
  })

  it('Russian: the same, in Russian, with the date written as Russian writes it', () => {
    setLanguage('ru')
    const html = render()
    expect(html).toContain('<h1>Конфиденциальность</h1>')
    expect(html).toContain('aria-label="Язык"')
    expect(headings(html)).toEqual(['stored:Что хранится', 'shared:Кто еще это видит', 'ads:Чего здесь нет', 'delete:Удаление данных'])
    expect(text(html)).toContain('Последнее обновление: 25 октября 2026 г.')
  })

  it('the language switch names each language in its own language, and marks the one shown', () => {
    const html = render()
    expect(html).toContain('<button type="button" lang="en" class="segment is-active" role="radio" aria-checked="true">English</button>')
    expect(html).toContain('<button type="button" lang="ru" class="segment" role="radio" aria-checked="false">Русский</button>')
  })

  it('no {token} is left in the text in either language, and the account address and the handle are drawn where the tokens were', () => {
    for (const language of ['en', 'ru'] as const) {
      setLanguage(language)
      const html = render()
      expect(html, language).not.toMatch(/[{}]/)
      expect(html.replace(/<wbr\/>/g, ''), language).toContain(`<code class="privacy-code">${ACCOUNT_EMAIL_EXAMPLE}</code>`) // with a place to break after each @ and .
      expect(html, language).toContain('<code class="privacy-code">tg_123456789@<wbr/>')
      expect(html.match(/<a href="https:\/\/t\.me\/valeranevermind" target="_blank" rel="noopener noreferrer">@valeranevermind<\/a>/g), language).toHaveLength(1) // in "Deleting your data"
    }
  })

  it('the only link on the page is to the author on Telegram', () => {
    expect([...render().matchAll(/href="([^"]+)"/g)].map((m) => m[1])).toEqual(['https://t.me/valeranevermind'])
  })

  it('stays short: well under half of what the first version was (854 words in English, 740 in Russian; this one is about 43%)', () => {
    expect(wordCount(en)).toBeLessThan(400)
    expect(wordCount(ru)).toBeLessThan(360)
  })

  it('names every party that gets data, in both languages: Telegram, Supabase, Vercel, Railway, Gemini, Google Fonts', () => {
    for (const map of [en, ru]) for (const name of ['Telegram', 'Supabase', 'Vercel', 'Railway', 'Gemini', 'Google Fonts']) expect(pageText(map), name).toContain(name)
    expect(pageText(en)).toContain('A word you add goes to Google\'s Gemini') // the added word is said to leave for Gemini, in so many words
    expect(pageText(ru)).toContain('Добавленное вами слово уходит в Gemini')
  })

  it('nothing on the page is a literal of the component: the words are the strings\', the addresses are links.ts\'', () => {
    const source = read('src/screens/Privacy.tsx')
    expect(source).not.toMatch(/https?:\/\//)
    const leaves = (node: unknown): string[] => (typeof node === 'string' ? [node] : node && typeof node === 'object' ? Object.values(node).flatMap(leaves) : [])
    for (const leaf of [...leaves(en.privacy), ...leaves(ru.privacy)].filter((l) => l.includes(' ') && l.length > 6)) expect(source, leaf).not.toContain(leaf)
  })
})

// ---------------------------------------------------------------------------------------------------------------------------------------------
// Every statement the page makes about what is stored is checked against the code that stores it. A test below fails when the code changes in a
// way the page does not yet say: add the table, the column, the key, the host to the page (both languages), then to the list here.
// ---------------------------------------------------------------------------------------------------------------------------------------------

describe('what is stored: the page names every table the app touches', () => {
  const TABLES = ['feedback', 'reminders', 'review_log', 'user_daily_metrics', 'user_favorites', 'user_hidden_words', 'user_progress', 'user_settings', 'user_words']

  it('the tables the code reads or writes are exactly these nine', () => {
    const named = new Set<string>([...CRITICAL_TABLES, ...NON_CRITICAL_TABLES, REVIEW_LOG_TABLE, FEEDBACK_TABLE])
    for (const file of walkSources()) for (const m of read(file).matchAll(/\.from\('([a-z0-9_]+)'\)/g)) named.add(m[1])
    expect([...named].sort()).toEqual(TABLES)
  })

  // table → the plain phrase, in each language, that says what it holds
  const PHRASE_OF_TABLE: Record<string, { en: string[]; ru: string[] }> = {
    user_progress: { en: ['your progress on each word'], ru: ['прогресс по каждому слову'] },
    user_favorites: { en: ['set to Learn sooner'], ru: ['«Учить раньше»'] },
    user_hidden_words: { en: ['Learn sooner or hide'], ru: ['скрытые вами слова'] },
    user_words: { en: ['the words you add yourself'], ru: ['добавленные вами слова'] },
    user_settings: { en: ['your settings'], ru: ['настройки'] },
    user_daily_metrics: { en: ['a summary for each day'], ru: ['сводка за день'] },
    review_log: { en: ['Every answer you give is logged'], ru: ['Каждый ответ записывается'] },
    reminders: { en: ["your device's time zone if you switch on the reminder"], ru: ['часовой пояс устройства, если включено напоминание'] },
    feedback: { en: ['what you write to us'], ru: ['ваши обращения к нам вместе со словом, версией приложения, языком, экраном и платформой Telegram'] },
  }

  it('each table is said in the page, in plain words, in both languages (and so are the account, the translation count and the device)', () => {
    expect(Object.keys(PHRASE_OF_TABLE).sort()).toEqual(TABLES)
    for (const table of TABLES) {
      for (const phrase of PHRASE_OF_TABLE[table].en) expect(pageText(en), `${table}: ${phrase}`).toContain(phrase)
      for (const phrase of PHRASE_OF_TABLE[table].ru) expect(pageText(ru), `${table}: ${phrase}`).toContain(phrase)
    }
    expect(pageText(en)).toContain('Your account comes from your Telegram ID')
    expect(pageText(en)).toContain("today's count of automatic translations")
    expect(pageText(en)).toContain("unsent changes and your sign-in stay in Telegram's browser storage")
  })
})

describe('what is stored: the columns the code writes are the ones the page describes', () => {
  const keys = (row: object) => Object.keys(row).sort()

  it('progress: the word, when it is due, interval, repetitions, ease (and when it was written)', () => {
    const row = toProgressRow('u', { esWord: 'casa', easeFactor: 2.5, interval: 1, repetitions: 1, nextReview: new Date(0) }, '2026-01-01T00:00:00.000Z')
    expect(keys(row)).toEqual(['ease_factor', 'es_word', 'interval_days', 'next_review', 'repetitions', 'updated_at', 'user_id'])
    expect(pageText(en)).toContain('your progress on each word') // the page says "progress", which is what these columns are
  })

  it('study history: one row per answer (word, time, rating, mode, how long, schedule) and one per day (counts, due, active)', () => {
    const answer = toReviewLogRow('u', { id: 'i', esWord: 'casa', reviewedAt: 'x', rating: 3, mode: 'review', stateBefore: 'new', elapsedDays: 0, scheduledDays: 1, intervalAfter: 0, easeAfter: 2.5, repetitionsAfter: 1, sessionId: null, durationMs: 1 })
    expect(keys(answer)).toEqual(['algo', 'difficulty_after', 'duration_ms', 'ease_after', 'elapsed_days', 'es_word', 'id', 'interval_after', 'mode', 'rating', 'repetitions_after', 'reviewed_at', 'scheduled_days', 'session_id', 'stability_after', 'state_before', 'user_id'])
    expect(keys(toMetricsRow('u', emptyRow('2026-01-01'), 'x'))).toEqual(['active', 'daily_limit', 'date', 'due_at_start', 'learn_pool', 'new_words', 'reviews_done', 'reviews_lapsed', 'updated_at', 'user_id'])
    // what the page lists for an answer is a true part of that row (the word, the time, the rating, the duration), and it says there is a daily summary too
    expect(pageText(en)).toContain('Every answer you give is logged (the word, the time, your rating, how long you took), with a summary for each day')
    for (const column of ['es_word', 'reviewed_at', 'rating', 'duration_ms']) expect(keys(answer)).toContain(column)
  })

  it('your own words: the word as typed, translations, example and its translations, part of speech, region and register', () => {
    // word_form_in_example is the example's own word, as it stands in the sentence (so the card can highlight it): part of the example, not a new kind of data, and the page's
    // words ("the words you add yourself") already cover it; adding it to the list changes the guard, not the policy, so PRIVACY_UPDATED does not move.
    expect(keys(rowFromValues(blankValues()))).toEqual(['en_translation', 'es_rioplatense', 'es_standard', 'example_sentence', 'example_translation_en', 'example_translation_ru', 'es_word', 'is_rioplatense_variant', 'pos', 'region', 'register', 'ru_translation', 'word_form_in_example'].sort())
    expect(pageText(en)).toContain('the words you add yourself') // the translations, the example and the notes of such a word are the words themselves
  })

  it('messages to us: the text, the word, the version, the language, the screen, the platform; the time and the id are the database\'s and the app\'s', () => {
    const row = toFeedbackRow('u', { id: 'i', kind: 'word', esWord: 'casa', message: 'm', appVersion: 'v', uiLanguage: 'en', screen: 'word', platform: 'ios' })
    expect(keys(row)).toEqual(['app_version', 'es_word', 'id', 'kind', 'message', 'platform', 'screen', 'ui_language', 'user_id'])
    expect(pageText(en)).toContain('what you write to us, with the word, app version, language, screen and Telegram platform')
    for (const column of ['message', 'es_word', 'app_version', 'ui_language', 'screen', 'platform']) expect(keys(row)).toContain(column)
    expect(JSON.stringify(row)).not.toMatch(/telegram_id|first_name|username|email/) // a message carries no name...
    expect(keys(row)).toContain('user_id') // ...but the stored message is tied to the account, and the page says so (the database is not anonymous even though the bot's message is)
    expect(pageText(en)).toContain('the message is stored in the database under your account')
    expect(pageText(ru)).toContain('обращение хранится в базе вместе с аккаунтом')
  })

  it('the reminder: the app writes two columns, switched on and the time zone; the rest of the row is the server\'s', async () => {
    const written: ReminderPatch[] = []
    await turnReminderOn({ read: async () => null, write: async (p) => void written.push(p), update: async () => {} }, async () => true, 'America/Montevideo')
    expect(written.map((p) => Object.keys(p).sort())).toEqual([['enabled', 'timezone']])
    expect(pageText(en)).toContain("your device's time zone if you switch on the reminder")
  })

  it('settings: the keys the app reads from the blob are these, and the page names the kinds of thing they are', () => {
    const keysRead = [...new Set([...read('src/data/settings.ts').matchAll(/raw\.([a-z_]+)/g)].map((m) => m[1]))].sort()
    expect(keysRead).toEqual(['cards_done_today_count', 'cards_done_today_date', 'daily_new_word_limit', 'debug_unlocked', 'new_words_learned_today_count', 'new_words_learned_today_date', 'pending_word_deletes', 'reminder_offer_shown', 'show_en_translation', 'show_ru_translation', 'start_rank', 'streak_count', 'streak_last_activity_date'])
    expect(pageText(en)).toContain('your settings')
  })

  it('translations used today: a count (the proxy\'s enrichment_usage, one per account per day)', () => {
    expect(pageText(en)).toContain("today's count of automatic translations")
  })
})

describe('what is stored on the device, and what is not used', () => {
  it('the keys written to the device\'s storage are these five families (and the sign-in session supabase-js keeps itself)', () => {
    const keys = new Set<string>()
    for (const file of walkSources()) for (const m of read(file).matchAll(/['"`](riopalabras\.[A-Za-z0-9.]+)/g)) keys.add(m[1])
    expect([...keys].sort()).toEqual(['riopalabras.dailyMetrics.v1.', 'riopalabras.language.v1', 'riopalabras.reviewLog.learnedAt.v1.', 'riopalabras.theme.v1', 'riopalabras.writeQueue.v1.'])
    expect(pageText(en)).toContain("unsent changes and your sign-in stay in Telegram's browser storage")
  })

  it('"the app uses no cookies" is true of the code: no cookie is read or written, and no other store is used', () => {
    for (const file of walkSources()) {
      const code = read(file)
      expect(code, file).not.toMatch(/document\.cookie|sessionStorage|indexedDB/)
    }
    expect(pageText(en)).toContain('No cookies;')
    expect(pageText(ru)).toContain('Куки приложение не использует')
  })

  it('"no advertising and no analytics" is true of the code: no such library, no beacon, no tracker, and the only dependencies are the three', () => {
    const pkg = JSON.parse(read('package.json')) as { dependencies: Record<string, string> }
    expect(Object.keys(pkg.dependencies).sort()).toEqual(['@supabase/supabase-js', 'react', 'react-dom'])
    for (const file of [...walkSources(), 'index.html', 'privacy.html']) {
      expect(read(file), file).not.toMatch(/sendBeacon|gtag\(|googletagmanager|google-analytics|analytics\.js|segment\.com|mixpanel|amplitude|posthog|sentry\.io|@sentry|plausible\.io|hotjar|fbq\(|adsbygoogle|doubleclick/i)
    }
    expect(en.privacy.sections.find((s) => s.id === 'ads')!.paragraphs[0]).toContain('No advertising, no analytics, nothing sold.')
    expect(ru.privacy.sections.find((s) => s.id === 'ads')!.paragraphs[0]).toContain('Ни рекламы, ни аналитики; данные не продаются.')
  })

  it('the only other sites the app\'s own page loads from are Google Fonts and Telegram\'s script, and the page says so', () => {
    const hosts = new Set([...read('index.html').matchAll(/(?:src|href)="https:\/\/([^/"]+)/g)].map((m) => m[1]))
    expect([...hosts].sort()).toEqual(['fonts.googleapis.com', 'fonts.gstatic.com', 'telegram.org'])
    expect(pageText(en)).toContain('Google Fonts loads the fonts, so Google sees your IP address when the app opens')
    expect(pageText(en)).toContain('the app loads its script from telegram.org')
    expect(pageText(ru)).toContain('Google Fonts загружает шрифты, поэтому Google видит ваш IP-адрес')
  })

  it('the app never asks Telegram for a phone number, contacts or a location, so "not stored" holds from the first step', () => {
    for (const file of walkSources()) expect(read(file), file).not.toMatch(/requestContact|LocationManager|getLocation|requestPhone|ContactsRequest|readTextFromClipboard|CloudStorage|SecureStorage|DeviceStorage/)
  })

  it('the app sends the launch data to our server for sign-in, a word to it for translation, and fetches only its own static files besides', () => {
    const users = walkSources()
      .filter((f) => /\bfetch\(/.test(read(f)))
      .sort()
    expect(users).toEqual(['src/data/dictionary.ts', 'src/lib/auth.ts'])
    expect(read('src/lib/auth.ts')).toMatch(/body: JSON\.stringify\(\{ initData \}\)/)
    // an added word: the word and (unless it is "Other") its part of speech, nothing else
    expect(read('src/data/enrich.ts')).toMatch(/const entry: \{ word: string; pos\?: string \} = \{ word: input\.word \}/)
    expect(read('src/data/enrich.ts')).toMatch(/body: JSON\.stringify\(\{ words: \[entry\] \}\)/)
  })
})

describe('the page and the delete instruction use the app\'s own names', () => {
  it('"Settings → About → Write to us" is what the app calls them, in each language (and Learn sooner is what the lists item calls the star)', () => {
    const deletes = (map: Strings) => map.privacy.sections.find((s) => s.id === 'delete')!.paragraphs[0]
    expect(deletes(en)).toContain(`${en.settings.title} → ${en.settings.about} → ${en.feedback.open}`)
    expect(deletes(ru)).toContain(`${ru.settings.title} → ${ru.settings.about} → ${ru.feedback.open}`)
    expect(pageText(en)).toContain(`set to ${en.words.learnSooner}`)
    expect(pageText(ru)).toContain(`«${ru.words.learnSooner}»`)
  })

  it('the deletion paragraph names the author\'s handle (it is also the contact), and nothing in the page offers a way to delete in the app', () => {
    for (const map of [en, ru]) {
      expect(map.privacy.sections.find((s) => s.id === 'delete')!.paragraphs[0]).toContain('{handle}')
      expect(map.privacy.sections.map((s) => s.id)).toEqual(['stored', 'shared', 'ads', 'delete'])
    }
    expect(render()).not.toMatch(/<button[^>]*>[^<]*(Delete|Удалить)/)
  })

  // The page says deleting the account removes everything stored under it, because the database is set up that way: the owner ran a catalogue query on the live
  // database (2026-10-19) and every table that has user_id cascades when the auth user is deleted. This is that list; the sentence is allowed to say "everything"
  // only while every table the code uses is on it. A new table fails the tests below until its cascade has been checked and it is added here.
  const VERIFIED_CASCADE = ['enrichment_usage', 'feedback', 'reminders', 'review_log', 'user_daily_metrics', 'user_favorites', 'user_hidden_words', 'user_progress', 'user_settings', 'user_words']
  const deletes = (map: Strings) => map.privacy.sections.find((s) => s.id === 'delete')!.paragraphs[0]

  it('the deletion sentence says what was verified, and no more: the account goes and takes everything stored under it with it, the database being set up that way; Telegram\'s history and the hosts\' logs are said to be outside', () => {
    expect(deletes(en)).toContain('The author deletes your account, and that removes everything stored under it: the database is set up so that all of it goes together.')
    expect(deletes(ru)).toContain('Автор удалит аккаунт, и вместе с ним удалится всё, что под ним хранится: база данных устроена так, что всё уходит вместе.')
    expect(deletes(en)).toContain("Telegram's own history and the hosts' logs follow their rules.")
    expect(deletes(ru)).toContain('История переписки в Telegram и журналы хостингов подчиняются их правилам.')
    for (const map of [en, ru]) expect(deletes(map)).not.toMatch(/logs? (are|is|get|will be) (deleted|removed)|журналы[^.]*(удал|стира)/i) // it does not claim what the database cannot do
  })

  it('every table the web app uses is on the verified list (so "everything stored under it" is still true of it)', () => {
    const used = new Set<string>([...CRITICAL_TABLES, ...NON_CRITICAL_TABLES, REVIEW_LOG_TABLE, FEEDBACK_TABLE])
    for (const file of walkSources()) for (const m of read(file).matchAll(/\.from\('([a-z0-9_]+)'\)/g)) used.add(m[1])
    expect([...used].filter((t) => !VERIFIED_CASCADE.includes(t))).toEqual([])
  })
})

describe('the policy text and its date move together', () => {
  // When this fails the policy changed in substance: set PRIVACY_UPDATED in src/lib/privacy.ts to the day of the change, then put the new value here.
  // A change of spelling (е for ё) or of spacing is not a change of the policy, so the text is compared normalised: е and ё are one letter and
  // whitespace is one space. The fingerprint is still of the real text, just read that way; it never skips a word.
  const FINGERPRINT = '15969cba2798137b'
  const normalise = (text: string) => text.replace(/ё/g, 'е').replace(/Ё/g, 'Е').replace(/\s+/g, ' ').trim()
  const fingerprintOf = (privacy: { en: unknown; ru: unknown }) =>
    createHash('sha256')
      .update(JSON.stringify(privacy, (_k, v) => { const value = typeof v === 'function' ? v('DATE') : v; return typeof value === 'string' ? normalise(value) : value }))
      .digest('hex')
      .slice(0, 16)
  const fingerprint = () => fingerprintOf({ en: en.privacy, ru: ru.privacy })
  /** The same privacy text with every string (and every string a function returns) passed through f. */
  const mapText = (value: unknown, f: (text: string) => string): unknown =>
    typeof value === 'string' ? f(value)
    : typeof value === 'function' ? (...args: unknown[]) => mapText((value as (...a: unknown[]) => unknown)(...args), f)
    : Array.isArray(value) ? value.map((x) => mapText(x, f))
    : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).map(([k, x]) => [k, mapText(x, f)]))
    : value
  const raw = (privacy: { en: unknown; ru: unknown }) => JSON.stringify(privacy, (_k, v) => (typeof v === 'function' ? v('DATE') : v))

  it('is the text as it was when it was last dated', () => {
    expect({ updated: PRIVACY_UPDATED, text: fingerprint() }, 'the policy changed in substance: update PRIVACY_UPDATED, then this fingerprint').toEqual({ updated: '2026-10-25', text: FINGERPRINT })
  })

  it('does not move for spelling or spacing: е and ё are the same letter, and a run of whitespace is one space', () => {
    const original = { en: en.privacy, ru: ru.privacy }
    const respelled = { en: mapText(en.privacy, (t) => t), ru: mapText(ru.privacy, (t) => t.replace(/еще/g, 'ещё').replace(/всё/g, 'все')) }
    const spaced = { en: mapText(en.privacy, (t) => `  ${t.replace(/ /g, '   ')}\n`), ru: mapText(ru.privacy, (t) => `\n${t.replace(/ /g, ' \t ')} `) }
    expect(raw(respelled), 'the respelled copy must differ from the original, or this proves nothing').not.toEqual(raw(original))
    expect(raw(spaced), 'the re-spaced copy must differ from the original, or this proves nothing').not.toEqual(raw(original))
    expect(fingerprintOf(respelled)).toBe(fingerprint())
    expect(fingerprintOf(spaced)).toBe(fingerprint())
  })

  it('moves for a change of substance, in either language: a word changed, a sentence added, a sentence removed', () => {
    const base = fingerprint()
    const original = { en: en.privacy, ru: ru.privacy }
    const changes: [string, { en: unknown; ru: unknown }][] = [
      ['a word changed in Russian', { en: en.privacy, ru: mapText(ru.privacy, (t) => t.replace('Telegram', 'Facebook')) }],
      ['a word changed in English', { en: mapText(en.privacy, (t) => t.replace('Telegram', 'Facebook')), ru: ru.privacy }],
      ['a sentence added in Russian', { en: en.privacy, ru: mapText(ru.privacy, (t) => `${t} Мы передаем данные рекламодателям.`) }],
      ['a sentence added in English', { en: mapText(en.privacy, (t) => `${t} We share data with advertisers.`), ru: ru.privacy }],
      ['a sentence removed in Russian', { en: en.privacy, ru: mapText(ru.privacy, (t) => t.replace(/[^.]*\.\s*$/, '')) }],
      ['a sentence removed in English', { en: mapText(en.privacy, (t) => t.replace(/[^.]*\.\s*$/, '')), ru: ru.privacy }],
    ]
    for (const [name, changed] of changes) {
      expect(raw(changed), `${name}: the changed copy must differ from the original`).not.toEqual(raw(original))
      expect(fingerprintOf(changed), name).not.toBe(base)
    }
  })
})

// ---------------------------------------------------------------------------------------------------------------------------------------------
// What the code on the OTHER side stores (the proxy: telegram-auth.js, server.js, enrich-route.js, the feedback and reminder jobs). The repository
// sits next to this one; where it is not there (a fresh clone of this repo alone) these are skipped, and the page is only as checked as the rest.
// ---------------------------------------------------------------------------------------------------------------------------------------------

// RIOPALABRAS_PROXY_DIR points the checks at another copy of the proxy (the mutation runs use a scratch copy, never the real repository)
const PROXY = process.env.RIOPALABRAS_PROXY_DIR ?? '../riopalabras-proxy'
describe.skipIf(!existsSync(`${PROXY}/telegram-auth.js`))('what the proxy does, which the page says', () => {
  const p = (file: string) => read(`${PROXY}/${file}`)

  it('an account: a made-up address from the Telegram id, and in its metadata the id, first name and username, and nothing else of the person', () => {
    const auth = p('telegram-auth.js')
    expect(auth).toContain(`const TELEGRAM_EMAIL_DOMAIN = '${ACCOUNT_EMAIL_EXAMPLE.split('@')[1]}';`)
    expect(auth).toContain('return `tg_${telegramId}@${TELEGRAM_EMAIL_DOMAIN}`;')
    const metadata = auth.match(/const metadata = \{([^}]*)\}/)![1]
    expect([...metadata.matchAll(/^\s*([a-z_]+):/gm)].map((m) => m[1])).toEqual(['telegram_id', 'telegram_first_name', 'telegram_username', 'provider'])
    expect(auth).not.toMatch(/last_name|photo_url|language_code|phone/)
  })

  it('the launch data is checked for its signature and its age, and only the user it names is used', () => {
    const auth = p('telegram-auth.js')
    expect(auth).toMatch(/createHmac\('sha256', 'WebAppData'\)/)
    expect(auth).toMatch(/stale auth_date/)
  })

  it('the log: the Telegram id at sign-in, the account id on a lookup, never the word, and the unreadable reply as the one exception', () => {
    expect(p('server.js')).toContain('issued session for telegram user ${telegramUser.id}')
    const route = p('enrich-route.js')
    expect(route).toContain('`/enrich request from user ${req.userId}`')
    const logLines = route.split('\n').filter((l) => /\blog\.(log|warn|error)\(/.test(l))
    for (const line of logLines) expect(line, line).not.toMatch(/\bwords?\b|\bentry\b|\bbody\b/)
    expect(route).toContain("log.error('[/enrich] Raw Gemini text (not returned to client):', text);")
    // and the page says each of those, the exception included
    expect(pageText(en)).toContain('whose log has your Telegram ID at sign-in and your account ID at each lookup, not the word. Exception: if a Gemini reply cannot be parsed, it is logged in full, and it usually contains the word.')
    expect(pageText(ru)).toContain('если ответ Gemini не удалось разобрать, он записывается целиком, а в нём обычно есть само слово')
  })

  it('Gemini gets the word and its part of speech, no account id, and the lookup is keyed to the account only for the daily count', () => {
    const route = p('enrich-route.js')
    expect(route).toContain('const list = words.map((w) => (w.pos ? `${w.word} (${w.pos})` : w.word)).join(\', \');')
    const request = route.slice(route.indexOf('function buildGeminiRequest'), route.indexOf('function extractJson'))
    expect(request).not.toMatch(/userId|req\./)
    const quota = p('quota.js')
    expect(quota).toContain(".from('enrichment_usage')")
    expect(quota).toContain(".select('words_count')")
  })

  it('a message reaches the author without the sender\'s name or id: the columns the job reads', () => {
    expect(p('feedback-db.js')).toContain("const COLUMNS = 'id, created_at, kind, es_word, message, app_version, ui_language, screen, platform';")
    // what the bot says to the author carries no name or id (the columns the job reads, above); the page says exactly that
    expect(pageText(en)).toContain("the bot's own message carries no name or ID")
    expect(pageText(ru)).toContain('в самом сообщении бота нет вашего имени и ID')
  })

  it('the reminder row: what the page lists, and the proxy writes the rest', () => {
    const sql = p('sql/reminders.sql')
    const columns = sql.slice(sql.indexOf('create table if not exists public.reminders ('), sql.indexOf('alter table public.reminders enable row level security;'))
    expect([...columns.matchAll(/^\s{2}([a-z_]+)\s+(?:uuid|boolean|text|date|integer|timestamptz)/gm)].map((m) => m[1])).toEqual(['user_id', 'enabled', 'timezone', 'last_sent_on', 'consecutive_ignored', 'paused', 'unreachable', 'updated_at'])
  })

  it('every table the proxy reads or writes either holds no user rows (global_usage, job_runs) or is on the verified list, so the sentence about deletion stays true of it', () => {
    const tables = new Set<string>()
    for (const f of readdirSync(PROXY).filter((name) => name.endsWith('.js') && !name.endsWith('.test.js'))) for (const m of p(f).matchAll(/\.from\('([a-z0-9_]+)'\)/g)) tables.add(m[1])
    expect([...tables].filter((t) => t !== 'global_usage' && t !== 'job_runs' && !['enrichment_usage', 'feedback', 'reminders', 'review_log', 'user_daily_metrics', 'user_favorites', 'user_hidden_words', 'user_progress', 'user_settings', 'user_words'].includes(t))).toEqual([])
    expect(tables.has('enrichment_usage') && tables.has('reminders') && tables.has('feedback')).toBe(true) // and the scan is looking at the right files
  })

  it('job_runs, the job\'s record of its own runs, holds no user rows: its definition has no user_id (or any column that could name a person), and what is written to it is counts', () => {
    const sql = p('sql/digest.sql')
    const table = sql.slice(sql.indexOf('create table if not exists public.job_runs ('), sql.indexOf('create index if not exists job_runs_step_ran_at_idx'))
    expect([...table.matchAll(/^\s{2}([a-z_]+)\s+(?:bigint|text|timestamptz|jsonb)/gm)].map((m) => m[1])).toEqual(['id', 'step', 'ran_at', 'summary'])
    expect(table).not.toMatch(/user_id|auth\.users|telegram/i)
    // the reminders step records its run summary (counts and Telegram's own error texts) and, when it stops, why: nothing keyed by a person
    const step = p('reminders-job.js')
    expect(step.match(/record\(\{[^}]*\}\)/g)).toEqual(["record({ status: 'stopped', error: redact(err && err.message ? err.message : err, token).slice(0, 300) })", "record({ status: 'done', ...stats })"])
  })

  it('an IP address is only ever used in memory by the rate limiter: no file but server.js reads it', () => {
    const users = readdirSync(PROXY)
      .filter((f) => f.endsWith('.js') && !f.endsWith('.test.js'))
      .filter((f) => /\breq\.ip\b|x-forwarded-for/i.test(p(f)))
    expect(users).toEqual(['server.js'])
    expect(p('server.js').match(/req\.ip/g)).toHaveLength(2) // the two rate-limit keys
  })
})

// ---------------------------------------------------------------------------------------------------------------------------------------------
// The page is a page of its own.
// ---------------------------------------------------------------------------------------------------------------------------------------------

describe('privacy.html loads for someone who has never opened the Mini App', () => {
  const html = read('privacy.html')

  it('loads nothing from any other site: no script, no stylesheet, no font, no analytics', () => {
    const urls = [...html.matchAll(/(?:src|href)="([^"]+)"/g)].map((m) => m[1])
    expect(urls).toEqual(['/favicon.svg', '/src/privacy-main.tsx'])
    const markup = html.replace(/<!--[\s\S]*?-->/g, '') // the comments explain what is NOT here; they are not the page
    expect(markup).not.toMatch(/https?:\/\//)
    expect(markup).not.toMatch(/telegram|googleapis|gstatic|gtag|analytics/i)
  })

  it('has one inline script, which sets the theme, and one module: the page\'s own entry', () => {
    expect(html.match(/<script\b/g)).toHaveLength(2)
    expect(html).toContain('<script type="module" src="/src/privacy-main.tsx"></script>')
  })

  it('works on a phone: the viewport is set and fitted to the screen', () => {
    expect(html).toContain('<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />')
  })

  it('its first-paint script agrees with resolveScheme for every combination of the remembered choice and the OS (nothing of Telegram\'s in it)', () => {
    const script = /<!-- theme-bootstrap-privacy[^>]*-->\s*<script>([\s\S]*?)<\/script>/.exec(html)![1]
    expect(script).not.toMatch(/Telegram/)
    for (const choice of [null, 'system', 'light', 'dark'] as const) {
      for (const osDark of [false, true]) {
        let attribute: string | null = null
        new Function('localStorage', 'window', 'document', script)({ getItem: () => choice }, { matchMedia: () => ({ matches: osDark }) }, { documentElement: { setAttribute: (_n: string, v: string) => (attribute = v) } })
        expect(attribute, `${choice} os-dark:${osDark}`).toBe(resolveScheme((choice ?? 'system') as ThemeChoice, readThemeEnv(null, () => ({ matches: osDark }))))
      }
    }
  })

  it('its entry sets the theme and the language and draws the page, and does nothing else', () => {
    const main = read('src/privacy-main.tsx')
    expect(main).toContain('applyTheme(document.documentElement, resolveScheme(readStoredChoice() ?? \'system\', readThemeEnv(null)), null)')
    expect(main).toContain('{ remember: false }')
    expect(main).not.toMatch(/ensureSession|getSupabase|getWebApp|window\.Telegram|Telegram\??\.WebApp|\.ready\??\.?\(|\.expand\??\.?\(|BackButton|fetch\(/)
  })
})

describe('the privacy page does not pull the Mini App in', () => {
  /** Every file the entry reaches through its imports (relative ones; packages are named separately). */
  function reach(entry: string): { files: string[]; packages: string[] } {
    const seen = new Map<string, string>()
    const packages = new Set<string>()
    const visit = (file: string) => {
      if (seen.has(file)) return
      const source = read(file)
      seen.set(file, source)
      for (const m of source.matchAll(/(?:^|\n)\s*(?:import|export)\b[^'"\n]*?from\s+'([^']+)'|(?:^|\n)\s*import\s+'([^']+)'/g)) {
        const spec = m[1] ?? m[2]
        if (spec.endsWith('.css')) continue
        if (!spec.startsWith('.')) {
          packages.add(spec)
          continue
        }
        const base = new URL(spec, `file:///${file}`).pathname.slice(1)
        const found = [`${base}.ts`, `${base}.tsx`, base, `${base}/index.ts`].find((c) => existsSync(c) && /\.(ts|tsx)$/.test(c))
        if (!found) throw new Error(`${file}: cannot find ${spec}`)
        visit(found)
      }
    }
    visit(entry)
    return { files: [...seen.keys()].sort(), packages: [...packages].sort() }
  }

  it('reaches only these files: the page, the links, the language, the strings, the look', () => {
    const { files, packages } = reach('src/privacy-main.tsx')
    expect(files).toEqual([
      'src/components/ExternalLink.tsx',
      'src/components/LinkedText.tsx',
      'src/lib/language.ts',
      'src/lib/links.ts',
      'src/lib/plural.ts',
      'src/lib/privacy.ts',
      'src/lib/telegram.ts',
      'src/lib/theme.ts',
      'src/privacy-main.tsx',
      'src/screens/Privacy.tsx',
      'src/strings.ru.ts',
      'src/strings.shared.ts',
      'src/strings.ts',
    ])
    expect(packages).toEqual(['react', 'react-dom/client'])
  })

  it('and none of them signs in, talks to Supabase or the proxy, or fetches anything', () => {
    for (const file of reach('src/privacy-main.tsx').files) {
      expect(read(file), file).not.toMatch(/@supabase|ensureSession|getSupabase|VITE_|\bfetch\(|XMLHttpRequest|WebSocket|EventSource|sendBeacon/)
    }
  })

  it('the Mini App does not reach the privacy page\'s own files either way: the app\'s entry knows nothing of it', () => {
    expect(read('src/main.tsx')).not.toMatch(/privacy/i)
  })
})

describe('/privacy is served as its own page, and unknown paths still reach the app', () => {
  const rewrites = (JSON.parse(read('vercel.json')) as { rewrites: { source: string; destination: string }[] }).rewrites
  /** Vercel's first matching rewrite (the sources here are plain paths and one catch-all). */
  const served = (path: string) => {
    const match = rewrites.find((r) => new RegExp(`^${r.source.replace('(.*)', '.*')}$`).test(path))
    return match?.destination ?? null
  }

  it('/privacy and /privacy/ go to privacy.html, ahead of the catch-all', () => {
    expect(rewrites[0]).toEqual({ source: '/privacy', destination: '/privacy.html' })
    expect(served('/privacy')).toBe('/privacy.html')
    expect(served('/privacy/')).toBe('/privacy.html')
  })

  it('every other path goes to index.html, so opening a deep link by URL loads the app', () => {
    expect(rewrites.at(-1)).toEqual({ source: '/(.*)', destination: '/index.html' })
    for (const path of ['/', '/words', '/settings', '/a/b/c', '/privacy-policy', '/privacyx']) expect(served(path), path).toBe('/index.html')
  })

  it('the build emits privacy.html next to index.html', () => {
    const input = (config as { build?: { rollupOptions?: { input?: Record<string, string> } } }).build?.rollupOptions?.input
    expect(Object.keys(input ?? {}).sort()).toEqual(['main', 'privacy'])
    expect(input!.privacy.endsWith('/privacy.html')).toBe(true)
    expect(input!.main.endsWith('/index.html')).toBe(true)
  })

  it('the dev server and `vite preview` answer /privacy with the page too (they would otherwise answer with the app)', () => {
    const plugin = ((config as { plugins?: unknown[] }).plugins ?? []).flat().find((p) => (p as { name?: string })?.name === 'privacy-page') as {
      configureServer: (s: { middlewares: { use: (fn: (req: { url?: string }, res: unknown, next: () => void) => void) => void } }) => void
      configurePreviewServer: (s: { middlewares: { use: (fn: (req: { url?: string }, res: unknown, next: () => void) => void) => void } }) => void
    }
    expect(plugin).toBeDefined()
    for (const hook of ['configureServer', 'configurePreviewServer'] as const) {
      let middleware!: (req: { url?: string }, res: unknown, next: () => void) => void
      plugin[hook]({ middlewares: { use: (fn) => void (middleware = fn) } })
      const after = (url: string) => {
        const req = { url }
        let nexted = false
        middleware(req, {}, () => (nexted = true))
        expect(nexted, url).toBe(true)
        return req.url
      }
      expect(after('/privacy')).toBe('/privacy.html')
      expect(after('/privacy/')).toBe('/privacy.html')
      expect(after('/privacy?lang=ru')).toBe('/privacy.html?lang=ru')
      expect(after('/privacy/?lang=ru')).toBe('/privacy.html?lang=ru')
      for (const other of ['/', '/privacy.html', '/privacyx', '/x/privacy', '/src/privacy-main.tsx', '/words_enriched.json']) expect(after(other), other).toBe(other)
    }
    expect(PRIVACY_ROUTE.test('/privacy')).toBe(true)
  })
})

describe('the strings', () => {
  it('the page reads the current language when it is drawn', () => {
    expect(strings.privacy.title).toBe('Privacy')
    setLanguage('ru')
    expect(strings.privacy.title).toBe('Конфиденциальность')
  })
})
