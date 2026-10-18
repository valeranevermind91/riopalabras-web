import { describe, expect, it } from 'vitest'
import { LOWER_SHARE } from './data/learnPick'
import { MAX_INTERVAL_DAYS, RELEARN_MINUTES } from './sm2/sm2'
import { en } from './strings'
import { ru } from './strings.ru'

/**
 * One name per thing, in each language, pinned. The user-facing words for a concept are chosen once (below) and a string that drifts back to
 * the old name, or a Russian string that slips into "ты" or a gendered "я", fails here.
 *   known       a word the person said they know: "I already know this word" → "marked as known" → the Known tab (never "hidden", never "hide")
 *   well learned the progress state that used to be called "Known well" (it clashed with Known)
 *   session     one run of Review, Matching or Cloze: "Session complete" / "New session" (never "group", never "done for now")
 *   batch       one go at Learn: "Finish batch" (Russian: подборка, never порция)
 */

/** Every string in a map, with the function ones called on a few sample arguments (the debug screen is a developer tool and is left out). */
function texts(node: unknown, path = ''): { path: string; text: string }[] {
  if (typeof node === 'string') return [{ path, text: node }]
  if (typeof node === 'function') {
    for (const args of [[3, 3], [3], ['casa', 'casa', 'es_word'], [['a', 'b']], [{ at: '', table: '', attempt: 1, kind: '', status: null, code: null, message: '', outcome: '' }]] as unknown[][]) {
      try {
        const out = (node as (...a: unknown[]) => unknown)(...args)
        if (typeof out === 'string') return [{ path, text: out }]
      } catch {
        // the next sample
      }
    }
    return []
  }
  if (Array.isArray(node)) return node.flatMap((item, i) => texts(item, `${path}[${i}]`))
  if (node !== null && typeof node === 'object') {
    return Object.entries(node)
      .filter(([key]) => key !== 'debug' && key !== 'wordContent' && key !== 'card')
      .flatMap(([key, value]) => texts(value, path ? `${path}.${key}` : key))
  }
  return []
}
const enTexts = texts(en)
const ruTexts = texts(ru)
const offenders = (list: { path: string; text: string }[], pattern: RegExp) => list.filter((t) => pattern.test(t.text)).map((t) => `${t.path}: ${t.text}`)

describe('the scan itself', () => {
  it('reads hundreds of strings in each language, functions included', () => {
    expect(enTexts.length).toBeGreaterThan(300)
    expect(ruTexts.length).toBeGreaterThan(300)
    expect(enTexts.some((t) => t.path === 'practice.sessionComplete')).toBe(true)
    expect(enTexts.some((t) => t.path === 'learn.markedKnown')).toBe(true)
  })

  it('would catch a stray word: the check is real', () => {
    expect(offenders([...enTexts, { path: 'x', text: 'Hidden words' }], /\bhid(den|e)?\b/i)).toEqual(['x: Hidden words'])
  })
})

describe('known, not hidden', () => {
  it('English: the tab, the state and the filters say "Known", and no string says hidden, hide or hid', () => {
    expect(en.words.segments.hidden).toBe('Known')
    expect(en.words.stateName.hidden).toBe('Known')
    expect(offenders(enTexts, /\bhid(den|e)?\b/i)).toEqual([])
  })

  it('Russian: the same, with «Известные» / «Известное», and no скрыт-', () => {
    expect(ru.words.segments.hidden).toBe('Известные')
    expect(ru.words.stateName.hidden).toBe('Известное')
    expect(offenders(ruTexts, /скры[тв]/i)).toEqual([])
  })

  it('the tab is the one the placement note and the empty list send people to', () => {
    expect(en.onboarding.placement.hidesNote).toContain(`the ${en.words.segments.hidden} tab`)
    expect(ru.onboarding.placement.hidesNote).toContain(`«${ru.words.segments.hidden}»`)
    expect(en.words.emptyHidden).toContain(en.learn.alreadyKnow) // it names the button that puts a word there
    expect(ru.words.emptyHidden).toContain(ru.learn.alreadyKnow)
  })

  it('"Known well" is "Well learned" (Хорошо выучено), so Known means one thing', () => {
    expect(en.words.states.established).toBe('Well learned')
    expect(en.words.stateName.established).toBe('Well learned')
    expect(ru.words.states.established).toBe('Хорошо выучено')
    expect(ru.words.stateName.established).toBe('Хорошо выучено')
    expect(offenders(enTexts, /known well/i)).toEqual([])
    expect(offenders(ruTexts, /знаю хорошо/i)).toEqual([])
  })
})

