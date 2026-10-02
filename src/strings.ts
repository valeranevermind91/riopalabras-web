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
    review: 'Review',
    reviewSoon: 'Coming next',
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
    newWordsToday: (n: number, limit: number) => `${n} of ${limit} new words today`,
    capReachedTitle: "Today's new words are done",
    capReachedSubtitle: 'Nice work. Come back tomorrow for more.',
    poolEmptyTitle: 'No new words available right now.',
    poolEmptySubtitle: "Learn introduces new words you haven't studied yet.",
  },

  review: {
    title: 'Review',
    placeholder: 'Review is coming in the next update.',
  },

  card: {
    rioplatensePill: 'rioplatense',
    standardWord: 'estándar',
    en: 'EN',
    ru: 'RU',
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
