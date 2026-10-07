import type { Lang, Localized } from './rio'
import type { UserSettings } from './types'

/**
 * The one rule for which translation a user sees, used by every surface:
 *
 *   - Enabled languages are the two flags, in the order RU then EN.
 *   - A surface that can show several lines (a card, a detail, a cue) shows one line per enabled language that has text.
 *   - A surface with room for only one line (a list row, a gloss, prose) uses the first enabled language that has text.
 *   - If no enabled language has text, it falls back to whichever language does (RU first), rather than showing nothing
 *     or a dash. That is the only fallback, and it is here.
 *
 * (It is the Flutter app's resolveClozeCueLines, generalised from the Cloze cue to every surface.)
 */
export interface TranslationFlags {
  readonly showRuTranslation: boolean
  readonly showEnTranslation: boolean
}

export type TranslationSettings = Pick<UserSettings, 'showRuTranslation' | 'showEnTranslation'>

export interface TranslationLine {
  readonly lang: Lang
  readonly label: 'RU' | 'EN'
  readonly text: string
}

export type Texts = Readonly<Partial<Record<Lang, string | null | undefined>>>

const LABEL = { ru: 'RU', en: 'EN' } as const

/** The enabled languages, RU then EN. */
export function enabledLanguages(flags: TranslationFlags): Lang[] {
  return [...(flags.showRuTranslation ? (['ru'] as const) : []), ...(flags.showEnTranslation ? (['en'] as const) : [])]
}

const present = (value: string | null | undefined): string | null => {
  const text = value?.trim()
  return text ? text : null
}

/** The lines of a multi-line surface: one per enabled language that has text; if there are none, the language that has text. */
export function translationLines(texts: Texts, flags: TranslationFlags): TranslationLine[] {
  const lines: TranslationLine[] = []
  for (const lang of enabledLanguages(flags)) {
    const text = present(texts[lang])
    if (text) lines.push({ lang, label: LABEL[lang], text })
  }
  if (lines.length > 0) return lines
  for (const lang of ['ru', 'en'] as const) {
    const text = present(texts[lang])
    if (text) return [{ lang, label: LABEL[lang], text }]
  }
  return []
}

/** The line of a single-line surface: the first of those, or null when the word has no text in either language. */
export function firstTranslation(texts: Texts, flags: TranslationFlags): TranslationLine | null {
  return translationLines(texts, flags)[0] ?? null
}

/**
 * The overlay's note / meaning text for a block with room for every enabled language: one paragraph per enabled language that
 * has text, RU first (or the language that has text, if no enabled one does). Empty when there is none.
 */
export function pickLocalizedAll(value: Localized | null, flags: TranslationFlags): string[] {
  if (!value) return []
  return translationLines({ ru: value.ru, en: value.en }, flags).map((line) => line.text)
}
