import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { LOWER_SHARE } from './data/learnPick'
import { MAX_INTERVAL_DAYS, RELEARN_MINUTES, formatInterval, learnedState, previewInterval } from './sm2/sm2'
import { learnProgressUpdates } from './data/learn'
import { REVIEW_SESSION_SIZE, buildReviewSession } from './data/review'
import { STARRED_SHARE, starredSlots } from './data/starred'
import { makeWord } from './testing/makeWord'
import { en } from './strings'
import { ru } from './strings.ru'

/**
 * One name per thing, in each language, pinned. The user-facing words for a concept are chosen once (below) and a string that drifts back to
 * the old name, or a Russian string that slips into "ты" or a gendered "я", fails here.
 *   known       a word the person said they know: "I already know this word" → "marked as known" → the Known tab (never "hidden", never "hide")
 *   well learned the progress state that used to be called "Known well" (it clashed with Known)
 *   session     one run of Review, Matching or Cloze: "Session complete" / "New session" (never "group", never "done for now")
 *   batch       one go at Learn: "Finish batch" (Russian: подборка, never порция)
 *   learn sooner the star on a word: "Learn sooner" (Russian: «Учить раньше»), on the row, the detail, the filter and every notice; never saved, favourite or queued
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
/** The strings of one group (functions called on sample arguments), as plain text. */
const textsIn = (node: unknown) => texts(node).map((t) => t.text)
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
    expect(en.words.kindName.hidden).toBe('Known')
    expect(offenders(enTexts, /\bhid(den|e)?\b/i)).toEqual([])
  })

  it('Russian: the same, with «Известные» / «Известное», and no скрыт-', () => {
    expect(ru.words.segments.hidden).toBe('Известные')
    expect(ru.words.kindName.hidden).toBe('Известное')
    expect(offenders(ruTexts, /скры[тв]/i)).toEqual([])
  })

  it('the tab is the one the placement note and the empty list send people to', () => {
    expect(en.onboarding.placement.hidesNote).toContain(`the ${en.words.segments.hidden} tab`)
    expect(ru.onboarding.placement.hidesNote).toContain(`«${ru.words.segments.hidden}»`)
    expect(en.words.emptyHidden).toContain(en.learn.alreadyKnow) // it names the button that puts a word there
    expect(ru.words.emptyHidden).toContain(ru.learn.alreadyKnow)
  })

  it('"Known well" is "Well learned" (Усвоенные), so Known means one thing', () => {
    expect(en.words.stages.wellLearned).toBe('Well learned')
    expect(en.words.kindName.wellLearned).toBe('Well learned')
    expect(ru.words.stages.wellLearned).toBe('Усвоенные')
    expect(ru.words.kindName.wellLearned).toBe('Усвоено')
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
  it('the star is "Learn sooner" / «Учить раньше» in every place it appears: the filter, the detail button, the row, the notice after adding a word, the load notice', () => {
    expect([en.words.favourites, en.words.learnSooner]).toEqual(['Learn sooner', 'Learn sooner']) // the filter chip and the detail button: the same words
    expect([ru.words.favourites, ru.words.learnSooner]).toEqual(['Учить раньше', 'Учить раньше'])
    expect(en.words.learnSoonerRow('x')).toBe('Learn x sooner') // the row's icon has this as its name, pressed or not
    expect(ru.words.learnSoonerRow('x')).toBe('Учить «x» раньше')
    expect(en.words.added).toBe('Added, and set to learn sooner.')
    expect(ru.words.added).toBe('Слово добавлено и отмечено «Учить раньше».')
    expect(en.home.degradedTables.user_favorites).toBe('words set to learn sooner')
    expect(ru.home.degradedTables.user_favorites).toBe('слова «Учить раньше»')
  })

  it('one idea, one word: the star never reads as a bookmark, a favourite, a save or a queue, in either language', () => {
    expect(offenders(enTexts, /favou?rite|bookmark|queue|saved word|save word|\bsaved\b$/i)).toEqual([])
    expect(offenders(ruTexts, /избранн|закладк|очеред|сохранённые|сохранённых слов|сохранить слово/i)).toEqual([])
    for (const map of [en, ru]) for (const gone of ['queued', 'queueForLearn', 'queueRow', 'unqueueRow', 'removeFromQueue', 'queuedAt', 'queueFull', 'beyondToday', 'addedNotQueued', 'favourite', 'unfavourite', 'addFavourite', 'removeFavourite', 'queueShort']) expect(gone in map.words, gone).toBe(false)
  })

  it('the pressed star promises nothing that has not happened: no "Learning sooner", no «Учу раньше», no "queued", no "added"', () => {
    for (const text of [en.words.learnSooner, en.words.learnSoonerRow('x'), en.words.favourites]) expect(text).not.toMatch(/learning|queued|added|scheduled|will/i)
    for (const text of [ru.words.learnSooner, ru.words.learnSoonerRow('x'), ru.words.favourites]) expect(text).not.toMatch(/учу |добавлен|запланирован|будет/i)
  })

  it('the short labels on a card carry no full stop, and the meaning-shift line is one of them: pill, standard meaning, usage hints, note label', () => {
    for (const map of [en, ru]) {
      const labels = [map.rio.pill, map.rio.standardMeaning, map.rio.meaningShift, map.rio.note, map.rio.standard, map.rio.also, ...Object.values(map.rio.stdUsageHint).filter((x): x is string => typeof x === 'string')]
      for (const label of labels) expect(label, label).not.toMatch(/[.!?]$/)
    }
  })

  it('the meaning-shift line says it in the words you asked for: "A different meaning in this region" / «В этом регионе другое значение»', () => {
    expect(en.rio.meaningShift).toBe('A different meaning in this region')
    expect(ru.rio.meaningShift).toBe('В этом регионе другое значение')
  })

  it('Russian: formal "вы" throughout: no ты-forms (ты, тебе, тебя, твой, видишь, хочешь…)', () => {
    expect(offenders(ruTexts, /(^|[^а-яё])(ты|тебе|тебя|тобой|твой|твоя|твоё|твои|твоих)(?![а-яё])/i)).toEqual([])
    expect(offenders(ruTexts, /(^|[^а-яё])[а-яё]{3,}(ешь|ёшь|ишь)(?![а-яё])/i)).toEqual([])
  })

  // The rule is for the app's own voice, which is always "we" and never a gendered "I". ONE sentence is the exception: the About screen's first block is the author
  // speaking in his own name, and that name is on the same screen (about.author.name). The exception is that exact sentence at that exact path: the rest of that
  // string, and every other string in the interface, is still held to the rule, and the tests below fail if the sentence moves, changes, or is joined by another.
  const AUTHOR_VOICE = { path: 'about.what.text', sentence: 'Мне самому не хватало лексики — поэтому я сделал это приложение.' }
  const GENDERED_I = /(^|[^а-яё])я\s+[а-яё]+(л|ла|ло|ли)(?![а-яё])/i
  const SAM = /(^|[^а-яё])сама?(?![а-яё])/i // "сами" is the formal plural and fine: «Введите перевод сами»
  /** The Russian strings with the author's one sentence taken out of the one place it is allowed. */
  const withoutAuthorVoice = (list: { path: string; text: string }[]) => list.map((t) => (t.path === AUTHOR_VOICE.path ? { ...t, text: t.text.replace(AUTHOR_VOICE.sentence, '') } : t))

  it('Russian: no gendered first person ("я … сделал/сделала", "сам/сама", but «сами» is the formal plural and fine), except the author\'s one sentence in About', () => {
    expect(offenders(withoutAuthorVoice(ruTexts), GENDERED_I)).toEqual([])
    expect(offenders(withoutAuthorVoice(ruTexts), SAM)).toEqual([])
    expect(ru.words.form.fillMyself).toBe('Ввести вручную')
  })

  it('the author\'s sentence is the ONLY thing the exception lets through: without it the rule names that one string and no other', () => {
    expect(offenders(ruTexts, GENDERED_I)).toEqual([`${AUTHOR_VOICE.path}: ${ru.about.what.text}`])
    expect(ruTexts.find((t) => t.path === AUTHOR_VOICE.path)!.text).toContain(AUTHOR_VOICE.sentence) // a stale exception (the sentence reworded or gone) fails here, and is removed
    expect(ruTexts.filter((t) => t.text.includes(AUTHOR_VOICE.sentence)).map((t) => t.path)).toEqual([AUTHOR_VOICE.path]) // and it is not used anywhere else
  })

  it('the exception does not travel: the same words at another path, or another gendered sentence beside it in the same string, are caught', () => {
    const elsewhere = [{ path: 'settings.aboutText', text: AUTHOR_VOICE.sentence }]
    expect(offenders(withoutAuthorVoice(elsewhere), GENDERED_I)).toHaveLength(1)
    const beside = [{ path: AUTHOR_VOICE.path, text: `${AUTHOR_VOICE.sentence} Я сделал ещё одно приложение.` }]
    expect(offenders(withoutAuthorVoice(beside), GENDERED_I)).toHaveLength(1)
    const reworded = [{ path: AUTHOR_VOICE.path, text: 'Мне самому не хватало лексики — поэтому я сделала это приложение.' }]
    expect(offenders(withoutAuthorVoice(reworded), GENDERED_I)).toHaveLength(1)
  })

  it('the speaker is named on the screen: the author block carries his name, in both languages', () => {
    expect([en.about.author.name, ru.about.author.name]).toEqual(['Valeriy Kriukov', 'Валерий Крюков'])
    expect(readFileSync('src/screens/About.tsx', 'utf8')).toContain('{t.author.name}')
  })
})

