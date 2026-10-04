import type { ProgressUpdate, Word } from '../data/types'

export function makeWord(esWord: string, overrides: Partial<Word> = {}): Word {
  return Object.freeze({
    esWord,
    esRioplatense: null,
    rio: null,
    enTranslation: 'x',
    ruTranslation: 'y',
    exampleSentence: '',
    exampleTranslationEn: '',
    exampleTranslationRu: '',
    wordFormInExample: null,
    isRioplatenseVariant: false,
    pos: 'n',
    frequency: 1000,
    rank: 1,
    easeFactor: 2.5,
    interval: 0,
    repetitions: 0,
    nextReview: null,
    isFavorite: false,
    isHidden: false,
    isCustom: false,
    isEnriched: true,
    ...overrides,
  })
}

export function makeUpdate(esWord: string, overrides: Partial<ProgressUpdate> = {}): ProgressUpdate {
  return { esWord, easeFactor: 2.5, interval: 0, repetitions: 1, nextReview: new Date('2026-10-03T03:00:00.000Z'), ...overrides }
}
