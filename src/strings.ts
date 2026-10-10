// Every user-facing string lives here. `en` is the canonical map (the key set); src/strings.ru.ts has the same keys in Russian, and a
// test fails if the two differ in either direction. `strings` reads whichever the interface language is (src/lib/language.ts) at the moment
// a value is read, so a screen shows the language that is current when it renders.
//
// Two kinds of text, kept apart on purpose:
//  - UI chrome (buttons, headings, labels, status text, summaries, confirmations): follows the interface language. Debug stays English.
//  - Word content, which follows the translation flags (see data/translations.ts), not the interface language: `wordContent` and `card`
//    below have an `en` and a `ru` half in BOTH maps and are picked by the flag, plus data from the dictionary or overlay
//    (translations, overlay notes, the Cloze cue). The register labels (informal, vulgar, …) are chrome: they live in `rio`.
//
// Plurals: a string that depends on a count calls `plural(n, forms)`, which picks the form the current language uses for that number
// (English has two, Russian three: 1 слово / 2 слова / 5 слов).
import { getLanguage, type UiLanguage } from './lib/language'
import { plural } from './lib/plural'
import { card, debug, wordContent } from './strings.shared'
import { ru } from './strings.ru'

export { plural }

/** 1st, 2nd, 3rd, 4th … 11th, 12th, 13th … 21st. */
export function ordinal(n: number): string {
  const teen = n % 100 >= 11 && n % 100 <= 13
  const suffix = teen ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10] ?? 'th'
  return `${n}${suffix}`
}

