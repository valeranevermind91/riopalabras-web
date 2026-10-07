import type { SupabaseClient } from '@supabase/supabase-js'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { AuthState } from '../lib/auth'
import { loadDictionary } from './dictionary'
import { applyFavoriteFlag, applyFlagLists, applyHiddenFlag, applyProgressUpdates, applySettingsPatch } from './mutations'
import { loadOverlay, recoverTables, type NonCriticalTable } from './overlay'
import { createBackgroundRetrier, type Retrier } from './recovery'
import { parseSettings } from './settings'
import { computeStats, getLearnPool, type Stats } from './stats'
import type { ProgressUpdate, SettingsPatch, UserSettings, Word } from './types'
import { mergeWords, type MergeDiagnostics } from './words'

export interface UserData {
  words: readonly Word[]
  settings: UserSettings
  stats: Stats
  diagnostics: MergeDiagnostics
  /** First few learn-pool words in serving order, as visible proof of the rank sort. */
  learnPoolPreview: readonly Word[]
  /** The latest in-memory settings, for code that outlives a render (e.g. a write that retries). */
  getSettings: () => UserSettings
  /** Mirror a successful progress write into the in-memory words. */
  applyProgress: (updates: readonly ProgressUpdate[]) => void
  /** Mirror a successful settings write into the in-memory settings (unknown keys kept). */
  applySettings: (patch: SettingsPatch) => void
  /** Mirror a hide / un-hide ("already know it") into the in-memory words, at once. */
  applyHidden: (esWords: readonly string[], hidden: boolean) => void
  /** Mirror a favourite / un-favourite into the in-memory words, at once. */
  applyFavorite: (esWords: readonly string[], favorite: boolean) => void
  /** Non-critical tables (favorites, hidden words) that failed at launch and are still being retried in the background. */
  degraded: readonly NonCriticalTable[]
  /** Retry the degraded tables now instead of waiting for the next background attempt. */
  retryDegraded: () => void
}

export type DataState =
  | { status: 'loading' }
  | { status: 'signed-out'; dictionaryCount: number }
  | { status: 'ready'; data: UserData }
  | { status: 'error'; message: string }

interface Loaded {
  words: readonly Word[]
  settings: UserSettings
  diagnostics: MergeDiagnostics
  degraded: readonly NonCriticalTable[]
}

type Base =
  | { status: 'loading' }
  | { status: 'signed-out'; dictionaryCount: number }
  | { status: 'ready'; loaded: Loaded }
  | { status: 'error'; message: string }

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/**
 * `holdLoad`: true while the user's state must not be read yet (the app is still sending writes a killed webview left
 * behind: the server has to have them before we read them back). The sign-in itself is not held.
 */
