import type { SettingsPatch, UserSettings } from './types'

// The offer to turn on the daily reminder, made at the end of a finished Learn session (see Learn.tsx). What is remembered about it lives in one key of the
// settings blob: how many times it has been shown without an answer, or that it was answered. The reminder itself (on or off, its time zone) is in its own table,
// written by the toggle's path (useReminders.set) and by nothing else.

/** The settings-blob key for the offer. A number is how many times it has been shown with no answer; `true` is "answered" (and what the first version of the offer wrote). */
export const REMINDER_OFFER_KEY = 'reminder_offer_shown'

/** The most times the offer is made when nobody answers it: the end of three finished sessions. An answer, either way, ends it at once. */
export const REMINDER_OFFER_MAX = 3

/**
 * How many times the offer has counted as made, from the blob's value: `true` (answered, or the old yes/no flag) is all of them, a whole number is that many (at most
 * REMINDER_OFFER_MAX), anything else is none.
 */
export function parseReminderOfferShows(value: unknown): number {
  if (value === true) return REMINDER_OFFER_MAX
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? Math.min(value, REMINDER_OFFER_MAX) : 0
}

/** Written the moment the offer shows: it has now been shown `shows` times, answered or not. */
export const reminderOfferShownPatch = (shows: number): SettingsPatch => ({ [REMINDER_OFFER_KEY]: shows })

/** Written when the user answers, yes or no: the offer is over for good. */
export const reminderOfferAnsweredPatch = (): SettingsPatch => ({ [REMINDER_OFFER_KEY]: true })

/**
 * What the line that replaces the card says, from the answer and the reminders control as it stands once the answer is over. "No thanks" is 'none' (the line says where the switch is).
 * "Remind me" is 'declined' (Telegram would not allow messages) or 'failed' (the row could not be saved), which are what Settings says about them, or 'done' when the reminder is on.
 * A "yes" that did nothing (another change was under way, so it is neither on nor refused) has nothing to say: null.
 */
export function offerOutcome(answer: 'yes' | 'no', reminder: { notice: 'declined' | 'failed' | 'paused' | 'unreachable' | null; shown: boolean } | null | undefined): 'none' | 'done' | 'declined' | 'failed' | null {
  if (answer === 'no') return 'none'
  if (reminder?.notice === 'declined') return 'declined'
  if (reminder?.notice === 'failed') return 'failed'
  return reminder?.shown ? 'done' : null
}

/**
 * Whether to make the offer on this end screen: the Learn session was actually finished (not an end screen reached with nothing to learn), it has been made fewer
 * than REMINDER_OFFER_MAX times without an answer, and the reminder is known to be off. A reminder that is still being read (or could not be) is not "off": no offer
 * until it is known. Decided once, when the end screen appears, and kept (it records itself the moment it shows).
 */
export function shouldOfferReminder({
  completed,
  settings,
  reminder,
}: {
  completed: boolean
  settings: Pick<UserSettings, 'reminderOfferShows'>
  reminder: { status: 'loading' | 'ready' | 'unavailable'; shown: boolean } | null | undefined
}): boolean {
  return completed && settings.reminderOfferShows < REMINDER_OFFER_MAX && reminder != null && reminder.status === 'ready' && !reminder.shown
}
