import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { REMINDER_OFFER_KEY, REMINDER_OFFER_MAX, offerOutcome, parseReminderOfferShows, reminderOfferAnsweredPatch, reminderOfferShownPatch, shouldOfferReminder } from './reminderOffer'
import { en, type Strings } from '../strings'
import { ru } from '../strings.ru'
import { mergeSettingsRaw, parseSettings } from './settings'

const ready = { status: 'ready', shown: false } as const
const never = { reminderOfferShows: 0 }

describe('whether to offer the daily reminder at the end of a Learn session', () => {
  it('offers it after a finished session, never offered before, with the reminder known to be off', () => {
    expect(shouldOfferReminder({ completed: true, settings: never, reminder: ready })).toBe(true)
  })

  it('does not, after an end screen reached with nothing to learn (no session was finished)', () => {
    expect(shouldOfferReminder({ completed: false, settings: never, reminder: ready })).toBe(false)
  })

  it('offers it again while it has been shown fewer than three times without an answer, and not after the third', () => {
    expect(REMINDER_OFFER_MAX).toBe(3)
    const at = (reminderOfferShows: number) => shouldOfferReminder({ completed: true, settings: { reminderOfferShows }, reminder: ready })
    expect([0, 1, 2, 3, 4].map(at)).toEqual([true, true, true, false, false])
  })

  it('does not, once it has been answered, whichever way (answered is the count at its end)', () => {
    expect(shouldOfferReminder({ completed: true, settings: parseSettings({ reminder_offer_shown: true }), reminder: ready })).toBe(false)
  })

  it('does not, when the reminder is already on (or a change to on is under way)', () => {
    expect(shouldOfferReminder({ completed: true, settings: never, reminder: { status: 'ready', shown: true } })).toBe(false)
  })

  it('does not, while the reminder is still being read or could not be: off is not known', () => {
    expect(shouldOfferReminder({ completed: true, settings: never, reminder: { status: 'loading', shown: false } })).toBe(false)
    expect(shouldOfferReminder({ completed: true, settings: never, reminder: { status: 'unavailable', shown: false } })).toBe(false)
  })

  it('does not, on a screen that has no reminders control', () => {
    expect(shouldOfferReminder({ completed: true, settings: never, reminder: undefined })).toBe(false)
    expect(shouldOfferReminder({ completed: true, settings: never, reminder: null })).toBe(false)
  })
})

describe('the record of the offer: one key, a count until it is answered', () => {
  it('is one key in the settings blob, and only that key', () => {
    expect(REMINDER_OFFER_KEY).toBe('reminder_offer_shown')
    expect(reminderOfferShownPatch(2)).toEqual({ reminder_offer_shown: 2 })
    expect(reminderOfferAnsweredPatch()).toEqual({ reminder_offer_shown: true })
  })

  it('reads a count as that many, `true` (an answer, and what the first version of the offer wrote) as all of them, and anything else as none', () => {
    expect(parseReminderOfferShows(true)).toBe(3)
    expect([1, 2, 3].map(parseReminderOfferShows)).toEqual([1, 2, 3])
    expect(parseReminderOfferShows(7)).toBe(3) // never more than the limit
    for (const odd of [undefined, null, false, 'true', '2', 0, -1, 1.5, NaN, Infinity, {}, []]) expect(parseReminderOfferShows(odd), String(odd)).toBe(0)
  })

  it('reaches the settings as reminderOfferShows, and a blob without the key reads as never offered', () => {
    expect(parseSettings({}).reminderOfferShows).toBe(0)
    expect(parseSettings(null).reminderOfferShows).toBe(0)
    expect(parseSettings({ reminder_offer_shown: true }).reminderOfferShows).toBe(3)
    expect(parseSettings({ reminder_offer_shown: 2 }).reminderOfferShows).toBe(2)
  })

  it('adds nothing but itself to a blob, and leaves what is there', () => {
    expect(mergeSettingsRaw({ daily_new_word_limit: 12, ui_language: 'ru' }, reminderOfferShownPatch(1))).toEqual({ daily_new_word_limit: 12, ui_language: 'ru', reminder_offer_shown: 1 })
    expect(mergeSettingsRaw({ reminder_offer_shown: 2, ui_language: 'ru' }, reminderOfferAnsweredPatch())).toEqual({ ui_language: 'ru', reminder_offer_shown: true })
  })
})

