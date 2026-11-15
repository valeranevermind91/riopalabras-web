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
    id: 'dictionary-cleanup',
    at: '2026-11-15T20:05',
    en: {
      title: 'Dictionary clean-up',
      text: 'We removed seven entries that are not words to learn on their own, like “house”, “charles”, “miro” and “repente”. “malo”, “federal” and “católico” are adjectives now, and “te”, “mi”, “mía”, “tuya”, “i” and “t” are marked “Reference only”, so Learn no longer offers them. “veras” became “de veras” and “gana” became “ganas”.',
    },
    ru: {
      title: 'Чистка словаря',
      text: 'Убрали семь записей, которые не стоит учить как отдельные слова, например «house», «charles», «miro» и «repente». «malo», «federal» и «católico» теперь прилагательные, а «te», «mi», «mía», «tuya», «i» и «t» отмечены «Только для справки», поэтому Learn их больше не предлагает. «veras» стало «de veras», а «gana» — «ganas».',
    },
  },
  {
    id: 'noun-articles',
    at: '2026-11-15T19:40',
    en: {
      title: 'Nouns now show their article',
      text: 'Cards for Spanish nouns now show el or la before the word — “la casa”, “el agua”, “el/la estudiante” — so you learn the gender along with the word. In Cloze you can type the article too: “casa” and “la casa” both count. A few words whose gender depends on the meaning, like “capital” and “orden”, show no article.',
    },
    ru: {
      title: 'У существительных появился артикль',
      text: 'На карточках существительных перед словом теперь стоит el или la — «la casa», «el agua», «el/la estudiante»: род запоминается вместе со словом. В Cloze артикль можно печатать: засчитываются и «casa», и «la casa». У нескольких слов, род которых зависит от значения, например «capital» и «orden», артикля нет.',
    },
  },
  {
    id: 'reviews-for-today',
    at: '2026-11-14T22:01',
    en: {
      title: 'Today’s reviews, not the whole backlog',
      text: 'When more than 20 words are due, Home and the evening reminder show how many to review today — “20 of 112” — not the whole list. Reminders that stopped after seven unanswered ones now resume by themselves when you study again.',
    },
    ru: {
      title: 'Повторение: сколько на сегодня',
      text: 'Если на повторение накопилось больше 20 слов, главный экран и вечернее напоминание показывают, сколько повторить сегодня — «20 из 112», а не весь список. Напоминания, которые остановились после семи без ответа, теперь возобновляются сами, когда вы снова занимаетесь.',
    },
  },
  {
    id: 'clearer-buttons-and-placement-hint',
    at: '2026-11-08T22:39',
    en: {
      title: 'Clearer buttons and hints',
      text: 'Buttons are clearer: “Hide: already known or not needed” in Learn and “Add to learning queue” instead of the star. Home has captions under the tiles, and Review explains the ratings. Undo after hiding lasts longer. If you hide many words at the start of a batch, Learn suggests the placement test.',
    },
    ru: {
      title: 'Понятнее кнопки и подсказки',
      text: 'Кнопки стали понятнее: «Скрыть: уже знаю или не нужно» в Learn и «Добавить в очередь изучения» вместо звездочки. На главной появились подписи под плитками, а в Review — пояснение к оценкам. «Отменить» после скрытия держится дольше. Если в начале подборки вы скрываете много слов, Learn предложит пройти входной тест.',
    },
  },
  {
    id: 'own-words-and-dictionary',
    at: '2026-11-07T17:22',
    en: {
      title: 'Your own words work better; the dictionary is closer to Rioplatense',
      text: 'Adding a word no longer opens the card of another word, and after you edit a word, its highlight in the example and Cloze work right away. Based on your feedback we fixed part of the dictionary: “manejar” instead of “conducir”, “chico” instead of “pequeño”, removed English words (“boy”, “baby”, “wow”) and replaced awkward examples.',
    },
    ru: {
      title: 'Свои слова работают надежнее, а словарь ближе к Риоплате',
      text: 'При добавлении своего слова больше не открывается карточка другого слова, а после правки слова подсветка в примере и Cloze работают сразу. По вашим отзывам поправили часть словаря: «manejar» вместо «conducir», «chico» вместо «pequeño», убрали английские слова («boy», «baby», «wow»), заменили неудачные примеры.',
    },
  },
  {
    id: 'add-from-search',
    at: '2026-11-01T21:50',
    en: {
      title: 'Add a word right from the search',
      text: 'When you search the Words list for a single Spanish word and it is not there, the list now offers to add it: tap “Add … as your own Spanish word” and the add form opens with the word already typed in.',
    },
    ru: {
      title: 'Слово можно добавить прямо из поиска',
      text: 'Если вы искали в списке Words испанское слово и его там нет, список предложит добавить его: нажмите «Добавить … как свое испанское слово», и форма откроется с уже введенным словом.',
    },
  },
  {
    id: 'local-headwords-ten',
    at: '2026-11-01T00:30',
    en: {
      title: 'Ten more cards lead with the word people say here',
      text: 'Ten cards that opened with the word used in Spain now open with the one used here: “lentes” instead of gafas, “placard” instead of armario, “jean” instead of vaquero, “gurí” instead of crío. The sentence on each card shows the local word too.',
    },
    ru: {
      title: 'Еще десять карточек начинаются со слова, которое говорят здесь',
      text: 'Десять карточек начинались со слова, принятого в Испании. Теперь они начинаются со слова, которое говорят здесь: «lentes» вместо «gafas», «placard» вместо «armario», «jean» вместо «vaquero», «gurí» вместо «crío». Предложение на каждой карточке тоже показывает местное слово.',
    },
  },
  {
    id: 'home-practice',
    at: '2026-10-30T22:58',
    en: {
      title: 'Matching and Cloze are under Practice',
      text: 'On Home, Matching and Cloze now open from one Practice button: tap it and they appear in a panel under the buttons. Below the buttons there is also a line with the new words you have learned today and your daily goal.',
    },
    ru: {
      title: 'Matching и Cloze теперь в Practice',
      text: 'На главном экране Matching и Cloze теперь открываются с одной кнопки Practice: нажмите на нее, и они появятся в панели под кнопками. Под кнопками также есть строка: сколько новых слов вы выучили сегодня и какая у вас дневная цель.',
    },
  },
  {
    id: 'cloze-verb-forms',
    at: '2026-10-30T18:09',
    en: {
      title: 'Cloze accepts other forms of a verb',
      text: 'If the sentence needs “tenés”, typing “tienes” or “tuve” now counts as right, and the sentence shows “tenés” in place. This works for most verbs; a few irregular ones are not covered yet, and for those the dictionary form still counts.',
    },
    ru: {
      title: 'Cloze принимает другие формы глагола',
      text: 'Если в предложении нужно «tenés», ответ «tienes» или «tuve» засчитывается, а в предложении появляется «tenés». Это работает для большинства глаголов; для нескольких неправильных пока нет, и там по-прежнему засчитывается словарная форма.',
    },
  },
  {
    id: 'cloze-any-form',
    at: '2026-10-30T17:23',
    en: {
      title: 'Cloze accepts the dictionary form of the word',
      text: 'If the sentence needs “vas”, typing “ir” counts as right, and “vas” then appears in the sentence. The line under the question now says so: “Type the missing word, in any form.”',
    },
    ru: {
      title: 'Cloze принимает слово в словарной форме',
      text: 'Если в предложении нужно «vas», ответ «ir» засчитывается, а в предложении появляется «vas». Строка под вопросом теперь так и говорит: «Впишите пропущенное слово — в любой форме».',
    },
  },
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
