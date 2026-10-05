import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { fakeSupabase } from '../testing/fakeSupabase'
import { makeWord } from '../testing/makeWord'
import { parseDictionary } from './dictionary'
import { createLocalMetricsStore, createMetricsRecorder } from './metrics'
import {
  CLOZE_BLANK,
  CLOZE_SESSION_SIZE,
  MATCH_GROUP_SIZE,
  PRACTICE_MIN_WORDS,
  answerCloze,
  blankSentence,
  buildClozeSession,
  buildHint,
  buildMatchingGroup,
  checkClozeAnswer,
  clearWrong,
  clozeCueLines,
  clozeEligibleCount,
  clozePool,
  clozeScore,
  clozeTarget,
  findAllOccurrences,
  firstRussianGloss,
  glossKey,
  isMatchingComplete,
  isPracticeWord,
  matchingEligibleCount,
  matchingPool,
  recordPracticeCompleted,
  splitSentence,
  startCloze,
  startMatching,
  tapAndFinish,
  tapTile,
  type MatchGroup,
  type MatchItem,
  type MatchingState,
} from './practice'
import { applySettingsPatch } from './mutations'
import { parseFallbackExamples, parseRioOverlay } from './rio'
import { parseSettings } from './settings'
import type { Word } from './types'
import { createSupabaseWriteQueue } from './writeQueue'
import { strings } from '../strings'

const dictionary = parseDictionary(
  JSON.parse(readFileSync('public/words_enriched.json', 'utf8')),
  parseRioOverlay(JSON.parse(readFileSync('public/rio_overlay.json', 'utf8'))),
  parseFallbackExamples(JSON.parse(readFileSync('public/examples_fallback.json', 'utf8'))),
)
const past = new Date('2026-10-01T03:00:00.000Z')
/** The first n words by rank, marked as learned. */
const learnedFirst = (n: number): Word[] => dictionary.map((w) => ((w.rank ?? 1e9) <= n ? { ...w, repetitions: 1, nextReview: past } : w))
const everyone = learnedFirst(5000)
const everyonePool = clozePool(everyone)
const byWord = (words: readonly Word[], es: string) => words.find((w) => w.esWord === es)!

/** A learned word with a chosen sentence and form. */
const withExample = (esWord: string, sentence: string, form: string | null, over: Partial<Word> = {}) =>
  makeWord(esWord, { repetitions: 1, nextReview: past, exampleSentence: sentence, wordFormInExample: form, ru: undefined, ...over } as Partial<Word>)
const learned = (esWord: string, over: Partial<Word> = {}) => makeWord(esWord, { repetitions: 1, nextReview: past, ...over })

describe('who can be practised', () => {
  it('learned words with the gates Review uses', () => {
    expect(isPracticeWord(learned('casa'))).toBe(true)
  })

  it.each([
    ['not learned yet', { repetitions: 0 }],
    ['hidden', { isHidden: true }],
    ['not enriched', { isEnriched: false }],
    ['a part of speech Review never shows', { pos: 'prep' }],
    ['a letter', { pos: 'letter' }],
    ['an interjection', { pos: 'interj' }],
    ['missing the Russian translation', { ruTranslation: '' }],
    ['missing the English translation', { enTranslation: ' ' }],
  ] as [string, Partial<Word>][])('excludes a word that is %s', (_label, over) => {
    expect(isPracticeWord(learned('x', over))).toBe(false)
  })

  it('in the real dictionary no letter or interjection is ever offered, by either exercise', () => {
    const pos = new Map(everyone.map((w) => [w.esWord.toLowerCase(), w.pos]))
    expect(everyone.some((w) => w.pos === 'letter') && everyone.some((w) => w.pos === 'interj')).toBe(true) // they exist, so the exclusion is meaningful
    for (const m of matchingPool(everyone)) expect(['letter', 'interj']).not.toContain(pos.get(m.id))
    for (const item of everyonePool) expect(['letter', 'interj']).not.toContain(item.word.pos)
  })
})

