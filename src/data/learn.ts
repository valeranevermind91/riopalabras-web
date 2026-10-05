import type { SupabaseClient } from '@supabase/supabase-js'
import { learnedState } from '../sm2/sm2'
import { newWordsPatch, streakPatch } from './daily'
import { headword } from './headword'
import { computeRemainingToday, getLearnPool } from './stats'
import type { ProgressUpdate, SettingsPatch, UserSettings, Word } from './types'
import { upsertProgress, writeSettings } from './writes'

export const LEARN_BATCH_SIZE = 10

export interface LearnBatch {
  readonly words: readonly Word[]
  /** Words in the batch that were never learned before — fixed when the batch is built, so a retry can't recount. */
  readonly newCount: number
}

/**
 * Next Learn batch: min(10, remainingToday) words from the pool in rank order. Two words that
 * would show the same headword never share a batch; the skipped one stays in the pool for a later
 * batch, and scanning continues until the batch is full. learn_picks are ignored for now.
 */
export function selectLearnBatch(words: readonly Word[], settings: UserSettings, now: Date): LearnBatch {
  const limit = Math.min(LEARN_BATCH_SIZE, computeRemainingToday(settings, now))
  const batch: Word[] = []
  const used = new Set<string>()

  if (limit > 0) {
    for (const word of getLearnPool(words)) {
      const key = headword(word).text.toLowerCase()
      if (used.has(key)) continue
      used.add(key)
      batch.push(word)
      if (batch.length >= limit) break
    }
  }

  return { words: batch, newCount: batch.filter((w) => w.repetitions === 0).length }
}

export function learnProgressUpdates(batch: LearnBatch, now: Date): ProgressUpdate[] {
  const state = learnedState(now)
  return batch.words.map((word) => ({
    esWord: word.esWord,
    easeFactor: state.easeFactor,
    interval: state.interval,
    repetitions: state.repetitions,
    nextReview: state.nextReview,
  }))
}

export function learnSettingsPatch(settings: UserSettings, batch: LearnBatch, now: Date): SettingsPatch {
  return {
    ...streakPatch(settings, now),
    ...newWordsPatch(settings, batch.newCount, now),
  }
}

export interface FinishDeps {
  client: SupabaseClient
  userId: string
  /** Always the latest settings (read at call time, not captured). */
  getSettings: () => UserSettings
  applyProgress: (updates: readonly ProgressUpdate[]) => void
  applySettings: (patch: SettingsPatch) => void
  /** Called once, after both writes succeeded and were applied (so today's counters are current). Must not throw. */
  onFinished?: () => void
}

/**
 * Finishing a batch is two writes: progress for every word, then settings (streak + today's
 * counter). Returns a function that runs the steps in order and is safe to call again after a
 * failure: a retry resumes at the step that failed (progress is never rewritten once saved, and
 * the counter is computed from the batch snapshot, so nothing is double-counted). While a run is in
 * flight, further calls get the same promise, and once it has fully succeeded further calls do
 * nothing — a double-tap can't submit twice.
 */
export function createBatchFinisher(batch: LearnBatch, deps: FinishDeps): () => Promise<void> {
  let progressSaved = false
  let done = false
  let inFlight: Promise<void> | null = null

  const run = async () => {
    const now = new Date()

    if (!progressSaved) {
      const updates = learnProgressUpdates(batch, now)
      await upsertProgress(deps.client, deps.userId, updates, now)
      deps.applyProgress(updates)
      progressSaved = true
    }

    const settings = deps.getSettings()
    const patch = learnSettingsPatch(settings, batch, now)
    if (Object.keys(patch).length > 0) {
      await writeSettings(deps.client, deps.userId, settings, patch, now)
      deps.applySettings(patch)
    }
    done = true
    deps.onFinished?.()
  }

  return () => {
    if (done) return Promise.resolve()
    inFlight ??= run().finally(() => {
      inFlight = null
    })
    return inFlight
  }
}