describe('the offer and the Settings toggle are one path', () => {
  // The offer must run exactly what the toggle runs (Telegram's permission, then the row with the time zone), through one function. These pin
  // the wiring, because a copy of that logic in Learn would pass every behaviour test until the two drifted apart.
  const learn = readFileSync('src/screens/Learn.tsx', 'utf8')
  const settings = readFileSync('src/screens/Settings.tsx', 'utf8')
  const app = readFileSync('src/App.tsx', 'utf8')

  it('Learn calls the control\'s set(true) and nothing of the permission or the row itself', () => {
    expect(learn).toContain('reminders.set(true)')
    for (const forbidden of ['turnReminderOn', 'requestMessageAccess', 'requestWriteAccess', 'supabaseReminderStore', 'deviceTimezone', "from('reminders')"]) expect(learn, forbidden).not.toContain(forbidden)
  })

  it('Settings calls the same set, and App hands the one control to both screens', () => {
    expect(settings).toMatch(/reminders\.set\(e\.target\.checked\)/)
    expect(app).toMatch(/const reminders = useReminders\(reminderStore\)/)
    expect(app).toMatch(/<LearnScreen[\s\S]*?reminders=\{reminders\}[\s\S]*?\/>/)
    expect(app).toMatch(/<SettingsScreen[\s\S]*?reminders=\{reminders\}[\s\S]*?\/>/)
  })

  it('the offer records itself in the settings blob only through the write queue, and the reminder state not at all', () => {
    expect(learn).toContain('saveSetting(reminderOfferShownPatch(')
    expect(learn).toContain('saveSetting(reminderOfferAnsweredPatch()')
    expect(learn).not.toMatch(/enqueueSettings\(\{[^}]*reminder/)
  })
})

describe('what the line that replaces the card says', () => {
  it('"No thanks" says where the switch is, whatever the reminder is doing', () => {
    expect(offerOutcome('no', { notice: null, shown: false })).toBe('none')
    expect(offerOutcome('no', { notice: 'declined', shown: false })).toBe('none')
    expect(offerOutcome('no', undefined)).toBe('none')
  })

  it('"Remind me" says it is done when the reminder is on, and what went wrong when it is not', () => {
    expect(offerOutcome('yes', { notice: null, shown: true })).toBe('done')
    expect(offerOutcome('yes', { notice: 'declined', shown: false })).toBe('declined')
    expect(offerOutcome('yes', { notice: 'failed', shown: false })).toBe('failed')
  })

  it('and nothing at all when the "yes" did nothing: neither on nor refused (another change was under way), or there is no control', () => {
    expect(offerOutcome('yes', { notice: null, shown: false })).toBeNull()
    expect(offerOutcome('yes', undefined)).toBeNull()
    expect(offerOutcome('yes', null)).toBeNull()
  })

  it('the paused and unreachable notices belong to a reminder that is on: they do not turn a "yes" into a refusal', () => {
    expect(offerOutcome('yes', { notice: 'paused', shown: true })).toBe('done')
    expect(offerOutcome('yes', { notice: 'unreachable', shown: true })).toBe('done')
  })
})

describe('the words of the offer, its two answers, and the sentence in How it works', () => {
  // the path as the Russian lines write it: the screen in the prepositional case (в Настройках), then the section as it is named (Уведомления); the English is the names as they stand
  const where = { en: `${en.settings.title} → ${en.settings.notifications}`, ru: `Настройках → ${ru.settings.notifications}` }
  const reminders = (map: Strings) => map.howItWorks.sections.find((x) => x.id === 'reminders')!
  /** Every string under a value, with its path. */
  const walk = (value: unknown, path: string): { path: string; text: string }[] =>
    typeof value === 'string' ? [{ path, text: value }] : value && typeof value === 'object' ? Object.entries(value).flatMap(([k, v]) => walk(v, `${path}.${k}`)) : []

  it('names the hour, the same one Settings gives, and says it only comes when something is due', () => {
    expect(en.learn.reminderOffer).toContain('around 20:00')
    expect(en.settings.reminderHint).toContain('20:00')
    expect(ru.learn.reminderOffer).toContain('около 20:00')
    expect(ru.settings.reminderHint).toContain('20:00')
    expect(en.learn.reminderOffer).toContain('only comes on days when something is due')
    expect(ru.learn.reminderOffer).toContain('только в те дни, когда есть что повторять')
  })

  it('the final text of the card and its buttons, in both languages', () => {
    expect(en.learn.reminderOffer).toBe("Tomorrow's reviews will be waiting. Want a reminder around 20:00? It only comes on days when something is due.")
    expect([en.learn.reminderOfferYes, en.learn.reminderOfferNo]).toEqual(['Remind me', 'No thanks'])
    expect(ru.learn.reminderOffer).toBe('Завтра вас ждет повторение. Напомнить около 20:00? Напоминание приходит только в те дни, когда есть что повторять.')
    expect([ru.learn.reminderOfferYes, ru.learn.reminderOfferNo]).toEqual(['Напомнить', 'Не нужно'])
  })

  it('both answers, and the sentence in How it works, say where the switch is, by the names Settings uses', () => {
    for (const [map, key] of [[en, 'en'], [ru, 'ru']] as const) {
      expect(map.learn.reminderOfferDone, key).toContain(where[key])
      expect(map.learn.reminderOfferNone, key).toContain(where[key])
      expect(reminders(map).text, key).toContain(where[key])
    }
    expect(en.learn.reminderOfferDone).toBe('Done: a reminder around 20:00 on days when words are due. You can change this in Settings → Notifications.')
    expect(en.learn.reminderOfferNone).toBe('OK. You can turn it on any time in Settings → Notifications.')
    expect(ru.learn.reminderOfferDone).toBe('Готово: напоминание придет около 20:00 в дни, когда есть что повторять. Изменить это можно в Настройках → Уведомления.')
    expect(ru.learn.reminderOfferNone).toBe('Хорошо. Включить напоминание можно в любой момент в Настройках → Уведомления.')
  })

  it('the Russian path is the Settings screen\'s own name and section: «Настройки» is the title, so «в Настройках» is its prepositional case, and the section is named as it is', () => {
    expect(ru.settings.title).toBe('Настройки')
    expect(ru.settings.notifications).toBe('Уведомления')
    for (const text of [ru.learn.reminderOfferDone, ru.learn.reminderOfferNone, reminders(ru).text]) expect(text).not.toContain('в разделе')
  })

  it('How it works has it as one sentence, in a section of its own after the schedule', () => {
    for (const map of [en, ru]) {
      expect(reminders(map).text.split(/[.!?](?:\s|$)/).filter(Boolean)).toHaveLength(1)
      expect(reminders(map).text).not.toContain('\n')
    }
    expect(en.howItWorks.sections.map((x) => x.id)).toEqual(['learn', 'review', 'matching', 'cloze', 'spaced', 'reminders'])
    expect(ru.howItWorks.sections.map((x) => x.id)).toEqual(en.howItWorks.sections.map((x) => x.id))
    expect([en.howItWorks.sections.at(-1)!.heading, ru.howItWorks.sections.at(-1)!.heading]).toEqual(['Reminders', 'Напоминания'])
  })

  it('writes «ждет» without the «ё»: it does not change the word (the convention in README)', () => {
    expect(ru.learn.reminderOffer).toContain('ждет')
    for (const text of [ru.learn.reminderOffer, ru.learn.reminderOfferDone, ru.learn.reminderOfferNone, reminders(ru).text, reminders(ru).heading]) expect(text).not.toContain('ё')
  })

  it('says nothing about reminders in onboarding, in either language', () => {
    for (const map of [en, ru]) {
      const texts = walk(map.onboarding, 'onboarding')
      expect(texts.length).toBeGreaterThan(20)
      expect(texts.filter((t) => /remind|напомин/i.test(t.text))).toEqual([])
    }
  })
})