describe('Matching: first Russian gloss and collisions', () => {
  it('uses the first gloss, without the parenthetical', () => {
    expect(firstRussianGloss(learned('a', { ruTranslation: 'эмпанада (вид запечённого пирожка), пирожок' }))).toBe('эмпанада')
    expect(firstRussianGloss(learned('a', { ruTranslation: 'стол, табличка' }))).toBe('стол')
    expect(firstRussianGloss(learned('a', { ruTranslation: 'быть; находиться' }))).toBe('быть')
    expect(firstRussianGloss(learned('a', { ruTranslation: '(устар.) дом' }))).toBe('(устар.) дом') // never an empty tile
  })

  it('follows the card: an overlay translation replaces the dictionary one when the Rioplatense headword leads', () => {
    const w = byWord(everyone, 'vagabundo')
    expect(w.rio?.translation?.ru).toBe('бездомный, бродяга')
    expect(firstRussianGloss(w)).toBe('бездомный')
  })

  it('glossKey ignores case, ё/е, accents, punctuation and spacing', () => {
    expect(glossKey('Ёж!')).toBe(glossKey('еж'))
    expect(glossKey(' дом ')).toBe(glossKey('ДОМ'))
    expect(glossKey('what-ever')).toBe(glossKey('what ever'))
  })

  it('never puts two words with the same first gloss (or the same headword) in a group', () => {
    const words = [
      learned('uno', { ruTranslation: 'мальчик' }),
      learned('dos', { ruTranslation: 'Мальчик, парень' }), // same first gloss as uno
      learned('tres', { ruTranslation: 'девочка' }),
      learned('cuatro', { ruTranslation: 'дом' }),
      learned('cinco', { ruTranslation: 'стол' }),
      learned('seis', { ruTranslation: 'окно' }),
      learned('siete', { ruTranslation: 'дверь (входная)' }),
    ]
    for (let i = 0; i < 50; i++) {
      const group = buildMatchingGroup(words)!
      const keys = group.items.map((m) => glossKey(m.gloss))
      expect(new Set(keys).size).toBe(MATCH_GROUP_SIZE)
      expect(group.items.filter((m) => m.id === 'uno' || m.id === 'dos').length).toBeLessThanOrEqual(1)
    }
  })

  it('counts colliding words once: eligibility is about words a group can really use', () => {
    const collide = ['uno', 'dos', 'tres', 'cuatro', 'cinco'].map((w) => learned(w, { ruTranslation: 'одно и то же' }))
    expect(matchingEligibleCount(collide)).toBe(1)
    expect(buildMatchingGroup(collide)).toBeNull()
    const four = ['a', 'b', 'c', 'd'].map((w, i) => learned(w, { ruTranslation: `слово${'абвг'[i]}` }))
    expect(matchingEligibleCount([...four, learned('e', { ruTranslation: 'слово а' }), learned('f', { ruTranslation: 'слово б' })])).toBeGreaterThanOrEqual(4)
  })

  it('on the real dictionary: groups are 5 distinct non-colliding pairs, with both columns holding the same words', () => {
    const words = learnedFirst(800)
    for (let i = 0; i < 200; i++) {
      const g = buildMatchingGroup(words)!
      expect(g.items).toHaveLength(MATCH_GROUP_SIZE)
      expect(new Set(g.items.map((m) => glossKey(m.gloss))).size).toBe(MATCH_GROUP_SIZE)
      expect(new Set(g.items.map((m) => m.spanish.toLowerCase())).size).toBe(MATCH_GROUP_SIZE)
      expect([...g.left].map((m) => m.id).sort()).toEqual([...g.items].map((m) => m.id).sort())
      expect([...g.right].map((m) => m.id).sort()).toEqual([...g.items].map((m) => m.id).sort())
      for (const m of g.items) expect(m.gloss.includes('(')).toBe(false)
    }
  })

  it('draws at random and allows repeats across groups', () => {
    const words = learnedFirst(300)
    const seen = new Set<string>()
    let overlapped = false
    for (let i = 0; i < 40; i++) {
      for (const m of buildMatchingGroup(words)!.items) {
        if (seen.has(m.id)) overlapped = true
        seen.add(m.id)
      }
    }
    expect(seen.size).toBeGreaterThan(MATCH_GROUP_SIZE)
    expect(overlapped).toBe(true)
  })

  it('the Spanish column shows the headword by the Learn / Review rule', () => {
    const words = everyone
    const item = matchingPool(words).find((m) => m.id === 'cigarrillo')!
    expect(item.spanish).toBe('pucho')
  })

  it('needs 5 usable words: 4 give no group, 5 do', () => {
    const mk = (n: number) => Array.from({ length: n }, (_, i) => learned(`w${i}`, { ruTranslation: `слово ${'абвгде'[i]}` }))
    expect(buildMatchingGroup(mk(4))).toBeNull()
    expect(buildMatchingGroup(mk(5))).not.toBeNull()
    expect(matchingEligibleCount(mk(4))).toBeLessThan(PRACTICE_MIN_WORDS)
    expect(matchingEligibleCount(mk(5))).toBe(5)
  })
})

