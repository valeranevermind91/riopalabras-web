import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it } from 'vitest'
import { makeWord } from '../testing/makeWord'
import { parseSettings } from '../data/settings'
import { COUNT_FROM, MAX_MESSAGE, type FeedbackContext, type SendResult } from '../data/feedback'
import { createWriteQueue } from '../data/writeQueue'
import { backTarget } from '../lib/nav'
import { setLanguage } from '../lib/language'
import { en, type Strings } from '../strings'
import { ru } from '../strings.ru'
import { FeedbackScreen } from './Feedback'
import { SettingsScreen } from './Settings'
import { WordDetail } from './WordDetail'

const noop = () => {}
const send = async (): Promise<SendResult> => ({ ok: true })
const context: FeedbackContext = { appVersion: '0ad8e01', uiLanguage: 'en', screen: 'word', platform: 'android' }
const form = (props: Partial<Parameters<typeof FeedbackScreen>[0]> = {}) =>
  renderToStaticMarkup(createElement(FeedbackScreen, { kind: 'general', esWord: null, from: 'settings', send, onSent: noop, onClose: noop, context, ...props }))
const line = (html: string) => html.match(/<p id="feedback-sends" class="form-hint">([^<]*)<\/p>/)![1]

afterEach(() => setLanguage('en'))

describe('the message form', () => {
  it('a general message: a field, the line on what goes along, Send and Cancel; no word', () => {
    const html = form({ context: { ...context, screen: 'settings' } })
    expect(html).toContain('<h1>Write to us</h1>')
    expect(html).toContain('Your message')
    expect(html).toContain('maxLength="2000"')
    expect(html).not.toContain('class="form-word"')
    expect(line(html)).toBe('Sent with your message: your account, app version 0ad8e01, interface language English, screen Settings, Telegram platform android.')
    expect(html).toMatch(/<button type="submit" class="btn btn-primary"[^>]*>Send<\/button>/)
    expect(html).toContain('>Cancel</button>')
  })

  it('a word report shows the word on the form, and says it goes with the text', () => {
    const html = form({ kind: 'word', esWord: 'chévere', from: 'word' })
    expect(html).toContain('<h1>Report a problem</h1>')
    expect(html).toContain('<p class="form-word"><span class="form-label">The word</span><strong>chévere</strong></p>')
    expect(html).toContain('What is wrong with this word?')
    expect(line(html)).toBe('Sent with your message: the word “chévere”, your account, app version 0ad8e01, interface language English, screen Word, Telegram platform android.')
  })

  it('a general form given a word still shows and sends none', () => {
    const html = form({ kind: 'general', esWord: 'chévere' })
    expect(html).not.toContain('chévere')
  })

  it('in Russian: the same line in the app\'s own voice, with the Russian names of the language and the screen', () => {
    setLanguage('ru')
    const html = form({ kind: 'word', esWord: 'chévere', from: 'word', context: { ...context, uiLanguage: 'ru' } })
    expect(html).toContain('<h1>Сообщить об ошибке</h1>')
    expect(line(html)).toBe('Вместе с текстом отправится: слово «chévere», ваш аккаунт, версия приложения 0ad8e01, язык интерфейса — русский, экран — «Слово», платформа Telegram — android.')
    expect(html).toContain('Что не так с этим словом?')
    expect(html).toContain('>Отправить</button>')
    expect(form({ context: { ...context, uiLanguage: 'ru', screen: 'settings' } })).toContain('<h1>Написать нам</h1>')
  })

  it('shows no count while there is room: it appears near the limit', () => {
    expect(form()).not.toContain('form-count')
    expect(COUNT_FROM).toBeLessThan(MAX_MESSAGE)
  })

  it('the line names no device: no user agent, and nothing but the five things it lists', () => {
    const html = form({ kind: 'word', esWord: 'chévere', from: 'word' })
    expect(html).not.toMatch(/Mozilla|AppleWebKit|Chrome\/|userAgent/i)
    expect(line(html).match(/,/g)).toHaveLength(5)
  })
})

const sample = { word: 'casa', version: 'v1', language: 'l', screen: 's', platform: 'p' }
/** Every text of a language's feedback group, the two functions called with sample values. */
const textsOf = (group: Strings['feedback']): string[] =>
  Object.values({ ...group, count: group.count(3, 2000), sentWith: group.sentWith(sample) }).flatMap((v) => (typeof v === 'string' ? [v] : typeof v === 'object' ? Object.values(v) : []))

