import { readFileSync, readdirSync, statSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ClozeQuestion } from '../components/ClozeQuestion'
import { RelationBlock } from '../components/RelationBlock'
import { ReviewCard } from '../components/ReviewCard'
import { WordCard } from '../components/WordCard'
import { WordRow } from '../components/WordRow'
import { BOTH, EN_ONLY, RU_ONLY } from '../testing/translationFlags'
import { makeWord } from '../testing/makeWord'
import { clozeFeedback } from './clozeFeedback'
import { parseDictionary } from './dictionary'
import { buildMatchingGroup, clozePool, clozeCueLines, cueLang, firstMatchGloss, matchItem, matchingEligibleCount, matchingPool } from './practice'
import { relationFor } from './relation'
import { parseRioOverlay } from './rio'
import { parseSettings } from './settings'
import { enabledLanguages, firstTranslation, pickLocalizedAll, translationLines } from './translations'
import type { Word } from './types'
import { wordOfTheDay } from './wordOfDay'
import type { ListRow } from './wordList'

const OFF = { showRuTranslation: false, showEnTranslation: false }

describe('the one translation rule', () => {
  const both = { ru: 'дом', en: 'house' }

  it('the enabled languages are the flags, RU then EN', () => {
    expect(enabledLanguages(RU_ONLY)).toEqual(['ru'])
    expect(enabledLanguages(EN_ONLY)).toEqual(['en'])
    expect(enabledLanguages(BOTH)).toEqual(['ru', 'en'])
    expect(enabledLanguages(OFF)).toEqual([])
  })

  it('a surface with room for several lines gets one per enabled language that has text, RU first', () => {
    expect(translationLines(both, RU_ONLY).map((l) => [l.label, l.text])).toEqual([['RU', 'дом']])
    expect(translationLines(both, EN_ONLY).map((l) => [l.label, l.text])).toEqual([['EN', 'house']])
    expect(translationLines(both, BOTH).map((l) => [l.label, l.text])).toEqual([['RU', 'дом'], ['EN', 'house']])
  })

  it('a surface with room for one line uses the first enabled language that has text', () => {
    expect(firstTranslation(both, RU_ONLY)?.text).toBe('дом')
    expect(firstTranslation(both, EN_ONLY)?.text).toBe('house')
    expect(firstTranslation(both, BOTH)?.text).toBe('дом') // RU before EN
    expect(firstTranslation({ ru: '', en: 'house' }, BOTH)?.text).toBe('house') // the first enabled one that has text
  })

  it('with no text in any enabled language it falls back to the language that has text — one line, never nothing', () => {
    expect(translationLines({ ru: '', en: 'house' }, RU_ONLY).map((l) => l.label)).toEqual(['EN'])
    expect(translationLines({ ru: 'дом', en: '' }, EN_ONLY).map((l) => l.label)).toEqual(['RU'])
    expect(firstTranslation({ ru: '  ', en: 'house' }, RU_ONLY)?.text).toBe('house') // blanks are not text
    expect(firstTranslation({ ru: null, en: undefined }, BOTH)).toBeNull() // a word with no text at all has nothing to show
    expect(translationLines({ ru: '', en: '' }, BOTH)).toEqual([])
  })

  it('it does not fall back when an enabled language has text (the other one stays hidden)', () => {
    expect(translationLines({ ru: 'дом', en: 'house' }, RU_ONLY)).toHaveLength(1)
    expect(translationLines({ ru: 'дом', en: '' }, BOTH).map((l) => l.label)).toEqual(['RU']) // EN is on but empty: just RU, not a duplicate
  })

  it('the Flutter-era edge: both off (not reachable from Settings) still shows something', () => {
    expect(firstTranslation(both, OFF)?.text).toBe('дом')
  })
})

// ---------------------------------------------------------------------------------------------------------------
// Every surface, in each of the three states, and when the word has no text in the enabled language.
// ---------------------------------------------------------------------------------------------------------------
const word = (over: Partial<Word> = {}): Word =>
  makeWord('casa', { rank: 1, pos: 'n', enTranslation: 'house', ruTranslation: 'дом', exampleSentence: 'Mi casa es grande.', wordFormInExample: 'casa', exampleTranslationEn: 'My house is big.', exampleTranslationRu: 'Мой дом большой.', ...over })
const noRu = word({ ruTranslation: '', exampleTranslationRu: '' })
const noEn = word({ enTranslation: '', exampleTranslationEn: '' })
const learned = (w: Word): Word => ({ ...w, repetitions: 2, nextReview: new Date(Date.now() + 86_400_000) }) as Word