describe('Matching: taps', () => {
  const item = (id: string, gloss = id): MatchItem => ({ id, spanish: id.toUpperCase(), gloss })
  const items = ['a', 'b', 'c', 'd', 'e'].map((id) => item(id))
  const group: MatchGroup = { items, left: items, right: [...items].reverse() }
  const fresh = () => startMatching(group)

  it('a correct pair locks and stays locked; selection clears', () => {
    let s = tapTile(fresh(), 'left', 'a')
    expect(s.selectedLeft).toBe('a')
    s = tapTile(s, 'right', 'a')
    expect(s.matched.has('a')).toBe(true)
    expect(s).toMatchObject({ selectedLeft: null, selectedRight: null, wrong: false })
    expect(tapTile(s, 'left', 'a')).toBe(s) // locked tiles ignore taps
    expect(tapTile(s, 'right', 'a')).toBe(s)
  })

  it('a wrong pair flashes, blocks every tap until cleared, and costs nothing', () => {
    let s = tapTile(tapTile(fresh(), 'left', 'a'), 'right', 'b')
    expect(s.wrong).toBe(true)
    expect(s.matched.size).toBe(0)
    expect(Object.keys(s).sort()).toEqual(['left', 'matched', 'right', 'selectedLeft', 'selectedRight', 'wrong']) // no score, no counter
    expect(tapTile(s, 'left', 'c')).toBe(s) // input blocked
    expect(tapTile(s, 'right', 'a')).toBe(s)
    s = clearWrong(s)
    expect(s).toMatchObject({ wrong: false, selectedLeft: null, selectedRight: null })
    expect(tapTile(s, 'left', 'c').selectedLeft).toBe('c')
  })

  it('tapping a selected tile again deselects it; selecting another on the same side replaces it', () => {
    let s = tapTile(fresh(), 'left', 'a')
    expect(tapTile(s, 'left', 'a').selectedLeft).toBeNull()
    s = tapTile(s, 'left', 'b')
    expect(s.selectedLeft).toBe('b')
  })

  it('matches by id, not by text: two different words with the same displayed gloss are not a pair', () => {
    const twins = [item('a', 'same'), item('b', 'same')]
    let s = startMatching({ items: twins, left: twins, right: twins })
    s = tapTile(tapTile(s, 'left', 'a'), 'right', 'b')
    expect(s.wrong).toBe(true)
  })

  it('the group is complete when all five are matched, and onComplete runs once, on the last pair', () => {
    const onComplete = vi.fn()
    let s: MatchingState = fresh()
    for (const id of ['a', 'b', 'c', 'd']) {
      s = tapAndFinish(tapAndFinish(s, 'left', id, onComplete), 'right', id, onComplete)
      expect(isMatchingComplete(s)).toBe(false)
    }
    expect(onComplete).not.toHaveBeenCalled()
    s = tapAndFinish(s, 'left', 'e', onComplete)
    expect(onComplete).not.toHaveBeenCalled()
    s = tapAndFinish(s, 'right', 'e', onComplete)
    expect(isMatchingComplete(s)).toBe(true)
    expect(onComplete).toHaveBeenCalledTimes(1)
    tapAndFinish(s, 'left', 'a', onComplete) // taps after the end do nothing
    expect(onComplete).toHaveBeenCalledTimes(1)
  })
})