export const en = {
  appTitle: 'Riopalabras',

  common: {
    back: 'Back',
    retry: 'Retry',
    backToHome: 'Back to home',
    loading: 'Loading your words…',
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
    degradedTables: { user_favorites: 'favorites', user_hidden_words: 'hidden words' } as Record<string, string>,
    degraded: (tables: string[]) => `Couldn't load your ${tables.join(' and ')} yet. Retrying in the background.`,
    degradedHiddenWarning: 'Words you hid may still show up until it loads.',
    retryNow: 'Retry now',
    streak: (n: number) => `${n}-day streak`,
    // the letters under the week of dots, Monday first
    weekdays: ['M', 'T', 'W', 'T', 'F', 'S', 'S'] as readonly string[],
    streakDots: (active: number) => `Active on ${active} of the last 7 days`,
    wotdPill: 'palabra del día',
    wotdTitle: 'Word of the day',
    seeCard: 'See the card →',
    // action tiles: the English label, the Spanish word under it, and why a tile is disabled
    tiles: {
      learn: { label: 'Learn', es: 'aprender' },
      review: { label: 'Review', es: 'repasar' },
      matching: { label: 'Matching', es: 'parejas' },
      cloze: { label: 'Cloze', es: 'completar' },
    },
    wordsButton: 'Words',
    settingsButton: 'Settings',
    unsavedProgress: "Some progress hasn't been saved yet. Retrying…",
    signInRejected: "Your progress can't be saved: the sign-in was refused. Retry, or close and reopen the app to sign in again.",
  },

  // The Words screen: browse, search and manage the dictionary. English chrome.
  words: {
    title: 'Words',
    detailTitle: 'Word',
    searchPlaceholder: 'Search Spanish, English or Russian',
    searchLabel: 'Search words',
    segments: { all: 'All', learned: 'Learned', hidden: 'Hidden' },
    segmentsLabel: 'Which words',
    // the two buttons under the segments, each opening a bottom sheet
    filtersButton: 'Filters',
    sortButton: (current: string) => `Sort: ${current}`,
    filtersActive: (n: number) => `${n} ${plural(n, { one: 'filter', other: 'filters' })} on`,
    sheet: {
      close: 'Close',
      filtersTitle: 'Filters',
      clearAll: 'Clear all',
      sortTitle: 'Sort by',
      progress: 'Progress',
      showOnly: 'Show only',
      partOfSpeech: 'Part of speech',
      anyProgress: 'Any',
    },
    // what the learning states are called to the user (the code keeps new / learning / established / due)
    states: { new: 'Not started', learning: 'In progress', established: 'Known well', due: 'Due now' },
    favourites: 'Favourites',
    queued: 'Queued',
    pos: { verb: 'Verbs', noun: 'Nouns', adj: 'Adjectives', adv: 'Adverbs' },
    sorts: { frequency: 'Frequency', az: 'A to Z', due: 'Due soonest', recent: 'Recently learned', random: 'Random' },
    bestMatch: 'Best match',
    // short part-of-speech tags on a row
    posTag: { n: 'noun', v: 'verb', adj: 'adj', adv: 'adv', pron: 'pron', num: 'num', prep: 'prep', determiner: 'det', conj: 'conj', interj: 'interj', letter: 'letter', contraction: 'contr', art: 'art' } as Record<string, string>,
    due: 'Due now',
    stateName: { hidden: 'Hidden', reference: 'Reference only', due: 'Due now', established: 'Known well', learning: 'In progress', new: 'Not started' } as Record<string, string>,
    favourite: (word: string) => `Add ${word} to favourites`,
    unfavourite: (word: string) => `Remove ${word} from favourites`,
    addFavourite: 'Add to favourites',
    removeFavourite: 'Remove from favourites',
    // the Learn queue: "Queue for Learn" in the detail of a word that is not started
    queueForLearn: 'Queue for Learn',
    removeFromQueue: 'Queued — remove',
    queuedAt: (place: number) => `Queued — ${ordinal(place)} in line.`,
    queueFull: (max: number) => `The queue is full (${max} ${plural(max, { one: 'word', other: 'words' })}). Take one out to add another.`,
    beyondToday: "Beyond today's batch",
    // the user's own words: add (the "+" in the header), edit and delete from the detail
    custom: 'Custom',
    addWord: 'Add a word',
    customMark: 'Added by you',
    editWord: 'Edit',
    deleteWord: 'Delete',
    added: 'Added, and queued for Learn.',
    addedNotQueued: (max: number) => `Added. The Learn queue is full (${max} ${plural(max, { one: 'word', other: 'words' })}), so it was not queued.`,
    saved: 'Saved.',
    deleteTitle: (word: string) => `Delete “${word}”?`,
    deleteBody: 'The word is removed from your list. If you add the same word again later, the progress you made with it comes back.',
    deleteConfirm: 'Delete',
    deleteCancel: 'Cancel',
    form: {
      addTitle: 'Add a word',
      editTitle: 'Edit word',
      spanish: 'Spanish word',
      spanishHint: 'One word, up to 50 characters.',
      pos: 'Part of speech',
      posNames: { v: 'Verb', n: 'Noun', adj: 'Adjective', adv: 'Adverb', custom: 'Other' } as Record<string, string>,
      continue: 'Continue',
      change: 'Change',
      problems: {
        empty: 'Type the Spanish word.',
        spaces: 'One word only: phrases are not supported yet.',
        'too-long': 'That is longer than 50 characters.',
        pos: 'Pick a part of speech.',
        translations: 'Both translations are needed: a word with only one cannot be taught or reviewed.',
      } as Record<string, string>,
      // the word is already there: say where it matched
      duplicate: (typed: string, existing: string, via: 'es_word' | 'es_rioplatense' | 'overlay') =>
        via === 'es_word' ? `“${existing}” is already in your words.` : `“${typed}” is already in your words, as the Rioplatense form of “${existing}”.`,
      openExisting: (word: string) => `Open “${word}”`,
      looking: 'Looking up a translation…',
      fillMyself: 'Fill it in myself',
      ru: 'Russian translation',
      en: 'English translation',
      translationsHint: 'Both translations are needed: a word with only one cannot be taught or reviewed.',
      example: 'Example sentence (optional)',
      exampleEn: 'Example in English (optional)',
      exampleRu: 'Example in Russian (optional)',
      rioplatenseForm: (form: string) => `Rioplatense form: ${form}`,
      rioplatenseCheck: 'This word is Rioplatense',
      rioplatenseHint: 'The region, register and standard word below only show on the card when this is on.',
      region: 'Region',
      regionHint: 'Where a Rioplatense word is used. Leave Unknown for both countries, or when unsure.',
      regionNames: { ar: 'Argentina only', uy: 'Uruguay only' } as Record<string, string>,
      register: 'Register',
      registerNames: { neutral: 'Neutral', informal: 'Informal', vulgar: 'Vulgar', offensive: 'Offensive', pejorative: 'Pejorative' } as Record<string, string>,
      unknown: 'Unknown',
      standard: 'Standard Spanish equivalent',
      standardHint: 'For a Rioplatense word: the standard word, such as “calabacín” for “zapallito”. Optional.',
      filled: 'Filled in automatically. Change anything before you save.',
      // The lookup says the word as typed is not a Spanish word: with a likely spelling it asks, without one it only says so. Never blocks saving.
      spelling: {
        didYouMean: (suggestion: string) => `Did you mean ${suggestion}?`,
        notRecognised: (word: string) => `“${word}” was not recognised as a Spanish word.`,
        notRecognisedSave: (word: string) => `“${word}” was not recognised as a Spanish word. You can still save it.`,
        use: (suggestion: string) => `Use ${suggestion}`,
        keep: (word: string) => `Keep ${word}`,
      },
      save: 'Save',
      cancel: 'Cancel',
      discardTitle: 'Discard this word?',
      discardBody: 'What you filled in will be lost.',
      discard: 'Discard',
      keepEditing: 'Keep editing',
    },
    // why a translation could not be filled in; the form is always left open to type it by hand
    enrich: {
      offline: "You're offline, so the translation can't be filled in. Type it yourself.",
      unauthorized: "Your sign-in wasn't accepted, so the translation can't be filled in. Type it yourself, or close and reopen the app.",
      dailyQuota: (usage: number, limit: number) => `You've used ${usage} of ${limit} automatic ${plural(limit, { one: 'translation', other: 'translations' })} today. Type it yourself, or try again tomorrow.`,
      rateLimit: 'Too many requests. Try again in a minute, or type it yourself.',
      busy: 'The translation service is busy right now. Try again later, or type it yourself.',
      timeout: "The translation service didn't answer in time. Type it yourself, or try again.",
      network: "Couldn't reach the translation service. Type it yourself, or try again.",
      noResult: 'The service had no translation for this word. Type it yourself.',
      other: (status: number | null) => (status ? `The translation service failed (error ${status}). Type it yourself, or try again.` : 'The translation service is not available. Type it yourself.'),
    },
    bringBack: 'Bring back',
    bringBackWord: (word: string) => `Bring back ${word}`,
    emptyLearned: 'Nothing learned yet.',
    emptyAll: 'No words.',
    emptyHidden: 'Nothing hidden. Words you mark as known appear here.',
    emptyFiltered: 'No words match.',
    count: (shown: number) => `${shown} ${plural(shown, { one: 'word', other: 'words' })}`,
    open: (word: string) => `Open ${word}`,
    detail: {
      progress: 'Progress',
      scheduling: 'Scheduling details',
      state: 'State',
      repetitions: 'Repetitions',
      interval: 'Interval',
      nextReview: 'Next review',
      notScheduled: 'Not scheduled',
      dueNow: 'due now',
      ease: 'Ease factor',
      noteHidden: 'Marked as known: hidden from Learn, Review and practice. Its progress is kept, so bringing it back puts it in rotation as it was.',
      noteReference: (why: string) => `Reference only: ${why}, so it is never in Learn or Review.`,
      reasonPos: 'this kind of word is not drilled',
      reasonNoTranslation: 'it has no translation yet',
    },
  },

  // The gap before a word comes back, as the rating buttons and the word detail abbreviate it ("3d", "2mo").
  interval: {
    minutes: (n: number) => `${n} min`,
    days: (n: number) => `${n}d`,
    months: (n: number) => `${n}mo`,
    years: (n: number) => `${n}y`,
  },

  theme: {
    names: { system: 'System', light: 'Light', dark: 'Dark' } as Record<string, string>,
  },

  // The Settings screen. English chrome.
  settings: {
    title: 'Settings',
    learning: 'Learning',
    dailyGoal: 'Daily goal',
    dailyGoalHint: 'New words per day',
    decrease: 'Decrease the daily goal',
    increase: 'Increase the daily goal',
    // from 16 up the day is split into Learn sessions of 10 (as in the Flutter app)
    sessionsNote: "Amounts of 16+ are split into sessions of 10 — you'll return to Learn between them.",
    translation: 'Translations',
    translationHint: 'Show Russian, English or both. One stays on.',
    russian: 'Russian',
    english: 'English',
    language: 'Language',
    uiLanguage: 'App language',
    // each in its own language, in both maps: a person has to be able to find their own
    uiLanguageNames: { en: 'English', ru: 'Русский' } as Record<string, string>,
    appearance: 'Appearance',
    theme: 'Theme',
    notifications: 'Notifications',
    reminders: 'Reminders — coming soon',
    remindersHint: 'They will arrive through the bot.',
    about: 'About',
    version: 'Version',
    bot: 'Open the bot',
    aboutText: 'The app is in development. You can learn and review words, and your progress is saved.',
    placementTest: 'Take the placement test',
    placementNone: 'Learn starts with the most common words.',
    placementAt: (rank: number) => `Learn will draw mostly from word ${rank} onwards, but not only.`,
    howItWorks: 'How it works',
    runIntro: 'Run the intro again',
    debug: 'Debug',
  },

  // The intro, shown once on a new account and again from Settings. English chrome; Spanish words are marked `es` (set in the display face).
  onboarding: {
    stepOf: (n: number, m: number) => `Step ${n} of ${m}`,
    progress: 'Intro progress',
    back: 'Back',
    continue: 'Continue',
    done: 'Done',
    language: { title: 'App language', text: 'Choose the language the app uses.' },
    about: { sentence: 'The Spanish actually spoken in Uruguay and Argentina, not textbook Spanish.' },
    inside: {
      title: 'What is inside',
      items: [
        { id: 'learn', name: 'Learn', text: 'new words, each shown in a real sentence rather than a bare list.', tone: 'learn' },
        { id: 'review', name: 'Review', text: 'self-check cards: you say whether you remembered, and the app decides when the word comes back.', tone: 'learn' },
        { id: 'practice', name: 'Matching and Cloze', text: 'two other ways to go over what you know: pair words with their translations, or fill the missing word into a sentence.', tone: 'practice' },
        { id: 'words', name: 'Words', text: 'the whole dictionary, with search, filters, favourites, and words you add yourself.', tone: 'learn' },
      ] as const,
    },
    translation: {
      title: 'Translations',
      text: 'Show Russian, English or both next to every word.',
      names: { ru: 'Russian', en: 'English', both: 'Both' } as Record<string, string>,
      note: 'It can be changed in Settings.',
    },
    // The placement test (step 5 of the intro, and "Take the placement test" in Settings): five sets of five words, nothing scored.
    placement: {
      title: 'Placement test',
      question: 'Which of these do you know?',
      hint: 'Only mark the words whose meaning you are sure of.',
      set: (n: number, m: number) => `Set ${n} of ${m}`,
      progress: 'Placement test progress',
      back: 'Back',
      next: 'Continue',
      finish: 'Finish',
      skip: 'Skip',
      skipNote: 'It can be taken later from Settings.',
      unavailable: 'There are not enough new words left for a placement test.',
    },
    goal: { title: 'Daily goal', text: 'New words per day' },
    pronunciation: {
      title: 'Pronunciation',
      // each fact is a run of pieces; the Spanish ones are set in the display face
      facts: [
        [{ es: 'll' }, { text: ' and ' }, { es: 'y' }, { text: ' sound like the “sh” in “shoe”: ' }, { es: 'calle' }, { text: ', ' }, { es: 'yo' }, { text: '.' }],
        [{ text: 'People say “' }, { es: 'vos tenés' }, { text: '” where a textbook says “' }, { es: 'tú tienes' }, { text: '”.' }],
      ] as readonly (readonly { es?: string; text?: string }[])[],
      link: 'How it works',
    },
  },

  // The "How it works" screen (About in Settings, and the end of the intro). Plain paragraphs, in the words of the app's own buttons.
  howItWorks: {
    title: 'How it works',
    sections: [
      {
        id: 'learn',
        heading: 'Learn',
        text: 'Learn brings new words, a few at a time, up to your daily goal. Each card has the word, an example sentence and the translation. Finishing a batch puts its words on your schedule. A word you already know can be marked as known: it then stays out of Learn, Review and the practice exercises.',
      },
      {
        id: 'review',
        heading: 'Review',
        text: 'Review shows the words that are due. Turn a card over, then say how well you knew it: Again, Hard, Good or Easy. That answer decides when the word comes back.',
      },
      {
        id: 'matching',
        heading: 'Matching',
        text: 'Matching pairs Spanish words with their translations. It uses words you have already learned.',
      },
      {
        id: 'cloze',
        heading: 'Cloze',
        text: 'Cloze shows a sentence with one word blanked out. You type the missing word. A hint and the answer are one tap away. It also uses words you have already learned.',
      },
      {
        id: 'spaced',
        heading: 'Why a word comes back',
        text: 'Words come back on a schedule. A word you have just learned is due the next day. If you knew it, the next gap is a few days, then about a week, then weeks and months, each one longer than the last. A word is easiest to hold on to when it is seen just as it starts to fade, so every success pushes the next review further out. Again starts the word over, and it comes back soon. The small number on each rating button is the gap that answer gives.',
      },
    ],
  },

  learn: {
    title: 'Learn',
    wordNofM: (n: number, m: number) => `Word ${n} of ${m}`,
    swipeHint: 'Swipe or use the arrows',
    // "Already know it": a secondary action, set apart from the main ones
    alreadyKnow: 'I already know this word',
    markedKnown: (word: string) => `“${word}” marked as known`,
    undo: 'Undo',
    previous: 'Previous',
    next: 'Next',
    finishBatch: 'Finish batch',
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
    progress: (n: number, m: number) => `${n} / ${m}`,
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
    // After a session of 20, when more words are still due.
    sessionDone: 'Done for now',
    sessionLeft: (n: number) => `${n} ${plural(n, { one: 'word is', other: 'words are' })} still due.`,
    continue: 'Continue',
  },

  // Matching and Cloze chrome.
  practice: {
    matchingButton: 'Practice Matching',
    clozeButton: 'Practice Cloze',
    needWords: 'Need 5+ words',
    matchingTitle: 'Matching',
    matchingHint: 'Tap a word, then its translation.',
    matchingInsufficient: 'Learn and review some words first, then come back to practice matching.',
    groupComplete: 'Group complete',
    nextGroup: 'Next group',
    clozeTitle: 'Cloze',
    clozeInsufficient: 'Learn and review some words with example sentences first, then come back to practice Cloze.',
    answerLabel: 'Your answer',
    hint: 'Hint',
    reveal: 'Reveal',
    check: 'Check',
    continue: 'Continue',
    correct: 'Correct!',
    accentNudge: (form: string) => `Mind the accent: ${form}`,
    wrong: (form: string) => `Not quite — the word was: ${form}`,
    gaveUp: (form: string) => `The word was: ${form}`,
    sessionComplete: 'Session complete',
    score: (n: number, m: number) => `${n} of ${m} correct`,
    newSession: 'New session',
    outcome: { correct: 'Correct', wrong: 'Wrong', gaveUp: 'Gave up' },
    backHome: 'Back home',
    progressLabel: 'Question progress',
  },

  card,

  wordContent,

  // Chrome for the Rioplatense overlay (pill, relation labels, hints, tooltips). The overlay's notes and standard-meaning TEXT are word content.
  rio: {
    pill: 'Rioplatense',
    rioplatense: 'Rioplatense',
    also: 'also',
    standard: 'standard',
    // std_usage as a soft hint after the standard word; less_common says nothing
    stdUsageHint: { equally_used: 'also common', less_common: null, not_used: 'rarely used here' } as Record<string, string | null>,
    note: 'Note',
    standardMeaning: 'Standard meaning',
    // how the headword sounds; neutral shows nothing
    register: { informal: 'informal', vulgar: 'vulgar', offensive: 'offensive', pejorative: 'pejorative' } as Record<string, string | undefined>,
    tag: { uy: 'UY', ar: 'AR' },
    tagTitle: { uy: 'Used in Uruguay', ar: 'Used in Argentina' },
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

  debug,

} as const

// ---- reading the strings in the current language ----

/** The shape of `en` with its literal types widened (a Russian string is a string, not the English one), so `ru` must have exactly these keys. */
type Widen<T> = T extends string
  ? string
  : T extends number
    ? number
    : T extends boolean
      ? boolean
      : T extends (...args: infer A) => infer R
        ? (...args: A) => Widen<R>
        : T extends readonly (infer E)[]
          ? readonly Widen<E>[]
          : T extends object
            ? { -readonly [K in keyof T]: Widen<T[K]> }
            : T
export type Strings = Widen<typeof en>

const maps: Record<UiLanguage, Strings> = { en, ru }

/** The value at `path` in the language's map, or the English one if the language lacks it (a test makes sure it never does). */
function pick(path: readonly string[], language: UiLanguage): unknown {
  let node: unknown = maps[language]
  for (const key of path) node = (node as Record<string, unknown> | null | undefined)?.[key]
  return node === undefined && language !== 'en' ? pick(path, 'en') : node
}

/**
 * `strings` is `en`'s shape with every value read at the moment it is used: a function calls the current language's version of itself,
 * anything else is looked up then. So `const t = strings.words` at the top of a file is fine, and a screen shows the language that is
 * current when it renders (the app re-renders everything when the language changes: see useLanguage).
 */
function lazy(node: Record<string, unknown>, path: readonly string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const key of Object.keys(node)) {
    const here = [...path, key]
    const value = node[key]
    if (typeof value === 'function') {
      const call = (...args: unknown[]) => (pick(here, getLanguage()) as (...a: unknown[]) => unknown)(...args)
      Object.defineProperty(out, key, { value: call, enumerable: true })
    } else if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      Object.defineProperty(out, key, { value: lazy(value as Record<string, unknown>, here), enumerable: true })
    } else {
      Object.defineProperty(out, key, { get: () => pick(here, getLanguage()), enumerable: true })
    }
  }
  return out
}

export const strings = lazy(en, []) as unknown as typeof en
