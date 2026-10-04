// Every user-facing string lives here (English for now) so localization is a one-file change.

export const strings = {
  appTitle: 'Riopalabras',

  common: {
    back: 'Back',
    retry: 'Retry',
    backToHome: 'Back to home',
    loading: 'Loading your words…',
    saving: 'Saving…',
    reload: 'Reload',
    signInPrompt: 'Open inside Telegram to sign in.',
    loadFailed: (message: string) => `Couldn't load your data: ${message}`,
  },

  home: {
    toReviewToday: 'To review today',
    newToLearn: 'New to learn',
    learn: 'Learn',
    learnWithCount: (n: number) => `Learn new words (${n})`,
    learnCapReached: 'Daily limit reached',
    learnPoolEmpty: 'No new words available',
    reviewWithCount: (n: number) => `Review due words (${n})`,
    reviewNothingDue: 'Nothing to review',
    debugLink: 'Debug',
  },

  learn: {
    title: 'Learn',
    wordNofM: (n: number, m: number) => `Word ${n} of ${m}`,
    swipeHint: 'Swipe or use the arrows',
    previous: 'Previous',
    next: 'Next',
    finishBatch: 'Finish batch',
    saveFailed: (message: string) => `Couldn't save your progress: ${message}`,
    leaveUnsaved: "This batch hasn't been fully saved yet. Leave anyway?",
    learnNextBatch: 'Learn next batch',
    reviewDueWords: (n: number) => `Review due words (${n})`,
    newWordsToday: (n: number, limit: number) => `${n} of ${limit} new words today`,
    capReachedTitle: "Today's new words are done",
    capReachedSubtitle: 'Nice work. Come back tomorrow for more.',
    poolEmptyTitle: 'No new words available right now.',
    poolEmptySubtitle: "Learn introduces new words you haven't studied yet.",
  },

  review: {
    title: 'Review',
    cardNofM: (n: number, m: number) => `Card ${n} of ${m}`,
    tapToReveal: 'Tap to reveal',
    howWell: 'How well did you know it?',
    again: 'Again',
    hard: 'Hard',
    good: 'Good',
    easy: 'Easy',
    emptyTitle: 'No cards to review',
    emptyMessage: 'Complete a Learn batch first!',
    goLearn: 'Learn',
    allCaughtUp: 'All caught up!',
    allCaughtUpSubtitle: 'No cards are due for review right now.',
    refresh: 'Refresh',
    saving: 'Saving…',
    ratingsNotSaved: (n: number) => (n === 1 ? '1 rating not saved' : `${n} ratings not saved`),
    progressNotSaved: 'Your progress is not saved',
    notSavedHint: 'Check your connection and try again.',
    retry: 'Retry',
    leaveUnsaved: (n: number) =>
      n > 0
        ? `${n === 1 ? '1 rating isn\'t' : `${n} ratings aren't`} saved yet. Leave anyway?`
        : "Your progress isn't fully saved yet. Leave anyway?",
  },

  card: {
    rioplatensePill: 'rioplatense',
    standardWord: 'estándar',
    en: 'EN',
    ru: 'RU',
  },

  // Labels for the Rioplatense overlay, in the language the user reads (see langFromSettings).
  rio: {
    en: {
      rioplatense: 'Rioplatense',
      also: 'also',
      note: 'Note',
      standardMeaning: 'Standard meaning',
      tag: { uy: 'UY', ar: 'AR' },
      tagTitle: { uy: 'Used in Uruguay', ar: 'Used in Argentina' },
    },
    ru: {
      rioplatense: 'Риоплатский вариант',
      also: 'также',
      note: 'Заметка',
      standardMeaning: 'Обычное значение',
      tag: { uy: 'UY', ar: 'AR' },
      tagTitle: { uy: 'Используется в Уругвае', ar: 'Используется в Аргентине' },
    },
  },

  pos: {
    v: 'Verb',
    n: 'Noun',
    adj: 'Adjective',
    adv: 'Adverb',
    custom: 'Other',
    prop: 'Proper noun',
    pron: 'Pronoun',
    num: 'Number',
    prep: 'Preposition',
    determiner: 'Determiner',
    conj: 'Conjunction',
    interj: 'Interjection',
    letter: 'Letter',
    contraction: 'Contraction',
    art: 'Article',
  } as Record<string, string>,

  debug: {
    title: 'Debug',
    auth: 'Auth',
    signingIn: 'Signing in…',
    signedInAs: (name: string) => `Signed in as ${name}`,
    userId: 'Supabase user id',
    session: 'Session',
    sessionReused: 'active (reused stored session)',
    sessionNew: 'active (new, from /auth/telegram)',
    signInFailed: (message: string) => `Sign-in failed: ${message}`,
  },
} as const