describe('Cloze: eligibility', () => {
  it('a single-word target of 3+ characters is eligible', () => {
    const t = clozeTarget(withExample('casa', 'Mi casa es tu casa.', 'casa'))!
    expect(t.target).toBe('casa')
    expect(t.spans).toHaveLength(2)
  })

  it('multi-word targets are excluded: con vos, control remoto, de más, casa de salud', () => {
    const words = everyone
    for (const es of ['contigo', 'mando', 'guay', 'asilo']) expect(clozeTarget(byWord(words, es)), es).toBeNull()
    const pool = everyonePool.map((i) => i.word.esWord)
    for (const es of ['contigo', 'mando', 'guay', 'asilo']) expect(pool).not.toContain(es)
  })

  it('targets under 3 characters are excluded (te, ya, mi, oh, OK)', () => {
    const words = everyone
    for (const es of ['te', 'ya', 'mi', 'oh', 'OK']) expect(clozeTarget(byWord(words, es)), es).toBeNull()
  })

  it('no sentence or no locatable form means no blank', () => {
    expect(clozeTarget(withExample('casa', '', 'casa'))).toBeNull()
    expect(clozeTarget(withExample('casa', 'Nada que ver aquí.', 'casa'))).toBeNull()
  })

  it('the real pool is large and clean: every target is one word of 3+ characters found in its sentence', () => {
    const pool = everyonePool
    expect(pool.length).toBeGreaterThan(4000)
    for (const { target } of pool) {
      expect(/\s/.test(target.target)).toBe(false)
      expect([...target.target].length).toBeGreaterThanOrEqual(3)
      expect(target.sentence.slice(target.spans[0].start, target.spans[0].end)).toBe(target.target)
    }
  })

  it('the pool needs learned words: unlearned ones are not in it', () => {
    expect(clozeEligibleCount(dictionary)).toBe(0)
    const n = clozeEligibleCount(learnedFirst(300))
    expect(n).toBeGreaterThan(150) // function words (articles, prepositions, pronouns) and a few short forms drop out
    expect(n).toBeLessThanOrEqual(300)
  })

  it('leads with the Rioplatense headword and blanks that form (pucho, not cigarrillo)', () => {
    const item = everyonePool.find((i) => i.word.esWord === 'cigarrillo')!
    expect(item.headword).toBe('pucho')
    expect(item.target.target.toLowerCase()).toBe('pucho')
  })
})

describe('Cloze: blanking', () => {
  it('blanks EVERY occurrence of the target, case-insensitively', () => {
    const t = clozeTarget(withExample('mañana', 'Mañana a la mañana voy al mercado.', 'mañana'))!
    expect(t.spans).toHaveLength(2)
    expect(blankSentence(t.sentence, t.spans)).toBe(`${CLOZE_BLANK} a la ${CLOZE_BLANK} voy al mercado.`)
    expect(blankSentence(t.sentence, t.spans).toLowerCase()).not.toContain('mañana')
  })

  it('the blank is always the same fixed length, whatever the answer', () => {
    expect(CLOZE_BLANK).toBe('_____')
    const short = clozeTarget(withExample('sol', 'El sol sale temprano.', 'sol'))!
    const long = clozeTarget(withExample('extraordinario', 'Fue un día extraordinario para todos.', 'extraordinario'))!
    expect(blankSentence(short.sentence, short.spans)).toContain(CLOZE_BLANK)
    expect(blankSentence(long.sentence, long.spans)).toContain(CLOZE_BLANK)
    expect(blankSentence(short.sentence, short.spans).match(/_+/g)).toEqual([CLOZE_BLANK])
    expect(blankSentence(long.sentence, long.spans).match(/_+/g)).toEqual([CLOZE_BLANK])
  })

  it('only whole words are blanked: "casa" inside "casamiento" or "acasar" stays', () => {
    const sentence = 'La casa, el casamiento y la Casa.'
    const last = sentence.lastIndexOf('Casa')
    expect(findAllOccurrences(sentence, 'casa')).toEqual([
      { start: 3, end: 7 },
      { start: last, end: last + 4 },
    ])
  })

  it('handles accents and ñ at word edges', () => {
    expect(findAllOccurrences('Ñandú y ñandú.', 'ñandú')).toHaveLength(2)
    expect(findAllOccurrences('¿Qué día es? Un día.', 'día')).toHaveLength(2)
  })

  it('splitSentence reproduces the sentence, marking each target (for the reveal)', () => {
    const t = clozeTarget(withExample('mañana', 'Mañana a la mañana voy.', 'mañana'))!
    const parts = splitSentence(t.sentence, t.spans)
    expect(parts.map((p) => p.text).join('')).toBe(t.sentence)
    expect(parts.filter((p) => p.target).map((p) => p.text)).toEqual(['Mañana', 'mañana'])
  })

  it('an inflected target is the form in the sentence', () => {
    const t = clozeTarget(withExample('ser', 'Vos sos mi mejor amigo.', 'sos'))!
    expect(t.target).toBe('sos')
    expect(blankSentence(t.sentence, t.spans)).toBe(`Vos ${CLOZE_BLANK} mi mejor amigo.`)
  })
})

