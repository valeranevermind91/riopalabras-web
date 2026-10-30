import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { parseSettings } from '../data/settings'
import { createWriteQueue } from '../data/writeQueue'
import { WHATS_NEW } from '../data/whatsNew'
import { setLanguage } from '../lib/language'
import { WhatsNewScreen } from './WhatsNew'

const queue = createWriteQueue({ sendProgress: async () => {}, sendSettings: async () => {} })
const NOW = new Date(2026, 0, 31, 12, 0)
const entry = (id: string, at: string, title = `${id} title`, ru = `${id} заголовок`) => ({ id, at, en: { title, text: `${id} text` }, ru: { title: ru, text: `${id} текст` } })
const NEWS = [entry('newest', '2026-01-30T10:00'), entry('middle', '2026-01-20T09:15'), entry('oldest', '2026-01-02T18:40')]

const render = (raw: Record<string, unknown> = {}, props: Record<string, unknown> = {}) =>
  renderToStaticMarkup(createElement(WhatsNewScreen, { data: { settings: parseSettings(raw), applySettings: () => {} } as never, queue, news: NEWS, now: NOW, ...props }))
const ids = (html: string) => [...html.matchAll(/id="news-([a-z-]+)"/g)].map((m) => m[1])
const pills = (html: string) => (html.match(/class="news-pill"/g) ?? []).length

describe("the What's new screen", () => {
  it('has the header with a back button and the title, and lists the entries newest first', () => {
    const html = render({}, { onBack: () => {} })
    expect(html).toContain('<h1>What&#x27;s new</h1>')
    expect(html).toContain('class="back-link"')
    expect(ids(html)).toEqual(['newest', 'middle', 'oldest'])
  })

  it('each entry is a dated section: the date is a <time> carrying the entry\'s own moment (React writes the attribute as dateTime), the title a heading, the text a paragraph', () => {
    const html = render()
    expect(html).toContain('<time dateTime="2026-01-30T10:00">')
    expect(html).toContain('<time dateTime="2026-01-02T18:40">')
    expect(html).toMatch(/<h3 id="news-newest" class="setting-label news-title">newest title<\/h3><p class="news-text">newest text<\/p>/)
    expect(html).toMatch(/aria-labelledby="news-newest"/)
  })

  it('the date reads as a date: day, month and year', () => {
    expect(render()).toMatch(/<time dateTime="2026-01-30T10:00">January 30, 2026<\/time>/)
  })

  it('marks the entries that were unread when it opened with "New", and only those', () => {
    expect(pills(render())).toBe(3) // nothing seen: all three
    expect(pills(render({ whats_new_seen: '2026-01-20T09:15' }))).toBe(1) // only the one after the watermark
    expect(pills(render({ whats_new_seen: '2026-01-30T10:00' }))).toBe(0)
    expect(render({ whats_new_seen: '2026-01-20T09:15' })).toMatch(/<time dateTime="2026-01-30T10:00">[^<]*<\/time><span class="news-pill">New<\/span>/)
  })

  it('shows only the current entries: one past the 90 days is not listed', () => {
    const html = render({}, { news: [...NEWS, entry('stale', '2025-09-01T10:00')] })
    expect(ids(html)).toEqual(['newest', 'middle', 'oldest'])
  })

  it('with no current entry it says so, plainly', () => {
    const html = render({}, { news: [] })
    expect(html).toContain('Nothing new yet.')
    expect(ids(html)).toEqual([])
  })

  it('in Russian: the Russian title and text, «Новое», and the title «Что нового»', () => {
    setLanguage('ru')
    try {
      const html = render({}, { news: [entry('newest', '2026-01-30T10:00', 'en', 'Русский заголовок')] })
      expect(html).toContain('<h1>Что нового</h1>')
      expect(html).toContain('Русский заголовок')
      expect(html).toContain('newest текст')
      expect(html).not.toContain('newest text')
      expect(html).toContain('<span class="news-pill">Новое</span>')
      expect(html).toMatch(/<time dateTime="2026-01-30T10:00">30 января 2026 г.<\/time>/)
      expect(render({}, { news: [] })).toContain('Пока ничего нового.')
    } finally {
      setLanguage('en')
    }
  })

  it('the real entries render, each in both languages, with nothing left over from a template', () => {
    for (const lang of ['en', 'ru'] as const) {
      setLanguage(lang)
      try {
        const html = render({}, { news: WHATS_NEW, now: new Date(WHATS_NEW[0].at) })
        expect(ids(html)).toEqual(WHATS_NEW.map((e) => e.id))
        for (const e of WHATS_NEW) expect(html).toContain(e[lang].title.replace(/"/g, '&quot;').replace(/'/g, '&#x27;'))
        expect(html).not.toMatch(/undefined|\[object|\{\{/)
      } finally {
        setLanguage('en')
      }
    }
  })

  it('opening it marks the entries seen through the settings writer, once: the effect is guarded, and writes the watermark the module computes', () => {
    const code = readFileSync('src/screens/WhatsNew.tsx', 'utf8')
    expect(code).toMatch(/seenNewsPatch\(data\.settings, when, news\)/)
    expect(code).toMatch(/saveSetting\(patch, \{ applySettings: data\.applySettings, queue \}\)/)
    expect(code).toMatch(/if \(marked\.current\) return/)
    expect(code).toMatch(/const \[seenBefore\] = useState\(data\.settings\.whatsNewSeen\)/) // the labels come from the watermark as it was on opening, not as it is after the write
  })
})
