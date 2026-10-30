import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { NEWS_EXPIRY_DAYS, NEWS_FILE_CAP, NEWS_SEEN_KEY, WHATS_NEW, currentNews, hasUnreadNews, newestNewsAt, seenNewsPatch, type NewsEntry } from './whatsNew'
import { applySettingsPatch } from './mutations'
import { parseSettings } from './settings'

const entry = (id: string, at: string): NewsEntry => ({ id, at, en: { title: `${id} title`, text: `${id} text` }, ru: { title: `${id} заголовок`, text: `${id} текст` } })
const NOW = new Date(2026, 0, 31, 12, 0) // 31 January 2026, midday: 90 days back is 2 November 2025

describe('the entries file', () => {
  it('has an entry or two, and not more than the cap (the expiry hides old ones; the cap is what tells the owner the pruning was forgotten)', () => {
    expect(WHATS_NEW.length).toBeGreaterThan(0)
    expect(WHATS_NEW.length).toBeLessThanOrEqual(NEWS_FILE_CAP)
  })

  it('each entry has a title and a text in both languages, and a unique id', () => {
    for (const e of WHATS_NEW) {
      expect(e.id, e.id).toMatch(/^[a-z][a-z0-9-]*$/)
      for (const lang of ['en', 'ru'] as const) {
        expect(e[lang].title.trim(), `${e.id} ${lang} title`).not.toBe('')
        expect(e[lang].text.trim(), `${e.id} ${lang} text`).not.toBe('')
      }
    }
    expect(new Set(WHATS_NEW.map((e) => e.id)).size).toBe(WHATS_NEW.length)
  })

  it('the Russian is Russian and the English is not: a language pasted into the wrong slot fails', () => {
    for (const e of WHATS_NEW) {
      expect(e.ru.title + e.ru.text, e.id).toMatch(/[а-яё]/i)
      expect(e.en.title + e.en.text, e.id).not.toMatch(/[а-яё]/i)
    }
  })

  it('is dated "YYYY-MM-DDTHH:mm" (entries compare as text, so the shape is the contract), a real moment, and not in the future', () => {
    const now = new Date()
    for (const e of WHATS_NEW) {
      expect(e.at, e.id).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/)
      const when = new Date(e.at)
      expect(Number.isNaN(when.getTime()), e.id).toBe(false)
      expect(when.getTime(), `${e.id} is dated in the future`).toBeLessThanOrEqual(now.getTime())
    }
  })

  it('is newest first, and no two entries share a moment (the watermark is one of these values, so it has to tell them apart)', () => {
    const ats = WHATS_NEW.map((e) => e.at)
    expect(ats).toEqual([...ats].sort().reverse())
    expect(new Set(ats).size).toBe(ats.length)
  })

  it('is short enough to read on a phone: a title of a line or two, a text of a short paragraph', () => {
    for (const e of WHATS_NEW) {
      for (const lang of ['en', 'ru'] as const) {
        expect(e[lang].title.length, `${e.id} ${lang} title`).toBeLessThanOrEqual(70)
        expect(e[lang].text.length, `${e.id} ${lang} text`).toBeLessThanOrEqual(420)
      }
    }
  })

  it('states no current rule: an entry is dated history ("From 29 October", "now", "until now"), never "the default is" / "always" / "по умолчанию"', () => {
    for (const e of WHATS_NEW) {
      expect(e.en.title + ' ' + e.en.text, e.id).not.toMatch(/\b(the default is|by default|always)\b/i)
      expect(e.ru.title + ' ' + e.ru.text, e.id).not.toMatch(/по умолчанию|(?<![а-яё])всегда(?![а-яё])/i)
    }
  })

  it('uses the app\'s names for things (the same scan strings.names.test.ts makes of the interface), and the formal "вы", never "ты"', () => {
    const en = WHATS_NEW.flatMap((e) => [e.en.title, e.en.text])
    const ru = WHATS_NEW.flatMap((e) => [e.ru.title, e.ru.text])
    for (const text of en) {
      expect(text).not.toMatch(/favou?rite|bookmark|queue|saved word|save word/i)
      expect(text).not.toMatch(/known well|\bgroup\b|done for now/i)
    }
    for (const text of ru) {
      expect(text).not.toMatch(/избранн|закладк|очеред|сохран[её]нные|сохран[её]нных слов|сохранить слово/i)
      expect(text).not.toMatch(/порци|групп|знаю хорошо/i)
      expect(text).not.toMatch(/(^|[^а-яё])(ты|тебе|тебя|тобой|твой|твоя|тво[её]|твои|твоих)(?![а-яё])/i)
      expect(text).not.toMatch(/(^|[^а-яё])[а-яё]{3,}(ешь|ёшь|ишь)(?![а-яё])/i)
    }
  })

  it('the settings key is whats_new_seen, and the screen\'s helpers use it', () => {
    expect(NEWS_SEEN_KEY).toBe('whats_new_seen')
    expect(NEWS_EXPIRY_DAYS).toBe(90)
  })
})