describe('the Russian interface does not say «риоплатск-»', () => {
  // The adjective is awkward in Russian, so the text goes round it («местное»). It is gone from every paragraph of the intro and of "How it works" for good.
  // SEVEN strings elsewhere still use it (the pill and the relation label on a card; the word form's check, hints and form line; the duplicate message); they are named here, so a seventh cannot appear, and the day
  // one is reworded this test fails until it is taken off the list. Dictionary content (a word's own translation) is data, not interface.
  const REMAINING = ['duplicate', 'pill', 'regionHint', 'rioplatense', 'rioplatenseCheck', 'rioplatenseForm', 'standardHint']

  it('not in the intro or in "How it works"', () => {
    for (const text of textsIn(ru.howItWorks).concat(textsIn(ru.onboarding))) expect(text, text).not.toMatch(/риоплатск/i)
  })

  it('and in the rest of the Russian strings only in the seven named ones', () => {
    const lines = readFileSync('src/strings.ru.ts', 'utf8').split('\n')
    const keys = new Set<string>()
    lines.forEach((line, i) => {
      if (line.trim().startsWith('//') || !/риоплатск/i.test(line)) return
      for (let j = i; j >= 0; j--) {
        const key = lines[j].match(/^\s{2,}(\w+):/)
        if (key) {
          keys.add(key[1])
          return
        }
      }
    })
    expect([...keys].sort()).toEqual(REMAINING)
  })
})