describe('Cloze: checking answers', () => {
  const check = (typed: string, target = 'está', head = 'estar') => checkClozeAnswer({ typed, target, headword: head })

  it('exact, ignoring case and surrounding spaces', () => {
    expect(check('está')).toEqual({ outcome: 'correct', kind: 'exact' })
    expect(check('  ESTÁ ')).toEqual({ outcome: 'correct', kind: 'exact' })
  })

  it('a missing or extra accent is correct, with an accent nudge', () => {
    expect(check('esta')).toEqual({ outcome: 'correct', kind: 'accent' })
    expect(check('estáa'.slice(0, 4), 'esta', 'estar')).toEqual({ outcome: 'correct', kind: 'accent' }) // typed "está", target "esta"
    expect(check('ESTA')).toEqual({ outcome: 'correct', kind: 'accent' })
  })

  it('ñ is NOT folded to n', () => {
    expect(checkClozeAnswer({ typed: 'cana', target: 'caña', headword: 'caña' })).toEqual({ outcome: 'wrong', kind: 'wrong' })
    expect(checkClozeAnswer({ typed: 'ano', target: 'año', headword: 'año' })).toEqual({ outcome: 'wrong', kind: 'wrong' })
    expect(checkClozeAnswer({ typed: 'caña', target: 'caña', headword: 'caña' })).toEqual({ outcome: 'correct', kind: 'exact' })
    expect(checkClozeAnswer({ typed: 'CAÑA', target: 'caña', headword: 'caña' })).toEqual({ outcome: 'correct', kind: 'exact' })
  })

  it('the dictionary headword is accepted for an inflected target, with the "in this sentence" nudge', () => {
    const v = checkClozeAnswer({ typed: 'tener', target: 'tenés', headword: 'tener' })
    expect(v).toEqual({ outcome: 'correct', kind: 'headword' })
    expect(strings.practice.en.inSentence('tenés')).toBe('in this sentence: tenés')
    expect(strings.practice.ru.inSentence('tenés')).toBe('в этом предложении: tenés')
    expect(checkClozeAnswer({ typed: 'TENER ', target: 'tenés', headword: 'tener' }).kind).toBe('headword')
    expect(checkClozeAnswer({ typed: 'tenés', target: 'tenés', headword: 'tener' }).kind).toBe('exact') // the sentence form still wins
    expect(checkClozeAnswer({ typed: 'tenes', target: 'tenés', headword: 'tener' }).kind).toBe('accent')
  })

  it('a headword typed without its accent is still the headword', () => {
    expect(checkClozeAnswer({ typed: 'oir', target: 'oís', headword: 'oír' })).toEqual({ outcome: 'correct', kind: 'headword' })
  })

  it('when the headword is the sentence form, there is nothing extra to accept', () => {
    expect(checkClozeAnswer({ typed: 'pucho', target: 'pucho', headword: 'pucho' }).kind).toBe('exact')
  })

  it('the standard word is not an answer when the Rioplatense one leads', () => {
    expect(checkClozeAnswer({ typed: 'cigarrillo', target: 'pucho', headword: 'pucho' })).toEqual({ outcome: 'wrong', kind: 'wrong' })
  })

  it('anything else, and an empty answer, is wrong', () => {
    expect(check('estar!').outcome).toBe('wrong')
    expect(check('').outcome).toBe('wrong')
    expect(check('   ').outcome).toBe('wrong')
  })

  it('the accent nudge and the other messages exist in both languages', () => {
    for (const lang of ['en', 'ru'] as const) {
      const t = strings.practice[lang]
      expect(t.accentNudge('está')).toContain('está')
      expect(t.wrong('está')).toContain('está')
      expect(t.gaveUp('está')).toContain('está')
      expect(t.score(3, 10)).toContain('3')
    }
  })
})

