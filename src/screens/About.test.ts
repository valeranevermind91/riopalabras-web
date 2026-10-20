import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it } from 'vitest'
import { parseSettings } from '../data/settings'
import { createWriteQueue } from '../data/writeQueue'
import { VERSION_LABEL } from '../lib/buildInfo'
import { setLanguage } from '../lib/language'
import { backTarget } from '../lib/nav'
import { en } from '../strings'
import { ru } from '../strings.ru'
import { AboutScreen } from './About'

afterEach(() => setLanguage('en'))

const noop = () => {}
const queue = createWriteQueue({ sendProgress: async () => {}, sendSettings: async () => {} })
const ORIGIN = 'https://app.test'

const render = (props: Partial<Parameters<typeof AboutScreen>[0]> = {}, raw: Record<string, unknown> = {}) =>
  renderToStaticMarkup(createElement(AboutScreen, { data: { settings: parseSettings(raw), getSettings: () => parseSettings(raw), applySettings: noop } as never, queue, origin: ORIGIN, ...props }))

/** The text of the page with the tags taken out (what a person reads): a block ends a word, a link or a span in the middle of a sentence does not. */
const text = (html: string) =>
  html
    .replace(/<[^>]*>/g, (tag) => (/^<\/?(h1|h2|p|div|section|main|header|button)\b/.test(tag) ? ' ' : ''))
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim()
const headings = (html: string) => [...html.matchAll(/<h2 id="about-([a-z]+)" class="settings-label">([^<]+)<\/h2>/g)].map((m) => `${m[1]}:${m[2]}`)
const block = (html: string, id: string) => html.match(new RegExp(`<section[^>]*aria-labelledby="about-${id}">.*?</section>`))![0]
const anchors = (html: string) => [...html.matchAll(/<a [^>]*href="([^"]+)"[^>]*>(.*?)<\/a>/g)].map((m) => ({ href: m[1], label: text(m[2]) }))

