import { selectLearnBatch } from './learn'
import { getLearnPool, computeRemainingToday } from './stats'
import { QUEUED, isLowerStratum } from './learnPick'
import type { UserSettings, Word } from './types'

/** Where a word of the batch came from: the user's queue, the window from start_rank on, or the range skipped below start_rank. */
export type PreviewSource = 'queued' | 'window' | 'below'

export interface PreviewEntry {
  esWord: string
  rank: number | null
  source: PreviewSource
}

/**
 * Why a batch is empty. The first match wins, in this order: the day's limit is used up (the common case, whatever is in the pool); the pool
 * has nothing in it; nothing is left from start_rank on and nothing below it either (the pool is empty and a start_rank is set).
 */
export type EmptyReason =
  | { kind: 'limit'; limit: number }
  | { kind: 'pool' }
  | { kind: 'beyondStart'; startRank: number }
  | { kind: 'unknown' }

export interface LearnPreview {
  startRank: number | null
  entries: PreviewEntry[]
  /** Null when the batch has words. */
  empty: EmptyReason | null
}

/**
 * What Learn would hand out right now, for Debug: the real selectLearnBatch on the same words and settings, in the order the batch
 * presents them. Read-only: selecting a batch changes nothing (a batch is only consumed when it is finished), so looking does not change what
 * Learn then shows.
 */
export function previewLearnBatch(words: readonly Word[], settings: UserSettings, now: Date): LearnPreview {
  const batch = selectLearnBatch(words, settings, now)
  return {
    startRank: settings.startRank,
    empty: batch.words.length > 0 ? null : emptyReason(words, settings, now),
    entries: batch.words.map((word, i) => ({
      esWord: word.esWord,
      rank: word.rank,
      source: batch.strata[i] === QUEUED ? 'queued' : isLowerStratum(batch.strata[i]) ? 'below' : 'window',
    })),
  }
}

function emptyReason(words: readonly Word[], settings: UserSettings, now: Date): EmptyReason {
  if (computeRemainingToday(settings, now) <= 0) return { kind: 'limit', limit: settings.dailyNewWordLimit }
  if (getLearnPool(words).length === 0) return settings.startRank === null ? { kind: 'pool' } : { kind: 'beyondStart', startRank: settings.startRank }
  return { kind: 'unknown' } // a batch can only be empty for the reasons above: if this shows, the selection and this explanation disagree
}

/** The line shown instead of the list when the batch is empty. */
export function emptyMessage(reason: EmptyReason): string {
  switch (reason.kind) {
    case 'limit':
      return `(empty: the daily limit is reached, ${reason.limit} new ${reason.limit === 1 ? 'word' : 'words'} a day)`
    case 'pool':
      return '(empty: nothing is left in the pool at all)'
    case 'beyondStart':
      return `(empty: nothing is left from start_rank ${reason.startRank} on, and nothing below it either)`
    case 'unknown':
      return '(empty, and no reason was found: the selection and this explanation disagree)'
  }
}

const SOURCE_LABEL: Record<PreviewSource, string> = { queued: 'queued', window: 'window (from start_rank)', below: 'below start_rank' }

/** One line per word: "2430  palabra  (window (from start_rank))". */
export function previewLine(entry: PreviewEntry): string {
  return `${entry.rank ?? '—'}  ${entry.esWord}  (${SOURCE_LABEL[entry.source]})`
}