describe('Cloze: hint, cue, score', () => {
  it('the hint is the first letter plus asterisks (an accented first letter stays)', () => {
    expect(buildHint('guapo')).toBe('g****')
    expect(buildHint('árbol')).toBe('á****')
    expect(buildHint('ñandú')).toBe('ñ****')
    expect(buildHint('')).toBe('')
  })

  it('the cue follows the translation settings, RU first, with a fallback when the chosen language is empty', () => {
    const w = learned('x', { ruTranslation: 'эмпанада (вид пирожка)', enTranslation: 'empanada (pastry)' })
    expect(clozeCueLines(w, { showRuTranslation: true, showEnTranslation: false })).toEqual([{ label: 'RU', text: 'эмпанада' }])
    expect(clozeCueLines(w, { showRuTranslation: false, showEnTranslation: true })).toEqual([{ label: 'EN', text: 'empanada' }])
    expect(clozeCueLines(w, { showRuTranslation: true, showEnTranslation: true })).toEqual([
      { label: 'RU', text: 'эмпанада' },
      { label: 'EN', text: 'empanada' },
    ])
    expect(clozeCueLines(w, { showRuTranslation: false, showEnTranslation: false })).toEqual([{ label: 'RU', text: 'эмпанада' }])
  })

  it('score counts correct answers only', () => {
    expect(clozeScore(['correct', 'wrong', 'gaveUp', 'correct'])).toBe(2)
  })
})

describe('Cloze: session sizes and the floor', () => {
  const pool = (n: number) => Array.from({ length: n }, (_, i) => withExample(`palabra${i}`, `Esta es la palabra${i} del día.`, `palabra${i}`))

  it('up to 10 questions, random from the pool', () => {
    expect(buildClozeSession(pool(40))).toHaveLength(CLOZE_SESSION_SIZE)
    expect(CLOZE_SESSION_SIZE).toBe(10)
    const a = buildClozeSession(pool(40), () => 0.1)!.map((i) => i.headword)
    const b = buildClozeSession(pool(40), () => 0.9)!.map((i) => i.headword)
    expect(a).not.toEqual(b)
    expect(new Set(buildClozeSession(pool(40))!.map((i) => i.headword)).size).toBe(10)
  })

  it('fewer than 10 eligible words run with what exists, down to the floor of 5', () => {
    expect(buildClozeSession(pool(7))).toHaveLength(7)
    expect(buildClozeSession(pool(5))).toHaveLength(5)
  })

  it('below 5 eligible words there is no session', () => {
    expect(PRACTICE_MIN_WORDS).toBe(5)
    expect(buildClozeSession(pool(4))).toBeNull()
    expect(buildClozeSession([])).toBeNull()
  })

  it('words without a usable blank do not count towards the floor', () => {
    const words = [...pool(4), withExample('con vos', 'Voy con vos al mercado.', 'con vos'), withExample('ya', 'Ya es tarde.', 'ya')]
    expect(clozeEligibleCount(words)).toBe(4)
    expect(buildClozeSession(words)).toBeNull()
  })
})

