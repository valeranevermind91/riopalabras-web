import { selectLearnBatch } from './learn'
import { QUEUED, isLowerStratum } from './learnPick'
import type { UserSettings, Word } from './types'

/** Where a word of the batch came from: the user's queue, the window from start_rank on, or the range skipped below start_rank. */
export type PreviewSource = 'queued' | 'window' | 'below'

export interface PreviewEntry {
  esWord: string
  rank: number | null
  source: PreviewSource
}

export interface LearnPreview {
  startRank: number | null
  entries: PreviewEntry[]
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
    entries: batch.words.map((word, i) => ({
      esWord: word.esWord,
      rank: word.rank,
      source: batch.strata[i] === QUEUED ? 'queued' : isLowerStratum(batch.strata[i]) ? 'below' : 'window',
    })),
  }
}

const SOURCE_LABEL: Record<PreviewSource, string> = { queued: 'queued', window: 'window (from start_rank)', below: 'below start_rank' }

/** One line per word: "2430  palabra  (window (from start_rank))". */
export function previewLine(entry: PreviewEntry): string {
  return `${entry.rank ?? '—'}  ${entry.esWord}  (${SOURCE_LABEL[entry.source]})`
}
