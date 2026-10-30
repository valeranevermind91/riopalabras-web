import type { SettingsPatch, UserSettings } from './types'
import { localDateKey } from './dates'

// "What's new": the entries a person can read under Settings, with a small dot on the gear until they have. It is not a changelog. An entry is written only for a change a
// person would want to be told about: a new mode, a change in how the schedule or the streak works, a new thing they can do. The invisible plumbing, the fixes and the
// copy edits are not entries, however much work they were.
//
// THE QUESTION, asked of every change before it is committed: does this change what a person sees or how a rule works? If yes, an entry is drafted here in both
// languages (the Russian is proofread by the owner before it ships). If no, the commit message says "no entry". Nothing is generated from the commits.
//
// An entry is dated history and never states a current rule: "From 29 October, new accounts start at 5" stays true when the default changes again; "the default is 5" would
// not. The rules as they stand live in "How it works". Newest first. Entries stop being shown after NEWS_EXPIRY_DAYS (see currentNews), so a quiet stretch shows nothing
// rather than a stale list; the file needs no pruning for that, only a cap on its size (whatsNew.test.ts).

/** One language's side of an entry. */
export interface NewsText {
  readonly title: string
  readonly text: string
}

export interface NewsEntry {
  /** A short name that never changes once the entry has shipped. */
  readonly id: string
  /** When the change reached people: 'YYYY-MM-DDTHH:mm', the local time of the person who wrote it. Entries compare as text, so this shape is not optional. */
  readonly at: string
  readonly en: NewsText
  readonly ru: NewsText
}

/** The key in the settings blob that remembers the newest entry a person has opened, so the dot follows the person to a new device. It holds an entry's `at`, nothing about when they looked. */
export const NEWS_SEEN_KEY = 'whats_new_seen'

/** An entry is shown for this many days after its date. */
export const NEWS_EXPIRY_DAYS = 90

/** The most entries the file may hold: with the expiry it is a few months' worth, and a longer file means the pruning was forgotten. */
export const NEWS_FILE_CAP = 30

export const WHATS_NEW: readonly NewsEntry[] = [
  {
    id: 'cloze-lemma',
    at: '2026-10-29T23:03',
    en: {
      title: 'Cloze says which word a form comes from',
      text: 'After Reveal or a wrong answer, Cloze now names the word the form belongs to, for example “vas — from ir”. It does not say the person or the tense yet.',
    },
    ru: {
      title: 'Cloze подсказывает, от какого слова форма',
      text: 'Если вы нажали «Ответ» или ошиблись, Cloze теперь пишет, от какого слова образована форма, например «vas — от ir». Лицо и время он пока не называет.',
    },
  },
  {
    id: 'goal-five',
    at: '2026-10-29T21:13',
    en: {
      title: 'New accounts start with a goal of 5 words',
      text: 'From 29 October, a new account starts with a daily goal of 5 new words instead of 10. If you already use the app, your goal stays as you set it.',
    },
    ru: {
      title: 'В новых аккаунтах цель — 5 слов в день',
      text: 'С 29 октября новый аккаунт начинает с дневной цели в 5 новых слов вместо 10. Если вы уже пользуетесь приложением, ваша цель остается такой, какой вы ее выбрали.',
    },
  },
  {
    id: 'streak-follows-goal',
    at: '2026-10-29T21:12',
    en: {
      title: 'A day counts toward the streak by your goal',
      text: 'Before, a day needed ten cards to count toward the streak. Now it is enough to meet your daily goal, if that is less than ten.',
    },
    ru: {
      title: 'День идет в серию по вашей цели',
      text: 'Раньше для серии нужно было сделать десять карточек. Теперь достаточно выполнить свою дневную цель, если она меньше десяти.',
    },
  },
  {
    id: 'learn-keeps-words',
    at: '2026-10-27T22:29',
    en: {
      title: 'Learn keeps each word as you reach it',
      text: 'Until now a batch was saved only after its last card, so leaving at the seventh of ten saved nothing. A word now counts as soon as you reach its card. When you come back, Learn gives you only the words that are left.',
    },
    ru: {
      title: 'Learn сохраняет слово, как только вы до него дошли',
      text: 'Раньше подборка сохранялась только после последней карточки: если вы ушли на седьмой из десяти, не сохранялось ничего. Теперь слово засчитывается, как только вы дошли до его карточки. Когда вы вернетесь, Learn предложит только оставшиеся слова.',
    },
  },
  {
    id: 'hard-moves-forward',
    at: '2026-10-25T15:20',
    en: {
      title: 'Hard now moves a word forward',
      text: 'On a word you review every day or two, Hard could leave the next review on the same interval for ever. Now each Hard adds at least a day. Words already scheduled stay as they are and change at their next review.',
    },
    ru: {
      title: 'Теперь «Трудно» сдвигает слово вперед',
      text: 'Если слово повторяется каждый день или через день, «Трудно» могло оставлять интервал прежним навсегда. Теперь каждое «Трудно» добавляет хотя бы один день. Слова, которые уже стоят в расписании, остаются как есть — они изменятся на следующем повторении.',
    },
  },
]

/** The entries still shown on `now`: those no older than NEWS_EXPIRY_DAYS (by date, not by the hour). */
export function currentNews(now: Date, entries: readonly NewsEntry[] = WHATS_NEW): readonly NewsEntry[] {
  const oldest = localDateKey(new Date(now.getTime() - NEWS_EXPIRY_DAYS * 86_400_000))
  return entries.filter((entry) => entry.at.slice(0, 10) >= oldest)
}

/** The `at` of the newest of the entries, or null with none. */
export const newestNewsAt = (entries: readonly NewsEntry[]): string | null => entries.reduce<string | null>((newest, entry) => (newest === null || entry.at > newest ? entry.at : newest), null)

/** Whether there is an entry this person has not opened: the dot. Nothing is unread when no entry is current. */
export function hasUnreadNews(settings: Pick<UserSettings, 'whatsNewSeen'>, now: Date, entries: readonly NewsEntry[] = WHATS_NEW): boolean {
  const newest = newestNewsAt(currentNews(now, entries))
  return newest !== null && (settings.whatsNewSeen === null || newest > settings.whatsNewSeen)
}

/** What opening "What's new" writes: the newest current entry's `at`. Null when there is nothing to mark, or it is already marked (opening it again writes nothing). */
export function seenNewsPatch(settings: Pick<UserSettings, 'whatsNewSeen'>, now: Date, entries: readonly NewsEntry[] = WHATS_NEW): SettingsPatch | null {
  return hasUnreadNews(settings, now, entries) ? { [NEWS_SEEN_KEY]: newestNewsAt(currentNews(now, entries)) } : null
}