describe('the expiry: an entry is shown for 90 days after its date, judged at display time', () => {
  it('on the 90th day it is still there; on the 91st it is gone', () => {
    const entries = [entry('on-the-line', '2025-11-02T00:00'), entry('a-minute-over', '2025-11-01T23:59')]
    expect(currentNews(NOW, entries).map((e) => e.id)).toEqual(['on-the-line'])
  })

  it('it goes by the date, not the hour: late on the last day an entry from early that morning is shown', () => {
    const entries = [entry('early', '2025-11-02T00:01')]
    expect(currentNews(new Date(2026, 0, 31, 23, 59), entries)).toHaveLength(1)
    expect(currentNews(new Date(2026, 1, 1, 0, 1), entries)).toHaveLength(0)
  })

  it('an entry from today, and one from the future (a clock set back), are shown', () => {
    expect(currentNews(NOW, [entry('today', '2026-01-31T09:00'), entry('later', '2026-02-05T09:00')])).toHaveLength(2)
  })

  it('a quiet stretch shows nothing, and the order of the rest is kept', () => {
    expect(currentNews(new Date(2030, 0, 1), WHATS_NEW)).toEqual([])
    const some = [entry('c', '2026-01-30T10:00'), entry('b', '2025-12-01T10:00'), entry('a', '2025-10-01T10:00')]
    expect(currentNews(NOW, some).map((e) => e.id)).toEqual(['c', 'b'])
  })

  it('does not change the file: the entries are still there to be pruned by hand', () => {
    const before = WHATS_NEW.length
    currentNews(new Date(2030, 0, 1), WHATS_NEW)
    expect(WHATS_NEW).toHaveLength(before)
  })
})

describe('what is unread', () => {
  const entries = [entry('new', '2026-01-30T10:00'), entry('old', '2026-01-10T08:30')]
  const seen = (whatsNewSeen: string | null) => ({ whatsNewSeen })

  it('newestNewsAt is the largest "at", whatever the order, and null with none', () => {
    expect(newestNewsAt(entries)).toBe('2026-01-30T10:00')
    expect(newestNewsAt([...entries].reverse())).toBe('2026-01-30T10:00')
    expect(newestNewsAt([])).toBeNull()
  })

  it('a person who has seen nothing has everything to read', () => {
    expect(hasUnreadNews(seen(null), NOW, entries)).toBe(true)
  })

  it('seen an older entry: the newer one is unread', () => {
    expect(hasUnreadNews(seen('2026-01-10T08:30'), NOW, entries)).toBe(true)
    expect(hasUnreadNews(seen('2026-01-30T09:59'), NOW, entries)).toBe(true)
  })

  it('seen the newest one, or something later: nothing is unread', () => {
    expect(hasUnreadNews(seen('2026-01-30T10:00'), NOW, entries)).toBe(false)
    expect(hasUnreadNews(seen('2026-02-15T00:00'), NOW, entries)).toBe(false)
  })

  it('no entry is current: nothing is unread, whatever was seen', () => {
    expect(hasUnreadNews(seen(null), NOW, [])).toBe(false)
    expect(hasUnreadNews(seen(null), new Date(2027, 0, 1), entries)).toBe(false)
  })

  it('an entry that has expired does not make a dot, even for a person who never opened it', () => {
    expect(hasUnreadNews(seen(null), NOW, [entry('stale', '2025-06-01T10:00')])).toBe(false)
    expect(hasUnreadNews(seen(null), NOW, [entry('stale', '2025-06-01T10:00'), entry('fresh', '2026-01-20T10:00')])).toBe(true)
  })

  it('opening it writes the newest current entry\'s moment, once', () => {
    expect(seenNewsPatch(seen(null), NOW, entries)).toEqual({ whats_new_seen: '2026-01-30T10:00' })
    expect(seenNewsPatch(seen('2026-01-10T08:30'), NOW, entries)).toEqual({ whats_new_seen: '2026-01-30T10:00' })
    expect(seenNewsPatch(seen('2026-01-30T10:00'), NOW, entries)).toBeNull()
    expect(seenNewsPatch(seen(null), NOW, [])).toBeNull()
  })

  it('the value written is an entry\'s moment and not when it was opened: the watermark learns nothing about the person\'s day', () => {
    const patch = seenNewsPatch(seen(null), new Date(2026, 0, 31, 4, 44), entries)!
    expect(patch.whats_new_seen).toBe('2026-01-30T10:00')
  })

  it('applied to the settings it clears the dot, and the other keys survive', () => {
    const before = parseSettings({ streak_count: 3 })
    expect(hasUnreadNews(before, NOW, entries)).toBe(true)
    const after = applySettingsPatch(before, seenNewsPatch(before, NOW, entries)!)
    expect(hasUnreadNews(after, NOW, entries)).toBe(false)
    expect(after.raw.streak_count).toBe(3)
  })

  it('an entry added later brings the dot back', () => {
    const after = parseSettings({ whats_new_seen: '2026-01-30T10:00' })
    expect(hasUnreadNews(after, NOW, entries)).toBe(false)
    expect(hasUnreadNews(after, NOW, [entry('newer', '2026-01-31T08:00'), ...entries])).toBe(true)
  })
})

describe('the settings field', () => {
  it('is the stored text, or null when the key is missing or is not text', () => {
    expect(parseSettings({ whats_new_seen: '2026-01-30T10:00' }).whatsNewSeen).toBe('2026-01-30T10:00')
    expect(parseSettings({}).whatsNewSeen).toBeNull()
    expect(parseSettings(null).whatsNewSeen).toBeNull()
    for (const value of [3, true, {}, []]) expect(parseSettings({ whats_new_seen: value }).whatsNewSeen, JSON.stringify(value)).toBeNull()
  })
})

describe('the editorial rule is written down where it survives', () => {
  it('the README\'s Conventions section holds the question, the "no entry" answer, the dated-history rule and the 90 days', () => {
    const readme = readFileSync('README.md', 'utf8')
    const conventions = readme.slice(readme.indexOf('## Conventions'), readme.indexOf('## Tests'))
    expect(conventions).toContain('does this change what a person sees or how a rule works?')
    expect(conventions).toContain('"no entry"')
    expect(conventions).toContain('never generated from commits')
    expect(conventions).toContain('dated history')
    expect(conventions).toContain(`${NEWS_EXPIRY_DAYS} days`)
    expect(conventions).toContain('src/data/whatsNew.ts')
  })
})