const textOf = (html: string, className: string) => [...html.matchAll(new RegExp(`<[a-z]+ class="${className}">([^<]*)<`, 'g'))].map((m) => m[1])
const rows = (html: string) => [...html.matchAll(/<span class="wc-row-label">(\w+):<\/span><span class="wc-row-text">([^<]*)<\/span>/g)].map((m) => `${m[1]}:${m[2]}`)

describe('the Learn card, the word detail and the Review card back', () => {
  const surfaces = (w: Word, flags: typeof BOTH) => ({
    card: renderToStaticMarkup(createElement(WordCard, { word: w, settings: flags })),
    review: renderToStaticMarkup(createElement(ReviewCard, { word: w, settings: flags, revealed: true, onReveal: () => {} })),
  })

  it.each([
    ['RU only', RU_ONLY, ['RU:дом'], ['Мой дом большой.']],
    ['EN only', EN_ONLY, ['EN:house'], ['My house is big.']],
    ['both', BOTH, ['RU:дом', 'EN:house'], ['Мой дом большой.', 'My house is big.']],
  ])('%s: the translation rows and the example translations are one per enabled language, RU first', (_name, flags, expectedRows, expectedExample) => {
    for (const html of Object.values(surfaces(word(), flags))) {
      expect(rows(html)).toEqual(expectedRows)
      expect(textOf(html, 'wc-translation')).toEqual(expectedExample)
    }
  })

  it('the language that is off is not in the card at all', () => {
    for (const html of Object.values(surfaces(word(), RU_ONLY))) expect(html).not.toMatch(/house|My house is big/)
    for (const html of Object.values(surfaces(word(), EN_ONLY))) expect(html).not.toMatch(/дом|Мой/)
  })

  it('falls back to the language that has text when the enabled one has none', () => {
    for (const html of Object.values(surfaces(noRu, RU_ONLY))) {
      expect(rows(html)).toEqual(['EN:house'])
      expect(textOf(html, 'wc-translation')).toEqual(['My house is big.'])
    }
    for (const html of Object.values(surfaces(noEn, EN_ONLY))) {
      expect(rows(html)).toEqual(['RU:дом'])
      expect(textOf(html, 'wc-translation')).toEqual(['Мой дом большой.'])
    }
  })

  it('with both on and only one language present, that one line (no empty row)', () => {
    for (const html of Object.values(surfaces(noRu, BOTH))) expect(rows(html)).toEqual(['EN:house'])
  })

  it('a word with no translation at all shows no translation block, not an empty one or a dash', () => {
    const html = renderToStaticMarkup(createElement(WordCard, { word: word({ enTranslation: '', ruTranslation: '', exampleTranslationEn: '', exampleTranslationRu: '' }), settings: BOTH }))
    expect(html).not.toContain('wc-translations')
    expect(html).not.toContain('—')
  })
})

