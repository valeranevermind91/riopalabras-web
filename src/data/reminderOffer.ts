import type { SettingsPatch, UserSettings } from './types'

// The offer to turn on the daily reminder, made once, at the end of a finished Learn session (see Learn.tsx). That it was made is the one thing
// about reminders that lives in the settings blob: the reminder itself (on or off, its time zone) is in its own table, written by the toggle's
// path (useReminders.set) and by nothing else.

/** The settings-blob key that says the offer has been shown, whichever way the user answered it. */
export const REMINDER_OFFER_KEY = 'reminder_offer_shown'

export const reminderOfferPatch = (): SettingsPatch => ({ [REMINDER_OFFER_KEY]: true })

/**
 * Whether to make the offer on this end screen: the Learn session was actually finished (not an end screen reached with nothing to learn),
 * it has never been made before, and the reminder is known to be off. A reminder that is still being read (or could not be) is not "off":
 * no offer until it is known. Decided once, when the end screen appears, and kept (it records itself the moment it shows).
 */
export function shouldOfferReminder({
  completed,
  settings,
  reminder,
}: {
  completed: boolean
  settings: Pick<UserSettings, 'reminderOfferShown'>
  reminder: { status: 'loading' | 'ready' | 'unavailable'; shown: boolean } | null | undefined
}): boolean {
  return completed && !settings.reminderOfferShown && reminder != null && reminder.status === 'ready' && !reminder.shown
}
