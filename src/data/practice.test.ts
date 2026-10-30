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
  firstMatchGloss,
  glossKey,
  isMatchingComplete,
  isPracticeWord,
  matchingEligibleCount,
  matchingPool,
  recordPracticeCards,
  recordPracticeCompleted,
  splitSentence,
  startCloze,
  startMatching,
  tapAndFinish,
  tapTile,
  type MatchGroup,
  type MatchItem,
  type MatchingState,
  clozeVerbForms,
} from './practice'
import { applySettingsPatch } from './mutations'
import { parseFallbackExamples, parseRioOverlay } from './rio'
import { parseSettings } from './settings'
import type { Word } from './types'
import { createSupabaseWriteQueue } from './writeQueue'
import { en, strings } from '../strings'
import { ru } from '../strings.ru'
import { clozeFeedback } from './clozeFeedback'
import { verbForms } from './verbForms'
import { RU_ONLY } from '../testing/translationFlags'

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
    for (const m of matchingPool(everyone, RU_ONLY)) expect(['letter', 'interj']).not.toContain(pos.get(m.id))
    for (const item of everyonePool) expect(['letter', 'interj']).not.toContain(item.word.pos)
  })
})

describe('Matching: first gloss and collisions', () => {
  it('uses the first gloss, without the parenthetical', () => {
    expect(firstMatchGloss(learned('a', { ruTranslation: 'эмпанада (вид запечённого пирожка), пирожок' }), RU_ONLY)).toBe('эмпанада')
    expect(firstMatchGloss(learned('a', { ruTranslation: 'стол, табличка' }), RU_ONLY)).toBe('стол')
    expect(firstMatchGloss(learned('a', { ruTranslation: 'быть; находиться' }), RU_ONLY)).toBe('быть')
    expect(firstMatchGloss(learned('a', { ruTranslation: '(устар.) дом' }), RU_ONLY)).toBe('(устар.) дом') // never an empty tile
  })

  it('follows the card: an overlay translation replaces the dictionary one when the Rioplatense headword leads', () => {
    const w = byWord(everyone, 'vagabundo')
    expect(w.rio?.translation?.ru).toBe('бездомный, бродяга')
    expect(firstMatchGloss(w, RU_ONLY)).toBe('бездомный')
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
      const group = buildMatchingGroup(words, RU_ONLY)!
      const keys = group.items.map((m) => glossKey(m.gloss))
      expect(new Set(keys).size).toBe(MATCH_GROUP_SIZE)
      expect(group.items.filter((m) => m.id === 'uno' || m.id === 'dos').length).toBeLessThanOrEqual(1)
    }
  })

  it('counts colliding words once: eligibility is about words a group can really use', () => {
    const collide = ['uno', 'dos', 'tres', 'cuatro', 'cinco'].map((w) => learned(w, { ruTranslation: 'одно и то же' }))
    expect(matchingEligibleCount(collide, RU_ONLY)).toBe(1)
    expect(buildMatchingGroup(collide, RU_ONLY)).toBeNull()
    const four = ['a', 'b', 'c', 'd'].map((w, i) => learned(w, { ruTranslation: `слово${'абвг'[i]}` }))
    expect(matchingEligibleCount([...four, learned('e', { ruTranslation: 'слово а' }), learned('f', { ruTranslation: 'слово б' })], RU_ONLY)).toBeGreaterThanOrEqual(4)
  })

  it('on the real dictionary: groups are 5 distinct non-colliding pairs, with both columns holding the same words', () => {
    const words = learnedFirst(800)
    for (let i = 0; i < 200; i++) {
      const g = buildMatchingGroup(words, RU_ONLY)!
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
      for (const m of buildMatchingGroup(words, RU_ONLY)!.items) {
        if (seen.has(m.id)) overlapped = true
        seen.add(m.id)
      }
    }
    expect(seen.size).toBeGreaterThan(MATCH_GROUP_SIZE)
    expect(overlapped).toBe(true)
  })

  it('the Spanish column shows the headword by the Learn / Review rule', () => {
    const words = everyone
    const item = matchingPool(words, RU_ONLY).find((m) => m.id === 'cigarrillo')!
    expect(item.spanish).toBe('pucho')
  })

  it('needs 5 usable words: 4 give no group, 5 do', () => {
    const mk = (n: number) => Array.from({ length: n }, (_, i) => learned(`w${i}`, { ruTranslation: `слово ${'абвгде'[i]}` }))
    expect(buildMatchingGroup(mk(4), RU_ONLY)).toBeNull()
    expect(buildMatchingGroup(mk(5), RU_ONLY)).not.toBeNull()
    expect(matchingEligibleCount(mk(4), RU_ONLY)).toBeLessThan(PRACTICE_MIN_WORDS)
    expect(matchingEligibleCount(mk(5), RU_ONLY)).toBe(5)
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
    expect(strings.wordContent.en.inSentence('tenés')).toBe('In this sentence: tenés')
    expect(strings.wordContent.ru.inSentence('tenés')).toBe('В этом предложении: tenés')
    expect(checkClozeAnswer({ typed: 'TENER ', target: 'tenés', headword: 'tener' }).kind).toBe('headword')
    expect(checkClozeAnswer({ typed: 'tenés', target: 'tenés', headword: 'tener' }).kind).toBe('exact') // the sentence form still wins
    expect(checkClozeAnswer({ typed: 'tenes', target: 'tenés', headword: 'tener' }).kind).toBe('accent')
  })

  it('a headword typed without its accent is still the headword', () => {
    expect(checkClozeAnswer({ typed: 'oir', target: 'oís', headword: 'oír' })).toEqual({ outcome: 'correct', kind: 'headword' })
  })

  describe('another form of the card\'s verb', () => {
    const answer = (typed: string, target: string, headword: string) => checkClozeAnswer({ typed, target, headword, forms: verbForms(headword) })

    it('is correct, with kind "form": tienes for tenés, voy for vas, ven for vení', () => {
      expect(answer('tienes', 'tenés', 'tener')).toEqual({ outcome: 'correct', kind: 'form' })
      expect(answer('voy', 'vas', 'ir')).toEqual({ outcome: 'correct', kind: 'form' })
      expect(answer('ven', 'vení', 'venir')).toEqual({ outcome: 'correct', kind: 'form' })
      expect(answer('  Tuvimos ', 'tenés', 'tener')).toEqual({ outcome: 'correct', kind: 'form' })
      expect(answer('pienso', 'pensás', 'pensar').kind).toBe('form')
      expect(answer('hablábamos', 'habla', 'hablar').kind).toBe('form')
    })

    it('the sentence form, its accent-less spelling and the headword still come first, and are told apart from it', () => {
      expect(answer('tenés', 'tenés', 'tener').kind).toBe('exact')
      expect(answer('tenes', 'tenés', 'tener').kind).toBe('accent')
      expect(answer('tener', 'tenés', 'tener').kind).toBe('headword')
      expect(answer('Tener', 'tenés', 'tener').kind).toBe('headword')
      expect(answer('tienes', 'tienes', 'tener').kind).toBe('exact') // tú in the sentence: the person typed what is there
    })

    it('an accent missing from the typed form is not held against it', () => {
      expect(answer('estas', 'esté', 'estar').kind).toBe('form') // estás
      expect(answer('vivi', 'vivís', 'vivir').kind).toBe('form')
    })

    it('another word is wrong, however much it looks like the verb', () => {
      for (const [typed, target, head] of [['tenerlo', 'tenés', 'tener'], ['teno', 'tenés', 'tener'], ['tenerse', 'tenés', 'tener'], ['pensión', 'pensás', 'pensar'], ['hablador', 'habla', 'hablar'], ['cantante', 'canta', 'cantar'], ['comes', 'tenés', 'tener']] as const) {
        expect(answer(typed, target, head), typed).toEqual({ outcome: 'wrong', kind: 'wrong' })
      }
    })

    it('ñ is not folded here either', () => {
      expect(answer('enseno', 'enseñás', 'enseñar').kind).toBe('wrong')
      expect(answer('enseño', 'enseñás', 'enseñar').kind).toBe('form')
    })

    it('a verb we cannot vouch for takes nothing but what it took before, and so does a word with no forms', () => {
      expect(answer('salgo', 'salís', 'salir')).toEqual({ outcome: 'wrong', kind: 'wrong' }) // no table yet
      expect(answer('salir', 'salís', 'salir').kind).toBe('headword')
      expect(answer('casas', 'casa', 'casa')).toEqual({ outcome: 'wrong', kind: 'wrong' })
      expect(checkClozeAnswer({ typed: 'tienes', target: 'tenés', headword: 'tener' })).toEqual({ outcome: 'wrong', kind: 'wrong' }) // no forms given
      expect(checkClozeAnswer({ typed: 'tienes', target: 'tenés', headword: 'tener', forms: null }).kind).toBe('wrong')
    })

    it('which words are checked this way: a dictionary verb, not a word the user added and not another part of speech', () => {
      const verb = makeWord('tener', { pos: 'v' })
      expect(clozeVerbForms(verb, 'tener')).toBe(verbForms('tener'))
      expect(clozeVerbForms({ ...verb, isCustom: true }, 'tener')).toBeNull()
      expect(clozeVerbForms({ ...verb, pos: 'n' }, 'tener')).toBeNull()
      expect(clozeVerbForms(makeWord('oír', { pos: 'v' }), 'oír')).toBeNull()
      expect(clozeVerbForms(makeWord('sentarse', { pos: 'v' }), 'sentarse')).toBe(verbForms('sentar'))
    })
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

  it('the feedback wording is English chrome in both languages; only the "in this sentence" nudge follows the translation setting', () => {
    for (const lang of ['en', 'ru'] as const) {
      expect(clozeFeedback('exact', 'tenés', lang)).toEqual({ text: 'Correct!', tone: 'ok' })
      expect(clozeFeedback('accent', 'está', lang).text).toBe('Correct! Mind the accent: está')
      expect(clozeFeedback('wrong', 'tenés', lang)).toEqual({ text: 'Not quite — the word was: tenés', tone: 'bad' })
      expect(clozeFeedback('gaveUp', 'tenés', lang)).toEqual({ text: 'The word was: tenés', tone: 'neutral' })
    }
    expect(clozeFeedback('headword', 'tenés', 'en').text).toBe('Correct! In this sentence: tenés')
    expect(clozeFeedback('headword', 'tenés', 'ru').text).toBe('Correct! В этом предложении: tenés')
    // another form of the verb shows the sentence's form in place, in the same words: no label for the person or the tense
    expect(clozeFeedback('form', 'tenés', 'en')).toEqual({ text: 'Correct! In this sentence: tenés', tone: 'ok' })
    expect(clozeFeedback('form', 'tenés', 'ru')).toEqual({ text: 'Correct! В этом предложении: tenés', tone: 'ok' })
  })

  it('the second part of a feedback line starts with a capital, in every interface language and every nudge language', () => {
    for (const t of [en.practice, ru.practice]) {
      for (const lang of ['en', 'ru'] as const) {
        for (const second of [t.accentNudge('está'), strings.wordContent[lang].inSentence('está')]) {
          expect(`${t.correct} ${second}`).toMatch(/^\S+! \p{Lu}/u)
        }
      }
    }
  })

  it('the chrome strings exist in both interface languages and take the word', () => {
    for (const t of [en.practice, ru.practice]) {
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

describe('finishing: each pair and each answer is a card toward the streak; the metrics row is marked once per group or session', () => {
  const NOW = new Date(2026, 9, 5, 14, 0)
  const KEY = '2026-10-05'

  function app() {
    const fake = fakeSupabase()
    let settings = parseSettings({ daily_new_word_limit: 10, streak_count: 3, streak_last_activity_date: '2026-10-04' })
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
      settingsBlobs: () => fake.calls.filter((c) => c.table === 'user_settings').map((c) => (c.rows as { settings: Record<string, unknown> }).settings),
      drained: () => vi.waitFor(() => expect(queue.getStatus()).toMatchObject({ unsaved: false, pendingMetrics: 0, metricsRunning: false })),
    }
  }

  /** What the Matching screen does with a tap: a pair that is matched is a card, a finished group marks the day active. */
  function matchingScreen(deps: ReturnType<typeof app>['deps']) {
    return (state: MatchingState, side: 'left' | 'right', id: string) => {
      const next = tapAndFinish(state, side, id, () => recordPracticeCompleted(deps, NOW))
      if (next.matched.size > state.matched.size) recordPracticeCards(deps, next.matched.size - state.matched.size, NOW)
      return next
    }
  }
  const group = (ids: string[]) => ids.map((id): MatchItem => ({ id, spanish: id, gloss: id }))

  it('recordPracticeCompleted marks the day active and writes NO streak: finishing a group is not what counts the day, the cards in it are', () => {
    const markActiveToday = vi.fn()
    const enqueueSettings = vi.fn()
    let settings = parseSettings({ daily_new_word_limit: 10, streak_count: 3, streak_last_activity_date: '2026-10-04' })
    const deps = { getSettings: () => settings, applySettings: (p: Record<string, unknown>) => (settings = applySettingsPatch(settings, p)), queue: { enqueueSettings }, metrics: { markActiveToday } }
    recordPracticeCompleted(deps, NOW)
    recordPracticeCompleted(deps, NOW)
    expect(markActiveToday).toHaveBeenCalledTimes(2)
    expect(enqueueSettings).not.toHaveBeenCalled()
    expect(settings.streakCount).toBe(3)
  })

  it('recordPracticeCards: a card is counted (a settings write), and the streak is written the moment the 10th is done', () => {
    const enqueueSettings = vi.fn()
    let settings = parseSettings({ daily_new_word_limit: 10, streak_count: 3, streak_last_activity_date: '2026-10-04' })
    const deps = { getSettings: () => settings, applySettings: (p: Record<string, unknown>) => (settings = applySettingsPatch(settings, p)), queue: { enqueueSettings }, metrics: null }
    for (let i = 0; i < 9; i++) recordPracticeCards(deps, 1, NOW)
    expect(enqueueSettings).toHaveBeenCalledTimes(9)
    expect(enqueueSettings.mock.calls.some(([p]) => 'streak_count' in p)).toBe(false)
    expect(settings.cardsDoneTodayCount).toBe(9)
    recordPracticeCards(deps, 1, NOW)
    expect(enqueueSettings).toHaveBeenLastCalledWith({ cards_done_today_count: 10, cards_done_today_date: KEY, streak_count: 4, streak_last_activity_date: KEY })
    recordPracticeCards(deps, 1, NOW) // the day has counted: nothing more is written
    expect(enqueueSettings).toHaveBeenCalledTimes(10)
  })

  it('a whole Matching group through the real queue: five pairs are five cards, the metrics row once at the end, and no streak yet; a second group counts the day', async () => {
    const a = app()
    const tap = matchingScreen(a.deps)
    const play = (ids: string[]) => {
      const items = group(ids)
      let s = startMatching({ items, left: items, right: [...items].reverse() })
      s = clearWrong(tap(tap(s, 'left', ids[0]), 'right', ids[1])) // a wrong tap is not a card
      for (const id of ids) s = tap(tap(s, 'left', id), 'right', id)
      return s
    }
    play(['a', 'b', 'c', 'd', 'e'])
    await a.drained()
    expect(a.getSettings().cardsDoneTodayCount).toBe(5)
    expect(a.getSettings().streakCount).toBe(3) // five cards do not count the day
    expect(a.settingsBlobs().some((b) => 'streak_count' in b && b.streak_count !== 3)).toBe(false)
    expect(a.tables().filter((t) => t === 'user_daily_metrics')).toHaveLength(1) // once for the group
    expect(a.tables()).not.toContain('user_progress') // SM-2 untouched

    play(['f', 'g', 'h', 'i', 'j'])
    await a.drained()
    expect(a.getSettings()).toMatchObject({ cardsDoneTodayCount: 10, streakCount: 4, streakLastActivityDate: KEY })
    expect(a.settingsBlobs().at(-1)).toMatchObject({ streak_count: 4, streak_last_activity_date: KEY, cards_done_today_count: 10 })
  })

  it('a Cloze session: an answered question is a card (right or wrong), giving up is not; ten answers with two given up are eight cards', async () => {
    const a = app()
    const outcomes = ['correct', 'wrong', 'gaveUp', 'correct', 'correct', 'wrong', 'correct', 'correct', 'gaveUp', 'correct'] as const
    const onComplete = vi.fn(() => recordPracticeCompleted(a.deps, NOW))
    let progress = startCloze()
    for (const outcome of outcomes) {
      recordPracticeCards(a.deps, outcome === 'gaveUp' ? 0 : 1, NOW) // what the Cloze screen does before it records the answer
      progress = answerCloze(progress, outcomes.length, outcome, onComplete)
    }
    await a.drained()
    expect(onComplete).toHaveBeenCalledTimes(1)
    expect(clozeScore(progress.results)).toBe(6)
    expect(a.getSettings().cardsDoneTodayCount).toBe(8)
    expect(a.getSettings().streakCount).toBe(3) // eight cards: not yet
    expect(a.tables().filter((t) => t === 'user_daily_metrics')).toHaveLength(1)
    expect(a.tables()).not.toContain('user_progress')

    // two more answered questions (the next session) make ten
    recordPracticeCards(a.deps, 1, NOW)
    recordPracticeCards(a.deps, 1, NOW)
    await a.drained()
    expect(a.getSettings()).toMatchObject({ cardsDoneTodayCount: 10, streakCount: 4, streakLastActivityDate: KEY })
  })

  it('once the day has counted, further pairs and answers write nothing to the settings', async () => {
    const a = app()
    for (let i = 0; i < 10; i++) recordPracticeCards(a.deps, 1, NOW)
    await a.drained()
    const writes = a.tables().filter((t) => t === 'user_settings').length
    for (let i = 0; i < 20; i++) recordPracticeCards(a.deps, 1, NOW)
    recordPracticeCompleted(a.deps, NOW)
    await a.drained()
    expect(a.tables().filter((t) => t === 'user_settings')).toHaveLength(writes)
  })
})

describe('practice does not touch SM-2 or the daily limit', () => {
  it('no practice function takes or returns progress or the new-word counter: the words are only read', () => {
    const words = learnedFirst(200)
    const frozen = JSON.stringify(words)
    buildMatchingGroup(words, RU_ONLY)
    buildClozeSession(words)
    matchingEligibleCount(words, RU_ONLY)
    clozeEligibleCount(words)
    expect(JSON.stringify(words)).toBe(frozen)
  })
})
