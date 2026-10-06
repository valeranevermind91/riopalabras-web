// Every user-facing string lives here so localization is a one-file change.
//
// Two kinds of text, kept apart on purpose:
//  - UI chrome (buttons, headings, labels, status text, summaries, confirmations): ALWAYS English for now.
//    Groups that exist in both languages (`practice`, `rio`) keep their Russian half for the day a real
//    UI-language setting arrives; until then only the `en` half is read, via `strings.practice.en` / `strings.rio.en`.
//  - Word content, which follows the translation setting (see langFromSettings): `wordContent` below (the Cloze
//    "in this sentence" nudge), plus data that comes from the dictionary or overlay (translations, overlay notes, the Cloze cue).
//    The register labels (informal, vulgar, …) are chrome, like "standard" and "also": they live in `rio`.

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
    degradedTables: { user_favorites: 'favorites', user_hidden_words: 'hidden words' } as Record<string, string>,
    degraded: (tables: string[]) => `Couldn't load your ${tables.join(' and ')} yet. Retrying in the background.`,
    degradedHiddenWarning: 'Words you hid may still show up until it loads.',
    retryNow: 'Retry now',
    streak: (n: number) => `${n}-day streak`,
    streakDots: (active: number) => `Active on ${active} of the last 7 days`,
    today: (learned: number, limit: number) => `Today ${learned} / ${limit}`,
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
    unsavedProgress: "Some progress hasn't been saved yet. Retrying…",
  },

  theme: {
    names: { system: 'System', light: 'Light', dark: 'Dark' } as Record<string, string>,
    toggle: (current: string, next: string) => `Theme: ${current}. Tap to switch to ${next}.`,
  },

  learn: {
    title: 'Learn',
    wordNofM: (n: number, m: number) => `Word ${n} of ${m}`,
    swipeHint: 'Swipe or use the arrows',
    previous: 'Previous',
    next: 'Next',
    finishBatch: 'Finish batch',
    saveFailed: (message: string) => `Couldn't save your progress: ${message}`,
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

  // Matching and Cloze chrome. English is used everywhere today; the Russian half waits for a UI-language setting.
  practice: {
    en: {
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
    ru: {
      matchingButton: 'Практика: пары',
      clozeButton: 'Практика: пропуски',
      needWords: 'Нужно 5+ слов',
      matchingTitle: 'Сопоставление',
      matchingHint: 'Выбери слово, затем его перевод.',
      matchingInsufficient: 'Сначала выучи и повтори несколько слов, потом возвращайся к практике.',
      groupComplete: 'Группа пройдена',
      nextGroup: 'Следующая группа',
      clozeTitle: 'Пропуски',
      clozeInsufficient: 'Сначала выучи и повтори несколько слов с примерами, потом возвращайся к практике.',
      answerLabel: 'Твой ответ',
      hint: 'Подсказка',
      reveal: 'Показать',
      check: 'Проверить',
      continue: 'Дальше',
      correct: 'Верно!',
      accentNudge: (form: string) => `Не забудь про ударение: ${form}`,
      wrong: (form: string) => `Не совсем — нужное слово: ${form}`,
      gaveUp: (form: string) => `Слово: ${form}`,
      sessionComplete: 'Сессия завершена',
      score: (n: number, m: number) => `${n} из ${m} верно`,
      newSession: 'Новая сессия',
      outcome: { correct: 'Верно', wrong: 'Неверно', gaveUp: 'Сдался' },
      backHome: 'На главную',
      progressLabel: 'Прогресс по вопросам',
    },
  },

  card: {
    en: 'EN',
    ru: 'RU',
  },

  // Word-related text that follows the translation setting (see langFromSettings), not the UI language. Only the Cloze nudge for now.
  wordContent: {
    en: {
      // Cloze nudge when the headword was typed instead of the form in the sentence
      inSentence: (form: string) => `in this sentence: ${form}`,
    },
    ru: {
      inSentence: (form: string) => `в этом предложении: ${form}`,
    },
  },

  // Chrome for the Rioplatense overlay (pill, relation labels, hints, tooltips). English is used everywhere today;
  // the Russian half waits for a UI-language setting. The overlay's notes and standard-meaning TEXT are word content.
  rio: {
    en: {
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
    ru: {
      pill: 'риоплатский',
      rioplatense: 'Риоплатский вариант',
      also: 'также',
      standard: 'стандарт',
      stdUsageHint: { equally_used: 'тоже в ходу', less_common: null, not_used: 'здесь почти не говорят' } as Record<string, string | null>,
      note: 'Заметка',
      standardMeaning: 'Обычное значение',
      register: { informal: 'разговорное', vulgar: 'вульгарное', offensive: 'оскорбительное', pejorative: 'пренебрежительное' } as Record<string, string | undefined>,
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

    // User-data load log: the real cause of a failed (or retried) load, kept even when a retry succeeded.
    loadLog: {
      title: 'User-data load errors',
      empty: 'No load errors recorded in this session.',
      degraded: (tables: string[]) => `Degraded now (still retrying in the background): ${tables.join(', ')}`,
      entry: (e: { at: string; table: string; attempt: number; kind: string; status: number | null; code: string | null; message: string; outcome: string }) =>
        `${e.at.slice(11, 19)} ${e.table} #${e.attempt} ${e.kind}${e.status !== null ? ` HTTP ${e.status}` : ''}${e.code ? ` [${e.code}]` : ''} → ${e.outcome}: ${e.message}`,
      clear: 'Clear',
    },

    // Word preview (dev tool, English only): no progress writes, no queue, no Supabase.
    preview: {
      title: 'Word preview',
      searchLabel: 'Search a word (es_word or Rioplatense form)',
      searchPlaceholder: 'aquí, acá, pucho…',
      noMatch: 'No match',
      loading: 'Loading the dictionary…',
      loadFailed: (message: string) => `Dictionary failed to load: ${message}`,
      overlayLoaded: (n: number) => `Overlay loaded: ${n} entries`,
      overlayMissing: 'Overlay NOT loaded: the legacy es_rioplatense field is in use',
      viaRioForm: (form: string) => `via ${form}`,
      learnCard: 'Learn card (WordCard)',
      reviewBack: 'Review card, back (ReviewCard)',
      showFront: 'Flip back to the front',
      raw: 'Raw',
      language: 'Language',
      noWord: 'Pick a word to preview.',
      rows: {
        esWord: 'es_word',
        posRank: 'pos / rank',
        overlay: 'overlay type / form / region / status',
        stdUsage: 'std_usage (is es_word used? decides its label)',
        alt: 'alt form (region)',
        registerConfidence: 'register / confidence',
        legacy: 'legacy es_rioplatense',
        wordForm: 'word_form_in_example (dictionary)',
        exampleUsed: 'example used',
        sentence: 'example shown (** removed)',
        overlayTranslations: 'example EN / RU (from the overlay or the fallback file)',
        headword: 'headword',
        decision: 'why',
        translation: 'translation shown',
        highlight: 'highlighted',
      },
      noOverlay: 'none (plain dictionary word)',
      status: 'accepted (the client file only holds accepted entries)',
      none: '(none)',
      reason: {
        'no-overlay': 'No overlay entry: a plain dictionary word.',
        legacy: 'Legacy rule (no overlay entry): old es_rioplatense value checked against the example word form.',
        'not-replacement': (type: string) => `Type ${type} never switches the headword; only a replacement can.`,
        'unclean-form': 'The overlay form is not a clean headword, so it cannot lead.',
        'same-as-es-word': 'The overlay form equals es_word, so there is nothing to switch to.',
        'overlay-example-has-form': (form: string, matched: string) => `Switched: the overlay example contains «${form}» (as “${matched}”).`,
        'dictionary-example-has-form': (form: string, matched: string) => `Switched: the dictionary example contains «${form}» (as “${matched}”).`,
        'no-example-has-form': (form: string) => `Not switched (pass-2 fallback): neither the overlay example nor the dictionary example contains «${form}» or an inflection of it, so the standard word keeps the headword and the form is a note.`,
      },
      exampleUsed: { overlay: 'overlay example used', fallback: 'fallback example used (pass 3: the dictionary example showed another word)', dictionary: 'dictionary example used' },
      translationOverride: (applied: boolean) => (applied ? 'overlay override' : 'dictionary'),
    },
  },
} as const