describe('finishing: the streak and the metrics row, once, through the write queue', () => {
  const NOW = new Date(2026, 9, 5, 14, 0)
  const KEY = '2026-10-05'

  function app() {
    const fake = fakeSupabase()
    let settings = parseSettings({ streak_count: 3, streak_last_activity_date: '2026-10-04' })
    const getSettings = () => settings
    const queue = createSupabaseWriteQueue(fake.client, 'user-1', getSettings, { retryDelaysMs: [1, 1, 1], metricsRetryDelaysMs: [1], sleep: () => Promise.resolve() })
    const store = createLocalMetricsStore('u', { getItem: () => null, setItem: () => {}, removeItem: () => {} })
    const recorder = createMetricsRecorder({ store, enqueue: queue.enqueueMetrics, getSettings })
    const deps = { getSettings, applySettings: (p: Record<string, unknown>) => (settings = applySettingsPatch(settings, p)), queue, metrics: recorder }
    return {
      ...fake,
      queue,
      deps,
      getSettings,
      tables: () => fake.calls.map((c) => c.table),
      drained: () => vi.waitFor(() => expect(queue.getStatus()).toMatchObject({ unsaved: false, pendingMetrics: 0, metricsRunning: false })),
    }
  }

  it('recordPracticeCompleted: one streak write (when the day changes) and one active mark', () => {
    const markActiveToday = vi.fn()
    const enqueueSettings = vi.fn()
    let settings = parseSettings({ streak_count: 3, streak_last_activity_date: '2026-10-04' })
    const deps = { getSettings: () => settings, applySettings: (p: Record<string, unknown>) => (settings = applySettingsPatch(settings, p)), queue: { enqueueSettings }, metrics: { markActiveToday } }
    recordPracticeCompleted(deps, NOW)
    expect(enqueueSettings).toHaveBeenCalledTimes(1)
    expect(enqueueSettings).toHaveBeenCalledWith({ streak_count: 4, streak_last_activity_date: KEY })
    expect(settings.streakCount).toBe(4) // mirrored in memory too
    expect(markActiveToday).toHaveBeenCalledTimes(1)

    recordPracticeCompleted(deps, NOW) // a second group the same day: the streak does not move again
    expect(enqueueSettings).toHaveBeenCalledTimes(1)
    expect(markActiveToday).toHaveBeenCalledTimes(2)
  })

  it('a whole Matching group written through the real queue: nothing per tap, then the streak once and the metrics row once', async () => {
    const a = app()
    const items = ['a', 'b', 'c', 'd', 'e'].map((id): MatchItem => ({ id, spanish: id, gloss: id }))
    let s = startMatching({ items, left: items, right: [...items].reverse() })
    const done = vi.fn(() => recordPracticeCompleted(a.deps, NOW))

    // a wrong tap, then the five pairs
    s = clearWrong(tapAndFinish(tapAndFinish(s, 'left', 'a', done), 'right', 'b', done))
    for (const id of ['a', 'b', 'c', 'd']) s = tapAndFinish(tapAndFinish(s, 'left', id, done), 'right', id, done)
    await Promise.resolve()
    expect(a.calls).toHaveLength(0) // nothing written while playing
    expect(done).not.toHaveBeenCalled()

    s = tapAndFinish(tapAndFinish(s, 'left', 'e', done), 'right', 'e', done)
    await a.drained()
    expect(done).toHaveBeenCalledTimes(1)
    expect(a.tables().filter((t) => t === 'user_settings')).toHaveLength(1)
    expect(a.tables().filter((t) => t === 'user_daily_metrics')).toHaveLength(1)
    expect(a.tables()).not.toContain('user_progress') // SM-2 untouched
    expect(a.calls.find((c) => c.table === 'user_settings')!.rows).toMatchObject({ settings: { streak_count: 4, streak_last_activity_date: KEY } })
    expect(a.calls.find((c) => c.table === 'user_daily_metrics')!.rows).toMatchObject([{ date: KEY, active: true, reviews_done: 0 }])
    expect(a.tables().indexOf('user_settings')).toBeLessThan(a.tables().indexOf('user_daily_metrics')) // metrics go last
  })

  it('a whole Cloze session: ten answers, one finish', async () => {
    const a = app()
    const outcomes = ['correct', 'wrong', 'gaveUp', 'correct', 'correct', 'wrong', 'correct', 'correct', 'gaveUp', 'correct'] as const
    const onComplete = vi.fn(() => recordPracticeCompleted(a.deps, NOW))
    let progress = startCloze()
    for (const [i, outcome] of outcomes.entries()) {
      progress = answerCloze(progress, outcomes.length, outcome, onComplete)
      expect(progress.done).toBe(i === outcomes.length - 1)
      if (i < outcomes.length - 1) {
        expect(onComplete).not.toHaveBeenCalled()
        expect(a.calls).toHaveLength(0) // nothing is written per question
      }
    }
    await a.drained()
    expect(onComplete).toHaveBeenCalledTimes(1)
    expect(clozeScore(progress.results)).toBe(6)
    expect(a.tables().filter((t) => t === 'user_settings')).toHaveLength(1)
    expect(a.tables().filter((t) => t === 'user_daily_metrics')).toHaveLength(1)
    expect(a.tables()).not.toContain('user_progress')

    answerCloze(progress, outcomes.length, 'correct', onComplete) // a stray extra answer is ignored
    expect(onComplete).toHaveBeenCalledTimes(1)
  })

  it('a second group or session the same day marks the day active again but does not touch the streak', async () => {
    const a = app()
    recordPracticeCompleted(a.deps, NOW)
    await a.drained()
    const settingsWrites = a.tables().filter((t) => t === 'user_settings').length
    recordPracticeCompleted(a.deps, NOW)
    await a.drained()
    expect(a.tables().filter((t) => t === 'user_settings')).toHaveLength(settingsWrites)
  })
})

describe('practice does not touch SM-2 or the daily limit', () => {
  it('no practice function takes or returns progress or the new-word counter: the words are only read', () => {
    const words = learnedFirst(200)
    const frozen = JSON.stringify(words)
    buildMatchingGroup(words)
    buildClozeSession(words)
    matchingEligibleCount(words)
    clozeEligibleCount(words)
    expect(JSON.stringify(words)).toBe(frozen)
  })
})
