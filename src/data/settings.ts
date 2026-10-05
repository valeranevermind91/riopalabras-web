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
    showEnTranslation: bool(raw.show_en_translation, false),
    themeChoice: parseThemeChoice(raw[THEME_SETTING_KEY]),
    learnPicks: strings(raw.learn_picks),
    pendingWordDeletes: strings(raw.pending_word_deletes),
    raw,
  }
}