describe('one name for the end of a run of Matching, Cloze and Review', () => {
  it('"Session complete" in all three, and "New session" to go again, in both languages', () => {
    for (const [map, complete, again] of [[en, 'Session complete', 'New session'], [ru, 'Сессия завершена', 'Новая сессия']] as const) {
      expect(map.practice.sessionComplete).toBe(complete)
      expect(map.practice.groupComplete).toBe(complete)
      expect(map.review.sessionDone).toBe(complete)
      expect(map.practice.newSession).toBe(again)
      expect(map.practice.nextGroup).toBe(again)
    }
  })

  it('no string calls it a group (Matching) or "done for now" (Review)', () => {
    expect(offenders(enTexts, /\bgroup\b|done for now/i)).toEqual([])
    expect(offenders(ruTexts, /групп|пока всё/i)).toEqual([])
  })

  it('Learn is a batch (Russian: подборка), never a portion, and never "sessions of 10"', () => {
    expect(offenders(ruTexts, /порци/i)).toEqual([])
    expect(offenders(enTexts, /sessions of/i)).toEqual([])
    expect(ru.learn.finishBatch).toBe('Завершить подборку')
    expect(en.learn.finishBatch).toBe('Finish batch')
  })

  it('"Back to home" is one string everywhere in English, as «На главный экран» is in Russian', () => {
    for (const map of [en, ru]) expect(map.practice.backHome).toBe(map.common.backToHome)
    expect(en.common.backToHome).toBe('Back to home')
    expect(offenders(enTexts, /back home/i)).toEqual([])
  })
})

describe('spelling and address', () => {
  it('a bookmarked word is a "saved" word, in what a person reads: never "favourite" or "favorite" (the code and the table keep the old name), and no «избранное»', () => {
    expect(offenders(enTexts, /favou?rite/i)).toEqual([])
    expect(offenders(ruTexts, /избранн/i)).toEqual([])
    expect(en.home.degradedTables.user_favorites).toBe('saved words')
    expect(ru.home.degradedTables.user_favorites).toBe('сохранённые слова')
  })

  it('the save star promises nothing: Save / Saved, never a request to be taught the word', () => {
    expect([en.words.addFavourite, en.words.removeFavourite, en.words.favourites]).toEqual(['Save word', 'Remove from saved', 'Saved'])
    expect([ru.words.addFavourite, ru.words.removeFavourite, ru.words.favourites]).toEqual(['Сохранить слово', 'Убрать из сохранённых', 'Сохранённые'])
    for (const text of [en.words.favourite('x'), en.words.unfavourite('x'), en.words.addFavourite, en.words.removeFavourite]) expect(text).not.toMatch(/learn|queue|teach|study|practi[cs]e|favou?rite/i)
    for (const text of [ru.words.favourite('x'), ru.words.unfavourite('x'), ru.words.addFavourite, ru.words.removeFavourite]) expect(text).not.toMatch(/learn|очеред|учить|изуч|избранн/i)
  })

  it('the queue action on a row says it is for Learn and what it does: "Queue" / "Queued" (the filter\'s word), «В очередь» / «В очереди»', () => {
    expect([en.words.queueShort, en.words.queued]).toEqual(['Queue', 'Queued'])
    expect([ru.words.queueShort, ru.words.queued]).toEqual(['В очередь', 'В очереди'])
    expect(en.words.queueRow('x')).toBe('Queue x for Learn')
    expect(en.words.unqueueRow('x')).toBe('Take x out of the Learn queue')
    expect(ru.words.queueRow('x')).toBe('В очередь Learn: «x»')
    expect(ru.words.unqueueRow('x')).toBe('Убрать «x» из очереди Learn')
  })

  it('Russian: formal "вы" throughout: no ты-forms (ты, тебе, тебя, твой, видишь, хочешь…)', () => {
    expect(offenders(ruTexts, /(^|[^а-яё])(ты|тебе|тебя|тобой|твой|твоя|твоё|твои|твоих)(?![а-яё])/i)).toEqual([])
    expect(offenders(ruTexts, /(^|[^а-яё])[а-яё]{3,}(ешь|ёшь|ишь)(?![а-яё])/i)).toEqual([])
  })

  it('Russian: no gendered first person ("я … сделал/сделала", "сам/сама", but «сами» is the formal plural and fine)', () => {
    expect(offenders(ruTexts, /(^|[^а-яё])я\s+[а-яё]+(л|ла|ло|ли)(?![а-яё])/i)).toEqual([])
    expect(offenders(ruTexts, /(^|[^а-яё])сама?(?![а-яё])/i)).toEqual([]) // "сами" is the formal plural and fine: «Введите перевод сами»
    expect(ru.words.form.fillMyself).toBe('Ввести вручную')
  })
})

