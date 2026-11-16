import { describe, expect, it } from 'vitest'
import { TOUR_STEPS } from './data/tourSteps'
import { en } from './strings'
import { ru } from './strings.ru'

// The words of the one-time hints (data/hints.ts). The Russian is the owner's, word for word; the English is drafted to match.

describe('the tour', () => {
  it('has the five steps, in this order: Learn, Review, Practice, the Words button at the top, the Word of the day', () => {
    expect(TOUR_STEPS.map((s) => s.id)).toEqual(['learn', 'review', 'practice', 'words', 'wotd'])
    expect(TOUR_STEPS.map((s) => s.target)).toEqual(['tile-learn', 'tile-review', 'tile-practice', 'words', 'wotd'])
  })

  it('says, in Russian, what the owner wrote', () => {
    const t = ru.hints.tour
    expect([t.learn, t.review, t.practice, t.words, t.wotd]).toEqual([
      { title: 'Learn', text: 'Новые слова. Листайте карточки — каждое слово сохраняется в ваш запас.' },
      { title: 'Review', text: 'Сюда слова возвращаются, когда их пора вспомнить. Начинайте день с повторения.' },
      { title: 'Practice', text: 'Упражнения на уже выученных словах.' },
      { title: 'Словарь', text: 'Все слова и поиск. Здесь же можно добавить свое слово.' },
      { title: 'Слово дня', text: 'Каждый день новое местное слово, просто для знакомства.' },
    ])
    expect([t.next, t.done, t.skip]).toEqual(['Далее', 'Готово', 'Пропустить'])
    expect(t.step(2, 5)).toBe('2 из 5')
  })

  it('says the same in English', () => {
    const t = en.hints.tour
    expect([t.learn.title, t.review.title, t.practice.title, t.words.title, t.wotd.title]).toEqual(['Learn', 'Review', 'Practice', 'Words', 'Word of the day'])
    expect([t.next, t.done, t.skip]).toEqual(['Next', 'Done', 'Skip'])
    expect(t.step(2, 5)).toBe('2 of 5')
  })
})

describe('the other hints', () => {
  it('the snackbar and the strip on the Learn tile, as decided', () => {
    expect([ru.hints.queuedNote, ru.hints.openLearn, ru.hints.queuedTile(2)]).toEqual(['Добавлено в очередь', 'Открыть Learn', 'в очереди: 2'])
    expect([en.hints.queuedNote, en.hints.openLearn, en.hints.queuedTile(2)]).toEqual(['Added to the learning queue', 'Open Learn', 'queued: 2'])
  })

  it('the two bubbles, in Russian as the owner wrote them', () => {
    expect(ru.hints.wordQueue).toBe('Хотите выучить это слово? Добавьте его — оно появится в Learn раньше остальных')
    expect(ru.hints.homeWotd).toBe('Каждый день новое местное слово, просто для знакомства. Учить слова — в Learn')
  })

  it('the end screen of the first batch, and the Settings row', () => {
    expect(ru.learn.firstBatchWhy).toBe('Завтра эти слова вернутся в Review — так они запоминаются')
    expect(en.learn.firstBatchWhy).toBe('Tomorrow these words come back in Review — that is how they stick')
    expect([ru.settings.showHints, en.settings.showHints]).toEqual(['Показать подсказки снова', 'Show hints again'])
  })
})
