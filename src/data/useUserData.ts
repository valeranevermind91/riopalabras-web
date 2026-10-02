import type { SupabaseClient } from '@supabase/supabase-js'
import { useEffect, useState } from 'react'
import type { AuthResult } from '../lib/auth'
import { loadDictionary } from './dictionary'
import { fetchOverlay } from './overlay'
import { parseSettings } from './settings'
import { computeStats, getLearnPool, type Stats } from './stats'
import type { UserSettings, Word } from './types'
import { mergeWords, type MergeDiagnostics } from './words'

export interface UserData {
  words: readonly Word[]
  settings: UserSettings
  stats: Stats
  diagnostics: MergeDiagnostics
  /** First few learn-pool words in serving order, as visible proof of the rank sort. */
  learnPoolPreview: readonly Word[]
}

export type DataState =
  | { status: 'loading' }
  | { status: 'signed-out'; dictionaryCount: number }
  | { status: 'ready'; data: UserData }
  | { status: 'error'; message: string }

type AuthState = { status: 'loading' } | AuthResult

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

export function useUserData(auth: AuthState, client: SupabaseClient | null): DataState {
  const [state, setState] = useState<DataState>({ status: 'loading' })
  const userId = auth.status === 'signed-in' ? auth.userId : null
  const authPending = auth.status === 'loading'

  useEffect(() => {
    let cancelled = false

    // Starts the download immediately (shared promise), so it runs alongside sign-in rather than after it.
    const dictionary = loadDictionary()
    if (authPending) return

    const settle = (next: DataState) => {
      if (!cancelled) setState(next)
    }

    if (!userId || !client) {
      dictionary
        .then((base) => settle({ status: 'signed-out', dictionaryCount: base.length }))
        .catch((err) => settle({ status: 'error', message: errorMessage(err) }))
    } else {
      Promise.all([dictionary, fetchOverlay(client, userId)])
        .then(([base, overlay]) => {
          const merged = mergeWords(base, overlay)
          const settings = parseSettings(overlay.settings)
          const stats = computeStats(merged.words, settings, new Date())
          settle({
            status: 'ready',
            data: {
              words: merged.words,
              settings,
              stats,
              diagnostics: merged.diagnostics,
              learnPoolPreview: getLearnPool(merged.words).slice(0, 8),
            },
          })
        })
        .catch((err) => settle({ status: 'error', message: errorMessage(err) }))
    }

    return () => {
      cancelled = true
    }
  }, [authPending, userId, client])

  return state
}