describe('the About screen', () => {
  it('has a header with the title, and five blocks in this order: what this is, author, sources, your data, support', () => {
    const html = render({ onBack: noop })
    expect(html).toContain('<h1>About</h1>')
    expect(html).toContain('class="back-link"')
    expect(headings(html)).toEqual(['what:What this is', 'author:Author', 'sources:Sources', 'data:Your data', 'support:Support'])
  })

  it('in Russian, the same five, with Russian headings', () => {
    setLanguage('ru')
    const html = render()
    expect(html).toContain('<h1>О приложении</h1>')
    expect(headings(html)).toEqual(['what:Что это', 'author:Автор', 'sources:Источники', 'data:Ваши данные', 'support:Поддержка'])
  })

  describe('block 1, what this is', () => {
    it('English: the words asked for, to the letter', () => {
      expect(text(block(render(), 'what'))).toContain("A language for living in Uruguay and Argentina. I didn't have the vocabulary myself — so I made this app.")
    })

    it('Russian: the author\'s sentence, to the letter (it is the one sentence the gendered-first-person rule lets through: strings.names.test.ts)', () => {
      setLanguage('ru')
      expect(text(block(render(), 'what'))).toContain('Язык для жизни в Уругвае и Аргентине. Мне самому не хватало лексики — поэтому я сделал это приложение.')
    })
  })

  describe('block 2, the author', () => {
    it('names Valeriy Kriukov, and Telegram @valeranevermind is a link to the profile', () => {
      const html = block(render(), 'author')
      expect(text(html)).toContain('Valeriy Kriukov')
      expect(html).toContain('<a class="setting-row setting-link" href="https://t.me/valeranevermind" target="_blank" rel="noopener noreferrer">')
      expect(text(html)).toContain('Telegram@valeranevermind') // label and handle are two spans of one row
    })

    it('in Russian the name is written in Russian and the handle is the same', () => {
      setLanguage('ru')
      const html = block(render(), 'author')
      expect(text(html)).toContain('Валерий Крюков')
      expect(text(html)).toContain('Telegram@valeranevermind')
    })
  })

  describe('block 3, the sources', () => {
    const dictionarySize = (JSON.parse(readFileSync('public/words_enriched.json', 'utf8')) as unknown[]).length

    it('links to the two repositories (the frequencies first, then the list) and to the licence deed, each with the name of what it is', () => {
      const html = block(render(), 'sources')
      expect(anchors(html)).toEqual([
        { href: 'https://github.com/hermitdave/FrequencyWords', label: 'hermitdave/FrequencyWords' },
        { href: 'https://github.com/doozan/spanish_data', label: 'doozan/spanish_data' },
        { href: 'https://creativecommons.org/licenses/by-sa/4.0/', label: 'CC BY-SA 4.0' },
      ])
    })

    it('says the licence on a line of its own, after the paragraph', () => {
      const html = block(render(), 'sources')
      const paragraphs = [...html.matchAll(/<p class="([^"]+)">(.*?)<\/p>/g)].map((m) => ({ cls: m[1], text: text(m[2]) }))
      expect(paragraphs).toHaveLength(2)
      expect(paragraphs[1]).toEqual({ cls: 'about-text about-licence', text: 'The base word list is distributed under CC BY-SA 4.0.' })
    })

    it('says only what was verified: subtitle-ranked frequencies from FrequencyWords, the list from doozan, FreeLing as that repository credits it; AI-made translations; regional notes partly checked against DAMER and a questionnaire in Uruguay', () => {
      const body = text(block(render(), 'sources'))
      for (const phrase of [
        'ranked by how often they appear in film and TV subtitles',
        'The frequencies come from hermitdave/FrequencyWords (CC BY-SA 4.0)',
        'the list was taken from doozan/spanish_data (CC BY 4.0), which credits FreeLing for part-of-speech tagging',
        'were made for this app with AI (Google Gemini)',
        'regional notes were partly checked',
        'DAMER dictionary of the Association of Spanish Language Academies',
        'questionnaire answered by native speakers in Uruguay',
      ])
        expect(body, phrase).toContain(phrase)
      // not claimed: where the lemmas came from (the source README does not say), or that the translations or the examples were checked against anything
      expect(body).not.toMatch(/wiktionary|lemma/i)
      expect(body).not.toMatch(/translations[^.]*(checked|reviewed|verified)/i)
    })

    it('the size it gives is the dictionary\'s, to the nearest fifty (it fails when the dictionary moves away from it)', () => {
      const nearest = Math.round(dictionarySize / 50) * 50
      expect(nearest).toBe(4750)
      expect(text(block(render(), 'sources'))).toContain(`about ${nearest.toLocaleString('en-US')} Spanish words`)
      setLanguage('ru')
      expect(text(block(render(), 'sources'))).toContain(`около ${nearest} испанских слов`)
    })

    it('in Russian: the same links, the licence line, no braces left in the text', () => {
      setLanguage('ru')
      const html = block(render(), 'sources')
      expect(anchors(html).map((a) => a.href)).toEqual(['https://github.com/hermitdave/FrequencyWords', 'https://github.com/doozan/spanish_data', 'https://creativecommons.org/licenses/by-sa/4.0/'])
      expect(text(html)).toContain('Базовый список распространяется по лицензии CC BY-SA 4.0.')
      expect(text(html)).toContain('с помощью ИИ (Google Gemini)')
      expect(text(html)).toContain('в этом репозитории за разметку частей речи указан FreeLing')
      expect(text(html)).not.toMatch(/Викисловар|Wiktionary|лемм/i)
      expect(html).not.toMatch(/[{}]/)
    })

    it('carries the licences of the two sources as their repositories state them: FrequencyWords\' word lists CC BY-SA 4.0 (its README), doozan\'s repository CC BY 4.0 (its LICENSE)', () => {
      const body = text(block(render(), 'sources'))
      expect(body).toContain('hermitdave/FrequencyWords (CC BY-SA 4.0)')
      expect(body).toContain('doozan/spanish_data (CC BY 4.0)')
      expect(body).not.toMatch(/\bMIT\b/) // MIT is FrequencyWords' CODE licence, which is not what is used
    })
  })

  describe('block 4, your data', () => {
    it('is one or two sentences, then a link to the privacy page on the origin the app is served from, in the language the app is in', () => {
      const html = block(render(), 'data')
      expect(text(html).match(/[.!?](\s|$)/g)!.length).toBeLessThanOrEqual(2)
      expect(anchors(html)).toEqual([{ href: `${ORIGIN}/privacy?lang=en`, label: 'Privacy policy›' }])
      setLanguage('ru')
      expect(anchors(block(render(), 'data'))).toEqual([{ href: `${ORIGIN}/privacy?lang=ru`, label: 'Политика конфиденциальности›' }])
    })

    it('offers the existing "Write to us" for deletion requests, and builds no delete button', () => {
      const html = block(render({ onOpenFeedback: noop }), 'data')
      expect(html).toContain('<span class="setting-label">Write to us</span><span class="setting-hint">To have your data deleted</span>')
      expect(html.match(/<button/g)).toHaveLength(1) // the one entry point, nothing that deletes
      expect(html).not.toMatch(/delete (my|your) (account|data)<|class="[^"]*danger/i)
    })

    it('leaves the row out when no message can be sent (signed out), and says when one has just gone', () => {
      expect(block(render(), 'data')).not.toContain('Write to us')
      expect(block(render({ onOpenFeedback: noop, feedbackSent: true }), 'data')).toContain('role="status"')
      expect(block(render({ onOpenFeedback: noop }), 'data')).not.toContain('role="status"')
    })
  })

  describe('block 5, support', () => {
    it('English: the sentence, with "buy me a coffee" as the link', () => {
      const html = block(render(), 'support')
      expect(text(html)).toContain("It's free; if it helped, you can buy me a coffee.")
      expect(anchors(html)).toEqual([{ href: 'https://buymeacoffee.com/valeranevermind', label: 'buy me a coffee' }])
    })

    it('Russian: the sentence asked for, with «угостить меня кофе» as the link', () => {
      setLanguage('ru')
      const html = block(render(), 'support')
      expect(text(html)).toContain('Оно бесплатное; если пригодилось, можно угостить меня кофе.')
      expect(anchors(html)).toEqual([{ href: 'https://buymeacoffee.com/valeranevermind', label: 'угостить меня кофе' }])
    })
  })

  describe('links', () => {
    it('there are exactly six, in this order, and each opens outside the page: a new tab with no opener and no referrer (inside Telegram, its own opener, on the tap)', () => {
      const html = render({ onOpenFeedback: noop })
      expect(anchors(html).map((a) => a.href)).toEqual([
        'https://t.me/valeranevermind',
        'https://github.com/hermitdave/FrequencyWords',
        'https://github.com/doozan/spanish_data',
        'https://creativecommons.org/licenses/by-sa/4.0/',
        `${ORIGIN}/privacy?lang=en`,
        'https://buymeacoffee.com/valeranevermind',
      ])
      const tags = html.match(/<a [^>]*>/g)!
      expect(tags).toHaveLength(6)
      for (const tag of tags) expect(tag, tag).toContain('target="_blank" rel="noopener noreferrer"')
    })
  })

  describe('the version', () => {
    it('is shown as "<hash> · <date>", on the row that takes the seven taps', () => {
      const html = render()
      expect(html).toContain('<div class="setting-row setting-version"><span class="setting-label">Version</span><span class="setting-value">' + VERSION_LABEL + '</span></div>')
      setLanguage('ru')
      expect(render()).toContain('<span class="setting-label">Версия</span>')
    })

    it('gives no sign that it can be tapped: a plain row, not a button, link or control, and nothing on the screen speaks of taps or unlocking', () => {
      const html = render()
      const row = html.match(/<div class="setting-row setting-version">.*?<\/div>/)![0]
      expect(row).not.toMatch(/role=|tabindex|aria-|title=|<button|<a /)
      expect(html).not.toMatch(/\btap|unlock|developer/i)
    })

    it('is where the unlock lives: the screen is the only one with the tap counter, and Settings no longer has a version row', () => {
      const about = readFileSync('src/screens/About.tsx', 'utf8')
      const settings = readFileSync('src/screens/Settings.tsx', 'utf8')
      expect(about).toContain('createTapCounter({ taps: DEBUG_UNLOCK_TAPS, gapMs: DEBUG_UNLOCK_GAP_MS })')
      expect(about).toContain('saveSetting(debugUnlockedPatch(true), deps)')
      expect(settings).not.toMatch(/createTapCounter|setting-version|VERSION_LABEL/)
    })

    it('an unlocked account taps for nothing: the row still draws, and nothing else changes', () => {
      expect(render({}, { debug_unlocked: true })).toBe(render({}, {}))
    })
  })

  it('nothing in it is a literal of its own: the words come from the strings, the addresses from src/lib/links.ts', () => {
    const source = readFileSync('src/screens/About.tsx', 'utf8')
    expect(source).not.toMatch(/https?:\/\//)
    const leaves = (node: unknown): string[] => (typeof node === 'string' ? [node] : node && typeof node === 'object' ? Object.values(node).flatMap(leaves) : [])
    for (const leaf of [...leaves(en.about), ...leaves(ru.about)].filter((l) => l.includes(' ') && l.length > 6)) expect(source, leaf).not.toContain(leaf) // phrases and sentences; a single word may be a name in the code
  })
})

