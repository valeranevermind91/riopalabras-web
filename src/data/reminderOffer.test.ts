import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { REMINDER_OFFER_KEY, reminderOfferPatch, shouldOfferReminder } from './reminderOffer'
import { mergeSettingsRaw, parseSettings } from './settings'

const ready = { status: 'ready', shown: false } as const
const never = { reminderOfferShown: false }

describe('whether to offer the daily reminder at the end of a Learn session', () => {
  it('offers it after a finished session, never offered before, with the reminder known to be off', () => {
    expect(shouldOfferReminder({ completed: true, settings: never, reminder: ready })).toBe(true)
  })

  it('does not, after an end screen reached with nothing to learn (no session was finished)', () => {
    expect(shouldOfferReminder({ completed: false, settings: never, reminder: ready })).toBe(false)
  })

  it('does not, once it has been offered, whatever the user answered', () => {
    expect(shouldOfferReminder({ completed: true, settings: { reminderOfferShown: true }, reminder: ready })).toBe(false)
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

describe('the record that it was shown', () => {
  it('is one key in the settings blob, and only that key', () => {
    expect(REMINDER_OFFER_KEY).toBe('reminder_offer_shown')
    expect(reminderOfferPatch()).toEqual({ reminder_offer_shown: true })
  })

  it('reads back as shown only when it is exactly true, and a blob without it reads as not shown', () => {
    expect(parseSettings({}).reminderOfferShown).toBe(false)
    expect(parseSettings(null).reminderOfferShown).toBe(false)
    expect(parseSettings({ reminder_offer_shown: true }).reminderOfferShown).toBe(true)
    for (const odd of [false, 'true', 1, null]) expect(parseSettings({ reminder_offer_shown: odd }).reminderOfferShown).toBe(false)
  })

  it('adds nothing but itself to a blob, and leaves what is there', () => {
    const merged = mergeSettingsRaw({ daily_new_word_limit: 12, ui_language: 'ru' }, reminderOfferPatch())
    expect(merged).toEqual({ daily_new_word_limit: 12, ui_language: 'ru', reminder_offer_shown: true })
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
    expect(learn).toContain('saveSetting(reminderOfferPatch()')
    expect(learn).not.toMatch(/enqueueSettings\(\{[^}]*reminder/)
  })
})