describe('the interval on the Again button', () => {
  it('says "Soon" / «Скоро»: the word is due again, and no clock is promised (the stored wait is untouched)', () => {
    expect([en.interval.soon, ru.interval.soon]).toEqual(['Soon', 'Скоро'])
    for (const map of [en, ru]) expect('minutes' in map.interval).toBe(false)
    expect(RELEARN_MINUTES).toBe(10)
  })

  it('collides with no other label a rating button shows: the other intervals are numbers, and the four names are different words', () => {
    for (const map of [en, ru]) {
      const names = [map.review.again, map.review.hard, map.review.good, map.review.easy]
      const intervals = [map.interval.soon, map.interval.days(1), map.interval.months(2), map.interval.years(1)]
      expect(new Set([...names, ...intervals]).size).toBe(8)
      expect(map.interval.soon).not.toMatch(/\d/)
    }
    expect(offenders(enTexts, /\bSoon\b/)).toEqual(['interval.soon: Soon']) // the word is used for nothing else in the interface
    expect(offenders(ruTexts, /Скоро/)).toEqual(['interval.soon: Скоро'])
  })
})

describe('what the text says about the scheduler is what the scheduler does', () => {
  const spaced = (map: { howItWorks: { sections: readonly { id: string; text: string }[] } }) => map.howItWorks.sections.find((s) => s.id === 'spaced')!.text

  it('"How it works": the longest gap is nine months (the number the code has), and it does not say Again starts over', () => {
    expect(MAX_INTERVAL_DAYS).toBe(270) // nine months of 30 days
    expect(spaced(en)).toContain('nine months')
    expect(spaced(en)).not.toMatch(/each one longer than the last|starts the word over/i)
    expect(spaced(ru)).toContain('девяти месяцев')
    expect(spaced(ru)).not.toMatch(/каждый длиннее предыдущего|начинает слово заново/i)
  })

  it('"How it works" says plainly what Again does, without naming a clock: the word needs another look today, and returns later in this session or the next time the app opens; the button says "Soon" and the text promises nothing it cannot keep', () => {
    expect(RELEARN_MINUTES).toBe(10) // the stored wait is a detail: the text does not repeat it
    for (const text of [spaced(en), spaced(ru)]) expect(text).not.toMatch(/\d+\s*(min|мин)|minute|минут|\bten\b|десят/i)
    expect(spaced(en)).toContain('Again means the word needs another look today: it returns later in this session, or the next time you open the app. The gaps start again from one day.')
    expect(spaced(ru)).toContain('Ответ «Снова» означает, что слово нужно повторить сегодня же: оно вернётся позже в этой сессии или при следующем заходе. Промежутки начнутся заново с одного дня.')
    for (const text of [spaced(en), spaced(ru)]) expect(text).not.toMatch(/wipe|стира/i) // no answer to a worry nobody has
    expect(spaced(en)).not.toMatch(/front of the queue/i) // a session takes the most overdue words, and a word that has just come due is the least overdue: no promise of its place
  })

  const section = (map: { howItWorks: { sections: readonly { id: string; text: string }[] } }, id: string) => map.howItWorks.sections.find((s) => s.id === id)!.text

  it('"How it works", Learn: a finished batch puts every one of its words on review for tomorrow, and the text says that, not "your schedule"', () => {
    // what finishing a batch writes for each word: the same state, due at the start of the next day in the device's own time (learnedState)
    const finished = new Date(2026, 9, 18, 23, 59)
    const batch = { words: ['uno', 'dos', 'tres'].map((w) => makeWord(w)) } as never
    const updates = learnProgressUpdates(batch, finished)
    expect(updates).toHaveLength(3)
    for (const update of updates) expect(update.nextReview).toEqual(new Date(2026, 9, 19, 0, 0)) // tomorrow, from the first minute of it
    expect(learnedState(finished)).toMatchObject({ interval: 0, repetitions: 1 })
    expect(section(en, 'learn')).toContain('When a batch is finished, the words go on to review. They come back for the first time tomorrow.')
    expect(section(ru, 'learn')).toContain('Когда подборка закончена, слова встают на повторение. Первый раз они придут завтра.')
    for (const text of [section(en, 'learn'), section(ru, 'learn')]) expect(text).not.toMatch(/schedule|расписани/i)
  })

  it('"How it works", Spaced: the first-day fact is Learn\'s alone, and the line about the rating buttons is true of all four, "Soon" included', () => {
    for (const text of [spaced(en), spaced(ru)]) expect(text).not.toMatch(/next day|tomorrow|следующий день|завтра/i)
    expect(spaced(en)).toMatch(/^Words come back on a schedule\. Each time you get it right/)
    expect(spaced(ru)).toMatch(/^Слова возвращаются по расписанию\. Каждый раз, когда/)
    expect(spaced(en)).toContain('The small label on each rating button tells you when that answer brings the word back.')
    expect(spaced(ru)).toContain('Подпись на кнопке показывает, когда слово вернётся после такого ответа.')
    for (const text of [spaced(en), spaced(ru)]) expect(text).not.toMatch(/small number|gap that answer gives|маленькое число|промежуток, который даёт/i)
    // what the buttons show: Again says when in words, the other three in days
    const card = { easeFactor: 2.5, interval: 3, repetitions: 2, nextReview: null } as never
    const labels = [1, 2, 3, 4].map((q) => formatInterval(previewInterval(card, q)))
    expect(labels[0]).toBe(en.interval.soon)
    for (const label of labels.slice(1)) expect(label).toMatch(/^\d+d$/)
  })

  it('"How it works", Learn: starring takes a word before the others and fills most of a day\'s new words, said in words (no figure to go stale); the button is called what it is called', () => {
    const learn = [section(en, 'learn'), section(ru, 'learn')]
    expect(section(en, 'learn')).toContain(`Star a word with ${en.words.learnSooner} and Learn takes it before the others: starred words make up most of the new words each day, for as long as there are enough of them.`)
    expect(section(ru, 'learn')).toContain(`Отметьте слово «${ru.words.learnSooner}» — и оно пойдёт в Learn раньше остальных: из отмеченных набирается большая часть новых слов дня, пока они есть.`)
    for (const text of learn) expect(text).not.toMatch(/\d|%|percent|процент/)
    // and it is true of the code, for the sizes a day has: the stars take more than half of a batch (a batch of two is the one exception, exactly half)
    expect(STARRED_SHARE).toBeGreaterThan(0.5)
    for (let size = 1; size <= 30; size++) if (size !== 2) expect(starredSlots(size), `a batch of ${size}`).toBeGreaterThan(size / 2)
    expect(starredSlots(2)).toBe(1)
  })

  it('"How it works", Learn: a card also marks a word that is Rioplatense and a word that means something different here, in both languages, on every card that says it', () => {
    expect(section(en, 'learn')).toContain('Each card has the word, an example sentence and the translation, and it marks a word that is Rioplatense, or that means something different here.')
    expect(section(ru, 'learn')).toContain('На карточке слово, пример предложения и перевод; если слово местное или здесь значит другое, карточка это показывает.')
    expect(en.rio.pill).toBe('Rioplatense')
    expect(ru.rio.pill).toBe('риоплатское')
    expect([en.rio.meaningShift, ru.rio.meaningShift]).toEqual(['A different meaning in this region', 'В этом регионе другое значение'])
    // the cards that show them: Learn's, the word's, and Review's answer
    const pills = (file: string) => (readFileSync(file, 'utf8').match(/isRioplatenseWord\(word\) && <span className="wc-rio">\{strings\.rio\.pill\}<\/span>/g) ?? []).length
    expect(pills('src/components/WordCard.tsx')).toBe(1)
    expect(pills('src/components/ReviewCard.tsx')).toBe(2) // the question side and the answer side
    for (const file of ['src/components/WordCard.tsx', 'src/components/ReviewCard.tsx']) expect(readFileSync(file, 'utf8'), file).toContain('<RelationLines')
    expect(readFileSync('src/components/RelationBlock.tsx', 'utf8')).toContain('{shifted && <p className="wc-shift">{t.meaningShift}</p>}')
  })

  it('"How it works", Review: a session takes the most overdue words, about twenty at a time, and Continue starts another', () => {
    expect(REVIEW_SESSION_SIZE).toBe(20)
    expect(section(en, 'review')).toContain('A session takes the most overdue words, about twenty at a time; while more are due, Continue starts another.')
    expect(section(ru, 'review')).toContain('За один раз берутся самые просроченные слова, около двадцати; пока есть что повторять, «Продолжить» начинает следующую сессию.')
    expect(en.review.continue).toBe('Continue') // the buttons the sentence names
    expect(ru.review.continue).toBe('Продолжить')
    // the most overdue: of 30 due words (w30 has waited longest, w1 least), the session is the 20 that waited longest
    const now = new Date(2026, 9, 18, 12)
    const due = Array.from({ length: 30 }, (_, i) => makeWord(`w${i + 1}`, { repetitions: 2, nextReview: new Date(now.getTime() - (i + 1) * 3_600_000) }))
    const session = buildReviewSession(due, now)
    expect(session).toHaveLength(20)
    expect(session.map((w) => w.esWord).sort()).toEqual(due.slice(10).map((w) => w.esWord).sort())
  })

  it('"How it works", Spaced and Learn: no two sentences in a row each carry a colon, in either language', () => {
    for (const [name, text] of [['en spaced', spaced(en)], ['ru spaced', spaced(ru)], ['en learn', section(en, 'learn')], ['ru learn', section(ru, 'learn')]]) {
      const sentences = text.split(/(?<=[.!?])\s+/)
      for (let i = 1; i < sentences.length; i++) expect(sentences[i - 1].includes(':') && sentences[i].includes(':'), `${name}: "${sentences[i - 1]}" / "${sentences[i]}"`).toBe(false)
    }
  })

  it('"How it works", Cloze: one sentence for what it shows and what you do, then the hint and the answer, then where the words come from', () => {
    expect(section(en, 'cloze')).toBe('Cloze shows a sentence with a word missing, and you type that word in. The hint and the answer are one tap away. The words here also come from the ones you have started learning.')
    expect(section(ru, 'cloze')).toBe('Cloze показывает предложение с пропущенным словом, которое нужно вписать. Подсказка и ответ — в одно касание. Слова здесь тоже берутся из тех, которые вы уже начали учить.')
    for (const map of [en, ru]) expect(section(map, 'cloze').split(/(?<=[.!?])\s/)).toHaveLength(3)
    // and it is what the screen does: a typed answer, a Hint button and a Reveal button
    expect(en.practice.clozeHint).toBe('Type the missing word.')
    expect([en.practice.hint, en.practice.reveal]).toEqual(['Hint', 'Reveal'])
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

  it('the Learn tile says more comes tomorrow, and says so differently for a goal of 0', () => {
    expect(en.home.learnCapReached).toBe('More tomorrow')
    expect(ru.home.learnCapReached).toBe('Новые слова завтра')
    expect(en.home.learnGoalOff).not.toBe(en.home.learnCapReached)
    expect(ru.home.learnGoalOff).not.toBe(ru.home.learnCapReached)
  })

  it('an empty list names the way out: Learn, or clearing the search and filters', () => {
    expect(en.words.emptyStarted).toContain('Learn')
    expect(ru.words.emptyStarted).toContain('Learn')
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