describe('the Words list rows', () => {
  const row = (w: Word, via: ListRow['via'] = null): ListRow => ({ word: w, state: 'new', via })
  const line = (w: Word, flags: typeof BOTH, via: ListRow['via'] = null) =>
    renderToStaticMarkup(createElement(WordRow, { row: row(w, via), settings: flags, onOpen: () => {}, onToggleFavourite: () => {}, onBringBack: () => {} })).match(/<span class="word-row-tr">([^<]*)<\/span>/)?.[1] ?? null

  it('one muted line: every enabled language that has text, RU first, joined with " · "', () => {
    expect(line(word(), RU_ONLY)).toBe('дом')
    expect(line(word(), EN_ONLY)).toBe('house')
    expect(line(word(), BOTH)).toBe('дом · house')
  })

  it('with both on and only one language present, just that one (no stray separator)', () => {
    expect(line(noRu, BOTH)).toBe('house')
    expect(line(noEn, BOTH)).toBe('дом')
  })

  it('a row never grows a second line: the muted line is one line that truncates with an ellipsis, and the height is fixed', () => {
    const css = readFileSync('src/index.css', 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
    expect(css).toMatch(/\.word-row-line \{[^}]*white-space: nowrap/s)
    expect(css).toMatch(/\.word-row-line \{[^}]*overflow: hidden/s)
    expect(css).toMatch(/\.word-row-tr \{[^}]*overflow: hidden[^}]*text-overflow: ellipsis/s)
    expect(css).toMatch(/\.word-row-tr \{[^}]*min-width: 0/s)
    expect(readFileSync('src/components/WordRow.tsx', 'utf8')).toMatch(/WORD_ROW_HEIGHT = 72/) // the list lays rows out by this height
    const long = word({ ruTranslation: 'очень длинный перевод '.repeat(20), enTranslation: 'a very long translation '.repeat(20) })
    expect(line(long, BOTH)).toContain(' · ') // everything is in the one line; the browser clips it
  })

  it('falls back to the language that has text, never an em dash', () => {
    expect(line(noRu, RU_ONLY)).toBe('house')
    expect(line(noEn, EN_ONLY)).toBe('дом')
    expect(line(noRu, BOTH)).toBe('house')
    const none = renderToStaticMarkup(createElement(WordRow, { row: row(word({ enTranslation: '', ruTranslation: '' })), settings: BOTH, onOpen: () => {}, onToggleFavourite: () => {}, onBringBack: () => {} }))
    expect(none).not.toContain('—')
  })

  it('a search that matched through a translation shows that translation, even in a language that is switched off', () => {
    expect(line(word(), EN_ONLY, 'ru')).toBe('дом · house') // Russian is off, the query was Russian: the row shows it, with the enabled one
    expect(line(word(), RU_ONLY, 'en')).toBe('дом · house')
    expect(line(word(), BOTH, 'en')).toBe('дом · house') // both are already there
    expect(line(word(), RU_ONLY, 'es_word')).toBe('дом') // a Spanish match uses the rule
    expect(line(word(), EN_ONLY, 'rio_form')).toBe('house')
    expect(line(noRu, EN_ONLY, 'ru')).toBe('house') // a language with no text cannot have matched, so nothing is added
  })
})

