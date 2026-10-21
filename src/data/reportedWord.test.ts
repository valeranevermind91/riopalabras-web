import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { makeWord } from '../testing/makeWord'
import { parseDictionary } from './dictionary'
import { buildReport, reportFor, reportedWord, STANDARD_LABEL, toFeedbackRow, type FeedbackContext } from './feedback'
import { headword } from './headword'
import { parseFallbackExamples, parseRioOverlay } from './rio'

// What a word report names, over the real dictionary and the real overlay (the way the app builds its words): the word on the card first, the standard form after
// it when the card leads with another. `Word.esWord` is the dictionary key; for 63 cards it is not what is on screen.

const words = parseDictionary(
  JSON.parse(readFileSync('public/words_enriched.json', 'utf8')),
  parseRioOverlay(JSON.parse(readFileSync('public/rio_overlay.json', 'utf8'))),
  parseFallbackExamples(JSON.parse(readFileSync('public/examples_fallback.json', 'utf8'))),
)
const byKey = (esWord: string) => words.find((w) => w.esWord === esWord)!
const differs = (w: (typeof words)[number]) => headword(w).text.toLowerCase() !== w.esWord.toLowerCase()
const context: FeedbackContext = { appVersion: 'test', uiLanguage: 'en', screen: 'word', platform: 'android' }

describe('what a word report names', () => {
  it('for every word of the dictionary: the word on the card comes first, and the standard form follows, labelled, exactly when the card leads with another', () => {
    expect(words).toHaveLength(4753)
    for (const w of words) {
      const shown = headword(w).text
      const named = reportedWord(w)
      expect(named.startsWith(shown), w.esWord).toBe(true) // what the person sees, first
      expect(named, w.esWord).toBe(differs(w) ? `${shown} (${STANDARD_LABEL}: ${w.esWord})` : shown)
    }
  })

  it('the two halves, for every word: what the person is shown is the word on the card alone; what is sent is that and the standard form', () => {
    for (const w of words) {
      const { shown, named } = reportFor(w)
      expect(shown, w.esWord).toBe(headword(w).text)
      expect(shown, w.esWord).not.toContain(STANDARD_LABEL) // nothing of the label is ever shown
      expect(named, w.esWord).toBe(reportedWord(w))
      expect(named.startsWith(shown), w.esWord).toBe(true)
    }
    expect(reportFor(byKey('neumático'))).toEqual({ shown: 'cubierta', named: 'cubierta (standard: neumático)' })
  })

  it('63 cards lead with a Rioplatense form, every one of them an overlay replacement, and each report names both words', () => {
    const different = words.filter(differs)
    expect(different).toHaveLength(63)
    for (const w of different) {
      expect(w.rio?.type, w.esWord).toBe('replacement')
      expect(reportedWord(w)).toContain(w.rio!.form)
      expect(reportedWord(w)).toContain(w.esWord)
    }
  })

  it('the case reported: the card for "cubierta" (dictionary key "neumático") names cubierta first, with the standard form after it', () => {
    const neumatico = byKey('neumático')
    expect(headword(neumatico).text).toBe('cubierta') // what was on screen
    expect(reportedWord(neumatico)).toBe('cubierta (standard: neumático)')
    expect(reportedWord(neumatico)).not.toBe('neumático') // what used to be sent
  })

  it('a card that leads with the standard word names just that word', () => {
    expect(reportedWord(byKey('casa'))).toBe('casa')
    expect(reportedWord(byKey('agua'))).toBe('agua')
  })

  it('two entries that share a headword are told apart by the standard form: quizá and quizás both lead with "capaz"', () => {
    expect(headword(byKey('quizá')).text).toBe('capaz')
    expect(headword(byKey('quizás')).text).toBe('capaz')
    expect(reportedWord(byKey('quizá'))).toBe('capaz (standard: quizá)')
    expect(reportedWord(byKey('quizás'))).toBe('capaz (standard: quizás)')
  })

  it('a word the user added: its own typed word; and the legacy Rioplatense form when a card leads with it', () => {
    expect(reportedWord(makeWord('zapallito', { rank: null, isCustom: true, isRioplatenseVariant: true }))).toBe('zapallito')
    expect(reportedWord(makeWord('mia', { rank: null, isCustom: true }))).toBe('mia')
    const legacy = makeWord('niño', { esRioplatense: 'pibe', wordFormInExample: 'pibe', exampleSentence: 'El pibe juega.' })
    expect(headword(legacy).text).toBe('pibe')
    expect(reportedWord(legacy)).toBe('pibe (standard: niño)')
  })

  it('it travels into the row as it is: es_word is what the person saw first, and a general message carries no word', () => {
    const report = buildReport({ id: 'i', kind: 'word', esWord: reportedWord(byKey('neumático')), text: 'La traducción no está bien', context })
    expect(report.ok && toFeedbackRow('u', report.report).es_word).toBe('cubierta (standard: neumático)')
    const general = buildReport({ id: 'j', kind: 'general', esWord: reportedWord(byKey('neumático')), text: 'hola', context })
    expect(general.ok && toFeedbackRow('u', general.report).es_word).toBeNull()
  })
})

// The bot's own message (the proxy's feedback-notify.js, when the repository sits next to this one): it renders the row's es_word as it is, so what the app sends is what
// the author reads. RIOPALABRAS_PROXY_DIR points the check at another copy (the mutation runs use a scratch copy).
const PROXY = process.env.RIOPALABRAS_PROXY_DIR ?? '../riopalabras-proxy'
describe.skipIf(!existsSync(`${PROXY}/feedback-notify.js`))('the bot message for a word report', () => {
  const { entryPieces } = createRequire(import.meta.url)(resolve(PROXY, 'feedback-notify.js')) as { entryPieces: (row: Record<string, unknown>) => { text: string }[] }
  const row = (esWord: string) => ({ id: '0123abcd-0000-4000-8000-000000000000', created_at: '2026-10-20T01:02:03Z', kind: 'word', es_word: esWord, message: 'No es así', app_version: 'v', ui_language: 'ru', screen: 'word', platform: 'android' })

  it('is headed by the word on the card, then the standard form, labelled: "Word report · cubierta (standard: neumático) · …"', () => {
    const [piece] = entryPieces(row(reportedWord(byKey('neumático'))))
    expect(piece.text.startsWith('<b>Word report</b> · <b>cubierta (standard: neumático)</b> · ')).toBe(true)
    expect(piece.text).not.toContain('<b>neumático</b>')
  })

  it('names the right word for all 63 cards that lead with another form, whole (the bot cuts a field at 40 characters, and the longest label is 36)', () => {
    for (const w of words.filter(differs)) {
      const [piece] = entryPieces(row(reportedWord(w)))
      expect(piece.text, w.esWord).toContain(`<b>${reportedWord(w)}</b>`)
      expect(piece.text.split('\n')[0], w.esWord).not.toContain('…') // not cut
    }
    expect(Math.max(...words.filter(differs).map((w) => reportedWord(w).length))).toBeLessThanOrEqual(40)
  })
})
