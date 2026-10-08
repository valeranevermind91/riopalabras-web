import type { SupabaseClient } from '@supabase/supabase-js'
import { useEffect, useState } from 'react'
import { fetchRecentActivity } from '../data/metrics'
import { DOT_COUNT } from '../data/streakDots'

/**
 * The days (local dates) with activity in the week of dots, read once when the user is signed in. Null
 * until it arrives and for good if the read fails: Home then simply shows no dots, and nothing else is affected.
 */
export function useRecentActivity(client: SupabaseClient | null, userId: string | null): ReadonlySet<string> | null {
  const [result, setResult] = useState<{ userId: string; days: ReadonlySet<string> } | null>(null)

  useEffect(() => {
    if (!client || !userId) return
    let cancelled = false
    fetchRecentActivity(client, userId, new Date(), DOT_COUNT).then(
      (days) => {
        if (!cancelled) setResult({ userId, days })
      },
      () => {}, // a failed read hides the dots; it never blocks anything
    )
    return () => {
      cancelled = true
    }
  }, [client, userId])

  return result && result.userId === userId ? result.days : null
}