describe('the Cloze cue, the summary gloss and the "in this sentence" nudge', () => {
  const settingsOf = (flags: typeof BOTH) => parseSettings({ show_ru_translation: flags.showRuTranslation, show_en_translation: flags.showEnTranslation })

  it('the cue: one line per enabled language, RU first, falling back to the one that has text', () => {
    expect(clozeCueLines(word(), RU_ONLY).map((l) => l.label)).toEqual(['RU'])
    expect(clozeCueLines(word(), EN_ONLY).map((l) => l.label)).toEqual(['EN'])
    expect(clozeCueLines(word(), BOTH).map((l) => l.label)).toEqual(['RU', 'EN'])
    expect(clozeCueLines(noRu, RU_ONLY).map((l) => [l.label, l.text])).toEqual([['EN', 'house']])
    expect(clozeCueLines(word({ ruTranslation: 'дом (здание)' }), RU_ONLY)[0].text).toBe('дом') // the cue drops parentheticals
  })

  it('the summary gloss is the cue lines joined with " · " (every enabled language, the same rule)', () => {
    const gloss = (w: Word, flags: typeof BOTH) => clozeCueLines(w, flags).map((l) => l.text).join(' · ')
    expect([gloss(word(), RU_ONLY), gloss(word(), EN_ONLY), gloss(word(), BOTH)]).toEqual(['дом', 'house', 'дом · house'])
    expect(gloss(noRu, RU_ONLY)).toBe('house')
    expect(gloss(noRu, BOTH)).toBe('house')
    expect(readFileSync('src/screens/Cloze.tsx', 'utf8')).toMatch(/clozeCueLines\(item\.word, data\.settings\)\.map\(\(line\) => line\.text\)\.join\(' · '\)/)
  })

  it('the nudge is written in the language of the first cue line', () => {
    const nudge = (w: Word, flags: typeof BOTH) => clozeFeedback('headword', 'casa', cueLang(w, flags)).text
    expect(nudge(word(), RU_ONLY)).toContain('в этом предложении: casa')
    expect(nudge(word(), EN_ONLY)).toContain('in this sentence: casa')
    expect(nudge(word(), BOTH)).toContain('в этом предложении') // RU before EN
    expect(nudge(noRu, RU_ONLY)).toContain('in this sentence') // the cue fell back to English, so the nudge does too
    expect(nudge(noEn, EN_ONLY)).toContain('в этом предложении')
  })

  it('the question renders the cue lines as the rule says', () => {
    const item = clozePool([learned(word())])[0]
    const cue = (flags: typeof BOTH) => [...renderToStaticMarkup(createElement(ClozeQuestion, { item, settings: settingsOf(flags), onAnswered: () => {} })).matchAll(/cz-cue-pill">(\w+)<\/span> ([^<]*)/g)].map((m) => `${m[1]}:${m[2].trim()}`)
    expect(cue(RU_ONLY)).toEqual(['RU:дом'])
    expect(cue(EN_ONLY)).toEqual(['EN:house'])
    expect(cue(BOTH)).toEqual(['RU:дом', 'EN:house'])
  })
})

describe('the overlay notes and the standard-meaning text', () => {
  const real = parseDictionary(JSON.parse(readFileSync('public/words_enriched.json', 'utf8')), parseRioOverlay(JSON.parse(readFileSync('public/rio_overlay.json', 'utf8'))))
  const coger = real.find((w) => w.esWord === 'coger')!
  const unescape = (text: string) => text.replaceAll('&#x27;', "'").replaceAll('&quot;', '"').replaceAll('&amp;', '&')
  const notes = (flags: typeof BOTH) => {
    const html = renderToStaticMarkup(createElement(RelationBlock, { relation: relationFor(coger), settings: flags }))
    const block = html.match(/<div class="wc-note">(.*?)<\/div>/)![1]
    return [...block.matchAll(/<p>(?:<span>Note: <\/span>)?([^<]*)<\/p>/g)].map((m) => unescape(m[1]))
  }
  const localized = coger.rio!.notes!

  it('the note is one block with a paragraph for each enabled language, RU first', () => {
    expect(notes(RU_ONLY)).toEqual([localized.ru])
    expect(notes(EN_ONLY)).toEqual([localized.en])
    expect(notes(BOTH)).toEqual([localized.ru, localized.en])
  })

  it('both paragraphs are in the same block: one box, one "Note:" label, on the first paragraph', () => {
    const html = renderToStaticMarkup(createElement(RelationBlock, { relation: relationFor(coger), settings: BOTH }))
    expect(html.match(/class="wc-note"/g)).toHaveLength(1)
    expect(html.match(/Note: /g)).toHaveLength(1)
    expect(html).toMatch(/<div class="wc-note"><p><span>Note: <\/span>[^<]*<\/p><p>[^<]*<\/p><\/div>/)
  })

  it('falls back to the language that has text when the enabled one has none, and does not repeat when one is empty', () => {
    expect(pickLocalizedAll({ en: 'English', ru: '' }, RU_ONLY)).toEqual(['English'])
    expect(pickLocalizedAll({ en: '', ru: 'Русский' }, EN_ONLY)).toEqual(['Русский'])
    expect(pickLocalizedAll({ en: 'English', ru: 'Русский' }, BOTH)).toEqual(['Русский', 'English'])
    expect(pickLocalizedAll({ en: 'English', ru: '' }, BOTH)).toEqual(['English'])
    expect(pickLocalizedAll(null, BOTH)).toEqual([])
  })

  describe('the standard meaning of a meaning_shift word', () => {
    const shifted = real.find((w) => w.rio?.type === 'meaning_shift' && w.rio.stdMeaning)!
    const std = shifted.rio!.stdMeaning!
    const first = (text: string) => text.split(/[,;]/)[0].trim()
    const lines = (flags: typeof BOTH) => {
      const html = renderToStaticMarkup(createElement(RelationBlock, { relation: relationFor(shifted), settings: flags }))
      const block = html.match(/<div class="wc-relation">(.*?)<\/div>/)![1]
      return [...block.matchAll(/<p>(?:standard meaning: )?<span>([^<]*)<\/span><\/p>/gi)].map((m) => unescape(m[1])).slice(-2)
    }

    it('follows the same rule: one gloss per enabled language, RU first', () => {
      expect(lines(RU_ONLY).slice(-1)).toEqual([first(std.ru)])
      expect(lines(EN_ONLY).slice(-1)).toEqual([first(std.en)])
      expect(lines(BOTH)).toEqual([first(std.ru), first(std.en)])
    })

    it('with both on the label is on the first paragraph only', () => {
      const html = renderToStaticMarkup(createElement(RelationBlock, { relation: relationFor(shifted), settings: BOTH }))
      expect(html.match(/standard meaning: /gi)).toHaveLength(1)
    })
  })
})

describe('Matching', () => {
  const learnedWords = (n: number): Word[] =>
    Array.from({ length: n }, (_, i) => learned(word({ esWord: `palabra${i}`, rank: i + 1, enTranslation: `thing ${i}`, ruTranslation: `штука ${'абвгдежзик'[i]}`, exampleSentence: '' })))

  it('the right column is the first enabled language that has text: Russian, English, and Russian first when both are on', () => {
    expect(firstMatchGloss(word({ ruTranslation: 'дом, жильё' }), RU_ONLY)).toBe('дом')
    expect(firstMatchGloss(word({ enTranslation: 'house, home' }), EN_ONLY)).toBe('house')
    expect(firstMatchGloss(word(), BOTH)).toBe('дом')
  })

  it('an English-only user gets a usable exercise: a full group, with English glosses', () => {
    const group = buildMatchingGroup(learnedWords(8), EN_ONLY)!
    expect(group).not.toBeNull()
    expect(group.items.every((m) => /^thing \d$/.test(m.gloss))).toBe(true)
    expect(matchingEligibleCount(learnedWords(8), EN_ONLY)).toBe(8)
    const ru = buildMatchingGroup(learnedWords(8), RU_ONLY)!
    expect(ru.items.every((m) => m.gloss.startsWith('штука'))).toBe(true)
  })

  it('collisions are judged on the language in use: words that share a Russian gloss do not collide for an English-only user', () => {
    const sameRu = learnedWords(6).map((w) => ({ ...w, ruTranslation: 'одно и то же' }) as Word)
    expect(matchingEligibleCount(sameRu, RU_ONLY)).toBe(1)
    expect(matchingEligibleCount(sameRu, EN_ONLY)).toBe(6)
  })

  it('falls back to the language that has text; a word with no text in any language cannot appear', () => {
    expect(firstMatchGloss(noRu, RU_ONLY)).toBe('house')
    expect(firstMatchGloss(noEn, EN_ONLY)).toBe('дом')
    expect(matchItem(word({ enTranslation: '', ruTranslation: '' }), BOTH).gloss).toBe('')
    const empty = learnedWords(6).map((w, i) => (i === 0 ? ({ ...w, enTranslation: '', ruTranslation: '' } as Word) : w))
    expect(matchingPool(empty, BOTH).map((m) => m.id)).not.toContain('palabra0')
  })
})

describe('the word of the day', () => {
  const real = parseDictionary(JSON.parse(readFileSync('public/words_enriched.json', 'utf8')), parseRioOverlay(JSON.parse(readFileSync('public/rio_overlay.json', 'utf8'))))
  const day = new Date(2026, 9, 7, 12)
  it('shows one translation per enabled language, the same lines as the Cloze cue', () => {
    for (const flags of [RU_ONLY, EN_ONLY, BOTH]) {
      const wotd = wordOfTheDay(real, flags, day)!
      expect(wotd.translations).toEqual(clozeCueLines(wotd.word, flags).map((l) => l.text))
      expect(wotd.translations.length).toBe(flags === BOTH ? 2 : 1)
    }
  })
  it('goes through the shared rule (no rule of its own)', () => {
    expect(readFileSync('src/data/wordOfDay.ts', 'utf8')).toMatch(/clozeCueLines\(word, settings\)/)
    expect(readFileSync('src/data/practice.ts', 'utf8')).toMatch(/translationLines\(\{ ru: stripParenthetical/)
  })
})

describe('the exceptions that stay', () => {
  it('search still matches both languages whatever the flags say (it does not take the flags at all)', () => {
    const source = readFileSync('src/data/search.ts', 'utf8')
    expect(source).not.toMatch(/showRuTranslation|showEnTranslation|TranslationFlags/)
  })
  it('eligibility still requires both languages (BACKLOG.md says why)', () => {
    const backlog = readFileSync('BACKLOG.md', 'utf8')
    expect(backlog).toMatch(/English-only user is still gated on Russian text/)
    expect(readFileSync('src/data/words.ts', 'utf8')).toMatch(/enTranslation\.trim\(\) !== '' && word\.ruTranslation\.trim\(\) !== ''/)
  })
})

describe('the second rule is gone', () => {
  it('the single-language rule is gone: its name exists nowhere in the source', () => {
    const name = ['lang', 'From', 'Settings'].join('') // not spelled out here, so this file does not match itself
    const hits: string[] = []
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        const path = `${dir}/${entry}`
        if (statSync(path).isDirectory()) walk(path)
        else if (/\.(ts|tsx|css|html|md)$/.test(entry) && readFileSync(path, 'utf8').includes(name)) hits.push(path)
      }
    }
    walk('src')
    expect(hits).toEqual([])
  })
})
