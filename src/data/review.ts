import { applyReview, type Quality } from '../sm2/sm2'
import { localDateKey } from './dates'
import { streakPatch } from './daily'
import type { MetricsRecorder } from './metrics'
import { isReviewDue } from './stats'
import { wordKey } from './words'
import type { ProgressUpdate, SettingsPatch, UserSettings, Word } from './types'

/** Fisher–Yates. `random` is injectable so tests can pin the order. */
export function shuffle<T>(items: readonly T[], random: () => number = Math.random): T[] {
  const out = [...items]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

/**
 * The cards for one Review session: every word that is due right now, shuffled, no size cap. The
 * result is a snapshot — it is never refreshed mid-session, however the underlying words change.
 */
export function buildReviewSession(words: readonly Word[], now: Date, random?: () => number): readonly Word[] {
  return Object.freeze(shuffle(words.filter((w) => isReviewDue(w, now)), random))
}

/** The word as the rating left it (what the store holds right after): the card a re-queued copy shows is this, not the snapshot taken at the start. */
export function withUpdate(word: Word, update: ProgressUpdate): Word {
  return Object.freeze({ ...word, easeFactor: update.easeFactor, interval: update.interval, repetitions: update.repetitions, nextReview: update.nextReview })
}

/**
 * The session after an Again on the card at `index`: the word, as the rating left it, goes to the very end, so it comes back in the same
 * sitting (however few cards are left, it is last). It is never in the queue twice: a copy still waiting behind `index` is dropped first, so
 * an Again on the copy sends it to the end again instead of piling up. The cards before and at `index` stay as they were.
 */
export function requeueAgain(session: readonly Word[], index: number, updated: Word): readonly Word[] {
  const key = wordKey(updated.esWord)
  return Object.freeze([...session.filter((w, i) => i <= index || wordKey(w.esWord) !== key), updated])
}

/** The SM-2 result of rating a word, shaped for the store and for user_progress. */
export function rateWord(word: Word, quality: Quality, now: Date): ProgressUpdate {
  const next = applyReview(word, quality, now)
  return {
    esWord: word.esWord,
    easeFactor: next.easeFactor,
    interval: next.interval,
    repetitions: next.repetitions,
    nextReview: next.nextReview,
  }
}

export interface RaterDeps {
  /** Optimistic: mirror the new state into the in-memory words right away. */
  applyProgress: (updates: readonly ProgressUpdate[]) => void
  applySettings: (patch: SettingsPatch) => void
  getSettings: () => UserSettings
  queue: {
    enqueueProgress: (update: ProgressUpdate) => void
    enqueueSettings: (patch: SettingsPatch) => void
  }
  /** Optional: today's metrics row. Recording never throws, so it can't stand in the way of a rating. */
  metrics?: Pick<MetricsRecorder, 'recordReviewRating'>
}

/**
 * Handles a rating: applies it to the in-memory store immediately, queues the write, and records the
 * day's streak. The streak is a settings write, so it is sent only when the streak state actually
 * changes — the first rating of a local day — never once per card.
 */
export function createRater(deps: RaterDeps) {
  let streakCheckedFor: string | null = null

  return function rate(word: Word, quality: Quality, now: Date = new Date()): ProgressUpdate {
    const update = rateWord(word, quality, now)
    deps.applyProgress([update])
    deps.queue.enqueueProgress(update)

    const today = localDateKey(now)
    if (streakCheckedFor !== today) {
      streakCheckedFor = today
      const patch = streakPatch(deps.getSettings(), now)
      if (patch) {
        deps.applySettings(patch)
        deps.queue.enqueueSettings(patch)
      }
    }

    // After the streak: the metrics row mirrors today's counters, which the streak write doesn't touch.
    deps.metrics?.recordReviewRating(quality, now)

    return update
  }
}
