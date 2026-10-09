// Strings that are the same in both interface languages, so each map just points at them:
//  - `debug`: the Debug screen stays English (it is a developer tool).
//  - `card` and `wordContent`: word content, not interface. They have an `en` and a `ru` half in both maps and are picked by the
//    translation flags (see data/translations.ts), not by the interface language.

export const card = {
  en: 'EN',
  ru: 'RU',
} as const

// Word-related text that follows the translation flags (see data/translations.ts), not the UI language. Only the Cloze nudge for now.
export const wordContent = {
  en: {
    // Cloze nudge when the headword was typed instead of the form in the sentence
    inSentence: (form: string) => `in this sentence: ${form}`,
  },
  ru: {
    inSentence: (form: string) => `в этом предложении: ${form}`,
  },
} as const

export const debug = {
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
      'own-rioplatense': 'A word the user added and marked as Rioplatense: the typed word is the Rioplatense form.',
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
} as const