describe('what the text says about the scheduler is what the scheduler does', () => {
  it('"How it works": the longest gap is nine months and Again is ten minutes (the numbers the code has), and it does not say Again starts over', () => {
    expect(MAX_INTERVAL_DAYS).toBe(270) // nine months of 30 days
    expect(RELEARN_MINUTES).toBe(10)
    const spaced = (map: { howItWorks: { sections: readonly { id: string; text: string }[] } }) => map.howItWorks.sections.find((s) => s.id === 'spaced')!.text
    expect(spaced(en)).toContain('nine months')
    expect(spaced(en)).toContain('ten minutes')
    expect(spaced(en)).not.toMatch(/each one longer than the last|starts the word over/i)
    expect(spaced(ru)).toContain('девяти месяцев')
    expect(spaced(ru)).toContain('десять минут')
    expect(spaced(ru)).not.toMatch(/каждый длиннее предыдущего|начинает слово заново/i)
  })
})

describe('what a disabled tile and an empty state tell the person to do', () => {
  it('the practice tiles give their reason as a status, like the tiles beside them ("Nothing to review", "More tomorrow"), not as an order', () => {
    expect(en.practice.needWords).toBe('At least 5 words')
    expect(ru.practice.needWords).toBe('Не менее 5 слов')
  })

  it('"All caught up" is one phrase on Home and at the end of Review, in both languages (the old "All clear" / «Всё чисто» said nothing)', () => {
    expect(en.home.advice.allClear).toBe(en.review.allCaughtUp.replace(/!$/, ''))
    expect(ru.home.advice.allClear).toBe(ru.review.allCaughtUp)
  })

  it('the Known tab\'s empty text does not say "known" twice: its second sentence names the actual buttons, Learn\'s and the placement test\'s', () => {
    for (const [text, button, test, word] of [
      [en.words.emptyHidden, en.learn.alreadyKnow, 'placement test', /known/gi],
      [ru.words.emptyHidden, ru.learn.alreadyKnow, 'входном тесте', /известн/gi],
    ] as const) {
      expect(text).toContain(button)
      expect(text).toContain(test)
      expect(text.match(word)).toHaveLength(1) // the first sentence says it; the second does not repeat it
    }
  })

  it('the search placeholder in Russian is «Поиск слова»: a field for a word, not a count of languages', () => {
    expect(ru.words.searchPlaceholder).toBe('Поиск слова')
  })

  it('the queue place reads «В очереди: N-е место.» (English: "Queued — 3rd in line.")', () => {
    expect(ru.words.queuedAt(3)).toBe('В очереди: 3-е место.')
    expect(en.words.queuedAt(3)).toBe('Queued — 3rd in line.')
  })

  it('the Learn tile says more comes tomorrow, and says so differently for a goal of 0', () => {
    expect(en.home.learnCapReached).toBe('More tomorrow')
    expect(ru.home.learnCapReached).toBe('Новые слова завтра')
    expect(en.home.learnGoalOff).not.toBe(en.home.learnCapReached)
    expect(ru.home.learnGoalOff).not.toBe(ru.home.learnCapReached)
  })

  it('an empty list names the way out: Learn, or clearing the search and filters', () => {
    expect(en.words.emptyLearned).toContain('Learn')
    expect(ru.words.emptyLearned).toContain('Learn')
    expect(en.words.emptyFiltered).toContain('clear the filters')
    expect(ru.words.emptyFiltered).toContain('сбросьте фильтры')
    expect(en.words.clearSearchAndFilters).toBe('Clear search and filters')
    expect(ru.words.clearSearchAndFilters).toBe('Сбросить поиск и фильтры')
  })

  it('a translation failure shows no status code and no "try again" the form has no button for', () => {
    for (const map of [en, ru]) {
      for (const text of [map.words.enrich.timeout, map.words.enrich.network, map.words.enrich.other(500)]) expect(text).not.toMatch(/\d/)
    }
    expect(offenders(enTexts.filter((t) => /enrich\.(timeout|network|other)/.test(t.path)), /try again/i)).toEqual([])
  })

  it('the region choice that means both countries says so, and the hint names it', () => {
    expect(en.words.form.regionBoth).toBe('Both countries or unknown')
    expect(ru.words.form.regionBoth).toBe('Обе страны или неизвестно')
    expect(en.words.form.regionHint).toContain(en.words.form.regionBoth)
    expect(ru.words.form.regionHint).toContain(ru.words.form.regionBoth)
  })

  it('the Cloze screen has an instruction line in both languages, one sentence', () => {
    for (const hint of [en.practice.clozeHint, ru.practice.clozeHint]) {
      expect(hint.length).toBeGreaterThan(10)
      expect(hint.match(/[.!?](\s|$)/g)).toHaveLength(1)
    }
  })

  it('the search placeholder is short enough for 320px (the width itself is checked in the browser)', () => {
    expect(en.words.searchPlaceholder.length).toBeLessThanOrEqual(34)
    expect(ru.words.searchPlaceholder.length).toBeLessThanOrEqual(30)
  })
})