export function useUserData(auth: AuthState, client: SupabaseClient | null, holdLoad = false): DataState {
  const [base, setBase] = useState<Base>({ status: 'loading' })
  const userId = auth.status === 'signed-in' ? auth.userId : null
  const authPending = auth.status === 'loading'

  useEffect(() => {
    let cancelled = false

    // Starts the download immediately (shared promise), so it runs alongside sign-in rather than after it.
    const dictionary = loadDictionary()
    if (authPending || holdLoad) return

    const settle = (next: Base) => {
      if (!cancelled) setBase(next)
    }

    if (!userId || !client) {
      dictionary
        .then((words) => settle({ status: 'signed-out', dictionaryCount: words.length }))
        .catch((err) => settle({ status: 'error', message: errorMessage(err) }))
    } else {
      // loadOverlay retries transient failures itself; only a critical table that still fails ends up in the catch.
      Promise.all([dictionary, loadOverlay(client, userId)])
        .then(([words, { overlay, degraded }]) => {
          const merged = mergeWords(words, overlay)
          settle({
            status: 'ready',
            loaded: {
              words: merged.words,
              settings: parseSettings(overlay.settings),
              diagnostics: merged.diagnostics,
              degraded,
            },
          })
        })
        .catch((err) => settle({ status: 'error', message: errorMessage(err) }))
    }

    return () => {
      cancelled = true
    }
  }, [authPending, holdLoad, userId, client])

  const applyProgress = useCallback((updates: readonly ProgressUpdate[]) => {
    setBase((prev) =>
      prev.status === 'ready'
        ? { status: 'ready', loaded: { ...prev.loaded, words: applyProgressUpdates(prev.loaded.words, updates) } }
        : prev,
    )
  }, [])

  // Declared first: applySettings updates it eagerly (see below).
  const latestSettings = useRef<UserSettings | null>(null)
  const applyHidden = useCallback((esWords: readonly string[], hidden: boolean) => {
    setBase((prev) =>
      prev.status === 'ready' ? { status: 'ready', loaded: { ...prev.loaded, words: applyHiddenFlag(prev.loaded.words, esWords, hidden) } } : prev,
    )
  }, [])

  const applyFavorite = useCallback((esWords: readonly string[], favorite: boolean) => {
    setBase((prev) =>
      prev.status === 'ready' ? { status: 'ready', loaded: { ...prev.loaded, words: applyFavoriteFlag(prev.loaded.words, esWords, favorite) } } : prev,
    )
  }, [])

  const applySettings = useCallback((patch: SettingsPatch) => {
    // Eager, so a read right after the write (getSettings) already sees it, not only after the next render.
    if (latestSettings.current) latestSettings.current = applySettingsPatch(latestSettings.current, patch)
    setBase((prev) =>
      prev.status === 'ready'
        ? { status: 'ready', loaded: { ...prev.loaded, settings: applySettingsPatch(prev.loaded.settings, patch) } }
        : prev,
    )
  }, [])

  const loaded = base.status === 'ready' ? base.loaded : null

  // Degraded mode: the app is already usable; favorites / hidden words keep being retried in the background.
  const degradedKey = loaded?.degraded.join(',') ?? ''
  const retrier = useRef<Retrier | null>(null)
  useEffect(() => {
    if (!client || !userId || degradedKey === '') return
    const tables = degradedKey.split(',') as NonCriticalTable[]
    let cancelled = false
    const current = createBackgroundRetrier({
      run: async () => {
        const result = await recoverTables(client, userId, tables)
        if (cancelled) return true
        if (result.favorites || result.hidden) {
          setBase((prev) =>
            prev.status === 'ready'
              ? { status: 'ready', loaded: { ...prev.loaded, words: applyFlagLists(prev.loaded.words, result), degraded: result.failed } }
              : prev,
          )
        }
        return result.failed.length === 0
      },
    })
    retrier.current = current
    current.start()
    return () => {
      cancelled = true
      current.stop()
      if (retrier.current === current) retrier.current = null
    }
  }, [client, userId, degradedKey])
  const retryDegraded = useCallback(() => retrier.current?.retryNow(), [])

  const loadedSettings = loaded?.settings ?? null
  useEffect(() => {
    latestSettings.current = loadedSettings
  })
  const getSettings = useCallback(() => {
    if (!latestSettings.current) throw new Error('Settings are not loaded')
    return latestSettings.current
  }, [])

  return useMemo<DataState>(() => {
    if (base.status !== 'ready' || !loaded) return base as DataState
    return {
      status: 'ready',
      data: {
        words: loaded.words,
        settings: loaded.settings,
        stats: computeStats(loaded.words, loaded.settings, new Date()),
        diagnostics: loaded.diagnostics,
        learnPoolPreview: getLearnPool(loaded.words).slice(0, 8),
        getSettings,
        applyProgress,
        applySettings,
        applyHidden,
        applyFavorite,
        degraded: loaded.degraded,
        retryDegraded,
      },
    }
  }, [base, loaded, getSettings, applyProgress, applySettings, applyHidden, applyFavorite, retryDegraded])
}
