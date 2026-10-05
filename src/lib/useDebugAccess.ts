import type { SupabaseClient } from '@supabase/supabase-js'
import { useEffect, useState } from 'react'
import type { AuthState } from './auth'
import { parseAllowedIds, resolveDebugAccess } from './debugGate'

const ALLOWED_IDS = parseAllowedIds(import.meta.env.VITE_DEBUG_TG_IDS)

/**
 * Whether this user may see Debug. False until a signed-in session has been checked with the auth
 * server (see verifiedTelegramId), so the link never flashes up for someone who is not on the list.
 */
export function useDebugAccess(auth: AuthState, client: SupabaseClient | null, noTelegramContext: boolean): boolean {
  const userId = auth.status === 'signed-in' ? auth.userId : null
  const [result, setResult] = useState<{ userId: string; allowed: boolean } | null>(null)
  const devBypass = import.meta.env.DEV && noTelegramContext

  useEffect(() => {
    if (devBypass || !userId || !client || ALLOWED_IDS.size === 0) return
    let cancelled = false
    void resolveDebugAccess(client, { allowedIds: ALLOWED_IDS, isDev: false, noTelegramContext }).then((allowed) => {
      if (!cancelled) setResult({ userId, allowed })
    })
    return () => {
      cancelled = true
    }
  }, [devBypass, userId, client, noTelegramContext])

  if (devBypass) return true
  return result !== null && result.userId === userId && result.allowed
}