describe('what the placement test says about itself', () => {
  it('before the first set: it is only so the app can work out where to start you (one sentence, in both languages, no score and no number)', () => {
    expect(en.onboarding.placement.purpose).toBe('This test is only here so the app can work out where to start you.')
    expect(ru.onboarding.placement.purpose).toBe('Этот тест нужен только для того, чтобы приложение поняло, с каких слов начать обучение.')
    for (const text of [en.onboarding.placement.purpose, ru.onboarding.placement.purpose]) {
      expect(text.match(/[.!?](\s|$)/g)).toHaveLength(1)
      expect(text).not.toMatch(/\d|score|wrong|correct|балл|правильно|неправильно/i)
    }
  })

  it('in the result: the starting point is approximate and corrects itself, because Learn keeps mixing in easier words', () => {
    const en_ = en.onboarding.placement.resultApprox
    const ru_ = ru.onboarding.placement.resultApprox
    for (const phrase of ['approximate', 'corrects itself', 'easier words', 'within a few days']) expect(en_).toContain(phrase)
    for (const phrase of ['приблизительная', 'со временем уточняется', 'более лёгкие слова', 'за несколько дней']) expect(ru_).toContain(phrase)
    expect(en_).not.toMatch(/\d|score/i)
  })

  it('and that is true: Learn draws a share of every batch from below the start (about a third), which the sentence relies on', () => {
    expect(LOWER_SHARE).toBeGreaterThan(0.2)
    expect(LOWER_SHARE).toBeLessThan(0.4)
  })
})