describe('the words', () => {
  it('never "feedback" as a noun in Russian (no «фидбек», «отзыв», «обратная связь»), and no "feedback" in the English either: it says what it is for', () => {
    for (const text of textsOf(ru.feedback)) expect(text).not.toMatch(/фидб|отзыв|обратн\w* связ/i)
    for (const text of textsOf(en.feedback)) expect(text).not.toMatch(/feedback/i)
    expect([en.feedback.open, ru.feedback.open]).toEqual(['Write to us', 'Написать нам'])
    expect([en.feedback.reportWord, ru.feedback.reportWord]).toEqual(['Report a problem with this word', 'Сообщить об ошибке в слове'])
  })

  it('a Russian line has no English left but the names of Telegram and the app version', () => {
    for (const text of textsOf(ru.feedback)) expect(text.replace(/Telegram|casa/g, '').match(/\p{Script=Latin}{3,}/gu) ?? []).toEqual([])
  })
})

describe('the two ways in', () => {
  const queue = createWriteQueue({ sendProgress: async () => {}, sendSettings: async () => {} })
  const settings = (props: Partial<Parameters<typeof SettingsScreen>[0]> = {}) =>
    renderToStaticMarkup(
      createElement(SettingsScreen, { data: { settings: parseSettings({}), getSettings: () => parseSettings({}), applySettings: noop } as never, queue, theme: { choice: 'system', set: noop }, onOpenDebug: noop, botUsername: 'riopalabras_bot', ...props }),
    )
  const detail = (word = makeWord('casa', { rank: 1 }), props: Partial<Parameters<typeof WordDetail>[0]> = {}) =>
    renderToStaticMarkup(createElement(WordDetail, { word, data: { words: [word], settings: parseSettings({}), applyFavorite: noop, applyHidden: noop } as never, queue, ...props }))

  it('Settings: a row in About that opens the form, with what it is for; gone when signed out', () => {
    const html = settings({ onOpenFeedback: noop })
    const about = html.match(/aria-labelledby="settings-about">.*?<\/section>/s)![0]
    expect(about).toContain('<span class="setting-label">Write to us</span>')
    expect(about).toContain('A bug, an idea, or anything else you would like to say')
    expect(settings()).not.toContain('Write to us')
  })

  it('Settings: a line under the row says it went, only just after sending', () => {
    expect(settings({ onOpenFeedback: noop, feedbackSent: true })).toContain('<p class="setting-note" role="status">Sent. Thank you.</p>')
    expect(settings({ onOpenFeedback: noop })).not.toContain('Sent. Thank you.')
  })

  it('a word: "Report a problem with this word" under the actions, for any word that is not the user\'s own; gone when signed out', () => {
    expect(detail(undefined, { onReport: noop })).toContain('>Report a problem with this word</button>')
    expect(detail()).not.toContain('Report a problem')
    const learned = makeWord('casa', { rank: 1, repetitions: 4, interval: 30, nextReview: new Date(Date.now() + 30 * 86_400_000) })
    expect(detail(learned, { onReport: noop })).toContain('Report a problem with this word') // a learned word can be wrong too
    expect(detail(makeWord('mia', { rank: null, isCustom: true }), { onReport: noop })).not.toContain('Report a problem') // a word of one's own is edited
  })

  it('a word: the sent line is there just after sending', () => {
    expect(detail(undefined, { onReport: noop, reportSent: true })).toContain('<p class="detail-note" role="status">Sent. Thank you.</p>')
    expect(detail(undefined, { onReport: noop })).not.toContain('Sent. Thank you.')
  })

  it('Back from the form goes where it was opened from: the word, or Settings', () => {
    expect(backTarget('feedback', null, true)).toBe('word')
    expect(backTarget('feedback', null, false)).toBe('settings')
    expect(backTarget('feedback', 'words', true)).toBe('word')
  })

  const app = readFileSync('src/App.tsx', 'utf8')

  it('App sends only for a signed-in user, and the entry points exist only then', () => {
    expect(app).toMatch(/const sendReport = useMemo\(\(\) => \(client && userId \? /)
    expect(app).toMatch(/onOpenFeedback=\{\s*sendReport\s*\?/)
    expect(app).toMatch(/onReport=\{\s*sendReport\s*\?/)
    expect(app).toMatch(/if \(screen === 'feedback' && sendReport\)/)
  })

  it('App opens a word report with the word, a general one without, and a sent one closes to where it was written', () => {
    expect(app).toMatch(/setFeedback\(\{ esWord: openedWord\.esWord \}\)/)
    expect(app).toMatch(/setFeedback\(\{ esWord: null \}\)/)
    expect(app).toMatch(/onSent=\{\(\) => \{\s*setFeedbackSent\([^\n]*\)\s*go\(backTarget\)\s*\}\}/)
    expect(app).toMatch(/onClose=\{\(\) => go\(backTarget\)\}/)
  })

  it('App forgets that a message was sent as soon as the person goes anywhere but Settings, the word or the form', () => {
    expect(app).toMatch(/if \(to !== 'settings' && to !== 'word' && to !== 'feedback'\) setFeedbackSent\(null\)/)
  })
})
