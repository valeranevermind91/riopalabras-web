import { LANGUAGE_SETTING_KEY, parseUiLanguage } from '../lib/language'
import { THEME_SETTING_KEY, parseThemeChoice } from '../lib/theme'
import type { UserSettings } from './types'

function num(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value ? value : null
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : []
}

export function parseSettings(blob: Record<string, unknown> | null): UserSettings {
  const raw = blob ?? {}
  return {
    dailyNewWordLimit: num(raw.daily_new_word_limit, 10),
    streakCount: num(raw.streak_count, 0),
    streakLastActivityDate: str(raw.streak_last_activity_date),
    newWordsLearnedTodayCount: num(raw.new_words_learned_today_count, 0),
    newWordsLearnedTodayDate: str(raw.new_words_learned_today_date),
    showRuTranslation: bool(raw.show_ru_translation, true),
    // Absent means on: both languages, as the cards always showed. An explicit false (set from the Flutter app) stays off.
    showEnTranslation: bool(raw.show_en_translation, true),
    themeChoice: parseThemeChoice(raw[THEME_SETTING_KEY]),
    uiLanguage: parseUiLanguage(raw[LANGUAGE_SETTING_KEY]),
    startRank: typeof raw.start_rank === 'number' && Number.isFinite(raw.start_rank) && raw.start_rank > 1 ? raw.start_rank : null,
    learnPicks: strings(raw.learn_picks),
    pendingWordDeletes: strings(raw.pending_word_deletes),
    raw,
  }
}

/**
 * The settings blob with a patch laid over it. A key whose value in the patch is `null` is REMOVED from the blob (the one way to take a key out
 * through the settings lane: null survives the queue's storage and the restore, which an undefined value would not). Every other key is set.
 */
export function mergeSettingsRaw(raw: Readonly<Record<string, unknown>>, patch: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...raw }
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) delete merged[key]
    else merged[key] = value
  }
  return merged
}
