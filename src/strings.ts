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
    learnCapReached: 'More tomorrow',
    learnGoalOff: 'Daily goal is 0',
    learnPoolEmpty: 'No new words available',
    reviewWithCount: (n: number) => `Review due words (${n})`,
    reviewNothingDue: 'Nothing to review',
    degradedTables: { user_favorites: 'words set to learn sooner', user_hidden_words: 'known words' } as Record<string, string>,
    degraded: (tables: string[]) => `Couldn't load your ${tables.join(' and ')} yet. Retrying in the background.`,
    degradedHiddenWarning: 'Words you marked as known may still show up until it loads.',
    retryNow: 'Retry now',
    streak: (n: number) => `${n}-day streak`,
    // The one line under the streak: what to do today (src/data/advice.ts). N in reviewFirst is the real number due, which may be more than one session.
    advice: {
      reviewFirst: (n: number) => `Review first — ${n} ${plural(n, { one: 'word is', other: 'words are' })} waiting`,
      learnNew: (n: number) => `Nothing to review — ${n} new ${plural(n, { one: 'word', other: 'words' })} ready`,
      allDoneToday: 'Done for today',
      poolEmpty: 'No new words left — add your own, or practise',
      allClear: 'All caught up',
    },
    // How far today is from counting for the streak (10 cards): shown until the day counts, then nothing.
    streakToday: (done: number, needed: number) => `${done} / ${needed} today`,
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
    searchPlaceholder: 'Search Spanish, English, Russian',
    searchLabel: 'Search words',
    segments: { all: 'All', learned: 'Learned', hidden: 'Known' },
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
    states: { new: 'Not started', learning: 'In progress', established: 'Well learned', due: 'Due now' },
    // One action, one name everywhere (the row's star, the detail button, the filter): "Learn sooner". The star puts a word ahead in Learn and
    // clears itself when Learn has taught the word. It is not a bookmark and not a queue.
    favourites: 'Learn sooner',
    pos: { verb: 'Verbs', noun: 'Nouns', adj: 'Adjectives', adv: 'Adverbs' },
    sorts: { frequency: 'Frequency', az: 'A to Z', due: 'Due soonest', recent: 'Recently learned', random: 'Random' },
    bestMatch: 'Best match',
    // short part-of-speech tags on a row
    posTag: { n: 'noun', v: 'verb', adj: 'adj', adv: 'adv', pron: 'pron', num: 'num', prep: 'prep', determiner: 'det', conj: 'conj', interj: 'interj', letter: 'letter', contraction: 'contr', art: 'art' } as Record<string, string>,
    due: 'Due now',
    stateName: { hidden: 'Known', reference: 'Reference only', due: 'Due now', established: 'Well learned', learning: 'In progress', new: 'Not started' } as Record<string, string>,
    // The star on a list row has no visible text (the translation needs the room); this is its accessible name, the same whether it is pressed or not.
    learnSoonerRow: (word: string) => `Learn ${word} sooner`,
    // The same words on the detail screen's button, pressed or not: the button only looks active, it never claims something happened.
    learnSooner: 'Learn sooner',
    // the user's own words: add (the "+" in the header), edit and delete from the detail
    custom: 'Custom',
    addWord: 'Add a word',
    customMark: 'Added by you',
    editWord: 'Edit',
    deleteWord: 'Delete',
    added: 'Added, and set to learn sooner.',
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
      retry: 'Try the lookup again',
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
      regionHint: 'Where a Rioplatense word is used. Pick “Both countries or unknown” if it is used in both, or you are not sure.',
      regionBoth: 'Both countries or unknown',
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
      busy: 'The translation service is busy right now. Try again in a little while, or type it yourself.',
      // the service's own daily limit: said with the hours left until it starts again (00:00 UTC, so the same moment for everyone)
      capacity: (hours: number) =>
        hours < 1
          ? 'Automatic translation is used up for today. It comes back in less than an hour. Type it yourself, or try again then.'
          : `Automatic translation is used up for today. It comes back in about ${hours} ${plural(hours, { one: 'hour', other: 'hours' })}. Type it yourself, or try again then.`,
      unavailable: 'Automatic translation is unavailable for now. Type the translation yourself.',
      timeout: "The translation service didn't answer in time. Type the translation yourself.",
      network: "Couldn't reach the translation service. Type the translation yourself.",
      noResult: 'The service had no translation for this word. Type it yourself.',
      other: (_status: number | null) => 'The translation service is not working right now. Type the translation yourself.',
    },
    bringBack: 'Bring back',
    bringBackWord: (word: string) => `Bring back ${word}`,
    emptyLearned: 'Nothing learned yet. Start with Learn on the home screen.',
    emptyAll: 'No words.',
    emptyHidden: 'No known words yet. Words you mark with “I already know this word”, or tick in the placement test, appear here.',
    emptyFiltered: 'No words match. Try another search, or clear the filters.',
    clearSearchAndFilters: 'Clear search and filters',
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
      noteHidden: 'Marked as known, so it stays out of Learn, Review and practice. Its progress is kept: if you bring it back, it carries on where it left off.',
      noteReference: (why: string) => `Reference only: ${why}, so it is never in Learn or Review.`,
      reasonPos: 'this kind of word is not drilled',
      reasonNoTranslation: 'it has no translation yet',
    },
  },

  // The gap before a word comes back, as the rating buttons and the word detail abbreviate it ("3d", "2mo").
  interval: {
    // an Again: the word is due again at once (the stored wait is ten minutes; the label promises no clock)
    soon: 'Soon',
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
    // the arithmetic behind the number, not advice: every learned word comes back, so the goal sets the review load (checked against the scheduler in reviewLoad.test.ts)
    dailyGoalWhy: 'Every word you learn comes back for review: at ten new words a day that is roughly 40 to 60 reviews a day within a couple of months. A smaller goal is a real choice, not a lesser one: at five a day the reviews come to about half.',
    decrease: 'Decrease the daily goal',
    increase: 'Increase the daily goal',
    // from 16 up the day is split into Learn batches of 10 (as in the Flutter app)
    sessionsNote: "A goal of 16 or more is split into batches of 10 words, so you'll come back to Learn between them.",
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
    reminder: 'Daily reminder',
    reminderHint: 'Comes at 20:00, and only when something is waiting.',
    reminderDeclined: "Telegram did not allow messages. You can allow them from the bot's chat.",
    reminderFailed: 'Could not save this. Check your connection and try again.',
    // shown under a switch that is on: why nothing arrives (the user cannot change either; turning it off and on again clears them)
    reminderPaused: 'Paused — nothing was studied after several reminders. Turn it off and on to resume.',
    // two steps, in order: pressing Start alone does not clear the flag the job set, switching it off and on again does
    reminderUnreachable: "Open the bot's chat and press Start, then switch this off and on again. Pressing Start alone is not enough.",
    about: 'About',
    aboutApp: 'About Riopalabras',
    bot: 'Open the bot',
    aboutText: 'Learn the Spanish of Uruguay and Argentina one word at a time. Your progress is saved to your account.',
    placementTest: 'Take the placement test',
    placementNone: 'Mark the words you already know, so Learn starts at the right point.',
    placementDone: 'Learn starts from a harder point than the most common words.',
    howItWorks: 'How it works',
    runIntro: 'Run the intro again',
    debug: 'Debug',
    debugLock: 'Lock Debug',
  },

  // About (opened from Settings > About): what the app is, who made it, where its words come from, what happens to the data, how to support it.
  // {tokens} are pieces drawn by the screen (links, an address); the addresses themselves are in src/lib/links.ts.
  about: {
    title: 'About',
    what: { heading: 'What this is', text: "A language for living in Uruguay and Argentina. I didn't have the vocabulary myself — so I made this app." },
    author: { heading: 'Author', name: 'Valeriy Kriukov', telegram: 'Telegram' },
    sources: {
      heading: 'Sources',
      // Only what was checked: the frequencies are hermitdave/FrequencyWords' (CC BY-SA 4.0, its README), the list is doozan/spanish_data's (CC BY 4.0, its LICENSE),
      // and that README credits FreeLing for part-of-speech tagging. The figure is the dictionary's size to the nearest fifty: a test fails when the dictionary moves away from it.
      text: 'The base word list is about 4,750 Spanish words, ranked by how often they appear in film and TV subtitles. The frequencies come from {hermitdave} (CC BY-SA 4.0); the list was taken from {doozan} (CC BY 4.0), which credits FreeLing for part-of-speech tagging. The translations, example sentences and regional notes were made for this app with AI (Google Gemini). The regional notes were partly checked against the DAMER dictionary of the Association of Spanish Language Academies and a questionnaire answered by native speakers in Uruguay.',
      licence: 'The base word list is distributed under {licence}.',
    },
    data: {
      heading: 'Your data',
      text: 'Your progress, your own words and your settings are stored under your Telegram account. The privacy policy lists exactly what is kept and who else receives it; to have your data deleted, write to us.',
      privacy: 'Privacy policy',
      deleteHint: 'To have your data deleted',
    },
    support: { heading: 'Support', text: "It's free; if it helped, you can {coffee}.", coffee: 'buy me a coffee' },
    version: 'Version',
  },

  // The privacy page (privacy.html, at /privacy): short, plain, in a person's voice. Every claim is checked against the code in a test
  // (src/screens/Privacy.test.ts); the account address is drawn from src/lib/links.ts, the last-updated date is src/lib/privacy.ts.
  // Deletion: the owner ran a catalogue query on the live database (2026-10-19): all ten tables that have user_id cascade on delete of the auth user
  // (enrichment_usage, feedback, reminders, review_log, user_daily_metrics, user_favorites, user_hidden_words, user_progress, user_settings, user_words),
  // so the page says deleting the account removes everything stored under it. Telegram's own history and the hosts' logs are outside the database and are said to be.
  // src/screens/Privacy.test.ts fails when the code starts to use a table that is not in that verified list.
  privacy: {
    title: 'Privacy',
    pageTitle: 'Privacy · Riopalabras',
    intro: 'Riopalabras is a free app for learning the Spanish of Uruguay and Argentina, inside Telegram. Here is what it keeps and who else sees it.',
    updated: (date: string) => `Last updated: ${date}`,
    language: 'Language',
    sections: [
      {
        id: 'stored',
        heading: 'What it keeps',
        paragraphs: [
          'Your account comes from your Telegram ID, with your first name and username (if any) and a made-up email-style address like {email}; it is not a real mailbox and nothing is sent to it.',
          "Under it: your progress on each word, your settings, the words you add yourself, and the words you set to Learn sooner or mark as known. Every answer you give is logged (the word, the time, your rating, how long you took), with a summary for each day. Also: today's count of automatic translations, your device's time zone if you switch on the reminder, and what you write to us, with the word, app version, language, screen and Telegram platform.",
          "Not kept: your phone number, contacts, location or passwords. No cookies; unsent changes and your sign-in stay in Telegram's browser storage.",
        ],
      },
      {
        id: 'shared',
        heading: 'Who else sees it',
        paragraphs: [
          "Telegram runs the app (the app loads its script from telegram.org) and tells it who you are. Its bot sends the reminder and passes your messages to the author; the bot's own message carries no name or ID, but the message is stored in the database under your account. Supabase holds the database and sign-in. Vercel serves the app's pages and word list. Railway runs our server, whose log has your Telegram ID at sign-in and your account ID at each lookup, not the word. Exception: if a Gemini reply cannot be parsed, it is logged in full, and it usually contains the word.",
          "A word you add goes to Google's Gemini for translations and an example, with no account details; Google's terms apply. Google Fonts loads the fonts, so Google sees your IP address when the app opens; every host sees it, and the app does not store it.",
        ],
      },
      {
        id: 'ads',
        heading: "What's not here",
        paragraphs: ["No advertising, no analytics, nothing sold. The answer history only runs the app's statistics and scheduling."],
      },
      {
        id: 'delete',
        heading: 'Deleting your data',
        paragraphs: [
          "To have your account and data deleted, write to us (Settings → About → Write to us) or message {handle} on Telegram. The author deletes your account, and that removes everything stored under it: the database is set up so that all of it goes together. Telegram's own history and the hosts' logs follow their rules.",
        ],
      },
    ] as readonly {
      id: string
      heading: string
      paragraphs: readonly string[]
    }[],
  },

  // A note to the developer: from Settings (anything at all), or from a word (a problem with it). It says what travels with the text.
  feedback: {
    open: 'Write to us',
    openHint: 'A bug, an idea, or anything else you would like to say',
    titleGeneral: 'Write to us',
    titleWord: 'Report a problem',
    reportWord: 'Report a problem with this word',
    aboutWord: 'The word',
    fieldGeneral: 'Your message',
    fieldWord: 'What is wrong with this word?',
    placeholderGeneral: 'A bug, an idea, anything at all',
    placeholderWord: 'For example: the translation is wrong, or the example does not fit',
    count: (used: number, max: number) => `${used} / ${max}`,
    // the one line that says exactly what goes with the text (the word only for a report about a word)
    sentWith: (c: { word: string | null; version: string; language: string; screen: string; platform: string }) =>
      `Sent with your message: ${c.word ? `the word “${c.word}”, ` : ''}your account, app version ${c.version}, interface language ${c.language}, screen ${c.screen}, Telegram platform ${c.platform}.`,
    languages: { en: 'English', ru: 'Russian' },
    screens: { settings: 'Settings', word: 'Word' },
    send: 'Send',
    sending: 'Sending…',
    cancel: 'Cancel',
    empty: 'Write something first.',
    failed: 'Could not send it. Your message is still here: try again in a moment.',
    sent: 'Sent. Thank you.',
    discardTitle: 'Discard your message?',
    discardBody: 'What you wrote has not been sent.',
    discard: 'Discard',
    keepWriting: 'Keep writing',
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
        { id: 'words', name: 'Words', text: 'the whole dictionary, with search, filters, words set to learn sooner, and words you add yourself.', tone: 'learn' },
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
      // what ticking does (the same "marked as known" as Learn's button and the Words screen; they wait under Known there)
      hidesNote: 'Words you tick are marked as known and kept out of Learn, Review and practice; you can bring them back from the Known tab.',
      set: (n: number, m: number) => `Set ${n} of ${m}`,
      progress: 'Placement test progress',
      back: 'Back',
      next: 'Continue',
      finish: 'Finish',
      skip: 'Skip',
      skipNote: 'It can be taken later from Settings.',
      unavailable: 'There are not enough new words left for a placement test.',
      // what the test did, said when it is finished (never the start rank itself: a number nobody can read)
      // said once, above the first set: what the test is for (it does not decide anything else about what is taught)
      purpose: 'This test is only here so the app can work out where to start you.',
      // the scale drawn under the set counter and in the result: a search for a starting point, not a score
      scale: { frequent: 'Common words', rare: 'Rare words', start: 'Learn starts here', resultLabel: 'Where Learn will start, among the words from most to least common' },
      resultTitle: 'Test finished',
      resultMarked: (n: number) => `${n} ${plural(n, { one: 'word was', other: 'words were' })} marked as known and will stay out of Learn and Review.`,
      resultNoneMarked: 'No words were marked as known.',
      resultHarder: 'Learn will start from a harder point.',
      resultBeginning: 'Learn will start with the most common words.',
      resultApprox: 'The starting point is approximate and corrects itself: Learn keeps mixing in some easier words, so a wrong guess works itself out within a few days.',
      resultDone: 'Done',
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
        text: 'Learn brings new words, a few at a time, up to your daily goal. Star a word with Learn sooner and Learn takes it before the others: starred words make up most of the new words each day, for as long as there are enough of them. Each card has the word, an example sentence and the translation, and it marks a word that is Rioplatense, or that means something different here. When a batch is finished, the words go on to review. They come back for the first time tomorrow. A word you already know can be marked as known: it then stays out of Learn, Review and the practice exercises.',
      },
      {
        id: 'review',
        heading: 'Review',
        text: 'Review shows the words that are due. Turn a card over, then say how well you knew it: Again, Hard, Good or Easy. That answer decides when the word comes back. A session takes the most overdue words, about twenty at a time; while more are due, Continue starts another.',
      },
      {
        id: 'matching',
        heading: 'Matching',
        text: 'Matching pairs Spanish words with their translations. It uses words you have already learned.',
      },
      {
        id: 'cloze',
        heading: 'Cloze',
        text: 'Cloze shows a sentence with a word missing, and you type that word in. The hint and the answer are one tap away. The words here also come from the ones you have already learned.',
      },
      {
        id: 'spaced',
        heading: 'Why a word comes back',
        text: 'Words come back on a schedule. Each time you get it right the gap grows: a few days, then about a week, then weeks, then months, up to a longest gap of nine months. A word is easiest to hold on to when you see it just as it starts to fade, so every success pushes the next review further out, until it reaches that limit. Again means the word needs another look today: it returns later in this session, or the next time you open the app. The gaps start again from one day. The small label on each rating button tells you when that answer brings the word back.',
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
    // offered once, under the buttons of the end screen after the first finished session
    reminderOffer: 'The words you just learned will come back for review tomorrow. Should we remind you?',
    reminderOfferYes: 'Remind me',
    reminderOfferNo: 'Not now',
    reviewDueWords: (n: number) => `Review due words (${n})`,
    newWordsToday: (n: number, limit: number) => `${n} of ${limit} new words today`,
    capReachedTitle: "Today's new words are done",
    capReachedSubtitle: 'Nice work. Come back tomorrow for more.',
    // why the day's new words stop (shown under the line above, when the daily goal is reached)
    capReachedWhy: "New words are limited each day so that tomorrow's review stays manageable: every word you learn comes back for review, and too many at once pile up.",
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
    sessionDone: 'Session complete',
    sessionLeft: (n: number) => `${n} ${plural(n, { one: 'word is', other: 'words are' })} still due.`,
    continue: 'Continue',
  },

  // Matching and Cloze chrome.
  practice: {
    matchingButton: 'Practice Matching',
    clozeButton: 'Practice Cloze',
    needWords: 'At least 5 words',
    matchingTitle: 'Matching',
    matchingHint: 'Tap a word, then its translation.',
    clozeHint: 'Type the missing word.',
    matchingInsufficient: 'Learn and review some words first, then come back to practice matching.',
    groupComplete: 'Session complete',
    nextGroup: 'New session',
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
    backHome: 'Back to home',
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
    // said on a card whose word looks ordinary and means something else in Rioplatense Spanish (a meaning shift)
    meaningShift: 'A different meaning in this region',
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