describe('where Back goes from About', () => {
  it('About goes back to Settings, its only way in', () => {
    expect(backTarget('about', null)).toBe('settings')
  })

  it('a note written from About goes back to About; one written from Settings, or about a word, goes where it always did', () => {
    expect(backTarget('feedback', null, false, 'about')).toBe('about')
    expect(backTarget('feedback', null, false, 'settings')).toBe('settings')
    expect(backTarget('feedback', null, false)).toBe('settings')
    expect(backTarget('feedback', null, true, 'about')).toBe('word') // a word's report returns to the word whatever was last used
  })

  it('App opens About from Settings, starts the note from About with About as its origin, and shows the "sent" line there', () => {
    const app = readFileSync('src/App.tsx', 'utf8')
    expect(app).toMatch(/onOpenAbout=\{\(\) => setScreen\('about'\)\}/)
    expect(app).toMatch(/if \(screen === 'about' && readyData && queue\)/)
    expect(app).toMatch(/setFeedbackFrom\('about'\)/)
    expect(app).toMatch(/setFeedbackFrom\('settings'\)/)
    expect(app).toMatch(/feedbackSent=\{feedbackSent\?\.screen === 'about'\}/)
    expect(app).toMatch(/backTargetFor\(screen, screen === 'word' \? \(open\?\.from \?\? null\) : null, feedback\.esWord !== null, feedbackFrom\)/)
  })
})
